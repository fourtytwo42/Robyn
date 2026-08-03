// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynDaoToken } from "../dao/RobynDaoToken.sol";
import { RobynNativeBasketVaultV2 } from "./RobynNativeBasketVaultV2.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";

interface ISchema19DaoRewardReceiver {
    function depositRewards(address sourceToken) external payable returns (uint256 epochId);
}

/// @notice Immutable native-ETH 50/25/20/5 fee policy with per-token creator liabilities.
contract RobynNativeProtocolFeeRouterV4 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant CREATOR_BPS = 2_500;
    uint16 public constant DAO_REWARD_BPS = 2_000;
    uint16 public constant TREASURY_BPS = 500;
    uint8 public constant MAX_CREATOR_RECIPIENTS = 8;
    uint256 public immutable CREATOR_REWARD_STREAM_DURATION;
    string public constant CONTRACT_VERSION = "9.0.0-schema19";

    struct CreatorRewardStream {
        uint256 rewardRate;
        uint256 periodFinish;
        uint256 lastUpdateTime;
        uint256 streamStartTime;
        uint256 streamTotal;
        uint256 streamReleased;
        uint256 accrued;
    }

    struct CreatorRewardState {
        uint256 claimable;
        uint256 unvested;
        uint256 assigned;
        uint256 vested;
        uint256 claimed;
        uint256 ratePerSecond;
        uint256 lastUpdateTime;
        uint256 streamEnd;
    }

    struct CreatorFeeSplit {
        address[] recipients;
        uint16[] sharesBps;
        bool locked;
    }

    struct LaunchFeeAccount {
        address creator;
        RobynNativeBasketVaultV2 vault;
        address market;
        address locker;
        address hook;
        uint256 cumulativeNativeFees;
        uint256 cumulativeLaunchFeesConverted;
        uint256 cumulativeBondingNativeFees;
        uint256 cumulativeLockedLpNativeFees;
        uint256 cumulativeHookNativeFees;
        uint256 cumulativeLockedLaunchFeesConverted;
        uint256 cumulativeHookLaunchFeesConverted;
        uint256 claimableCreatorNative;
        uint256 cumulativeCreatorNative;
        uint256 claimedCreatorNative;
        uint256 pendingBasketNative;
        uint256 cumulativeBasketNativeSettled;
        bool registered;
        uint256 pendingDaoNative;
        uint256 cumulativeDaoNativeSettled;
        uint256 pendingTreasuryNative;
        uint256 cumulativeTreasuryNativeSettled;
    }

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyBound();
    error LaunchAlreadyRegistered();
    error UnknownLaunch();
    error InvalidSource();
    error NothingPending();
    error ConversionPaused();
    error NativeTransferFailed();
    error Insolvent();
    error RewardAccountingInsolvent(uint256 required, uint256 available);
    error CreatorSplitLocked();

    RobynDaoToken public immutable daoToken;
    RobynV4AssetRouter public immutable assetRouter;
    address payable public immutable treasury;
    address public immutable guardian;
    address public immutable initializer;
    address public coordinator;
    address public maintenanceCoordinator;
    bool public paused;

    address public daoRewardReceiver;
    mapping(address token => LaunchFeeAccount account) private _launchAccounts;
    mapping(address token => CreatorFeeSplit split) private _creatorFeeSplits;
    mapping(address token => mapping(address recipient => CreatorRewardStream stream)) private
        _creatorRewardStreams;
    mapping(address token => mapping(address recipient => uint256 amount)) public
        cumulativeCreatorNativeByRecipient;
    mapping(address token => mapping(address recipient => uint256 amount)) public
        claimedCreatorNativeByRecipient;
    uint256 public totalCreatorNativeLiability;
    uint256 public totalBasketNativeLiability;
    uint256 public totalDaoNativeLiability;
    uint256 public totalTreasuryNativeLiability;
    uint256 public totalDaoNativeRewards;
    uint256 public totalTreasuryNative;
    uint256 public totalBasketNative;

    event CoordinatorBound(address indexed coordinator);
    event MaintenanceCoordinatorBound(address indexed maintenanceCoordinator);
    event LaunchRegistered(
        address indexed token,
        address indexed creator,
        address indexed vault,
        address market,
        address locker,
        address hook
    );
    event DaoRewardReceiverBound(address indexed receiver);
    event NativeFeesRouted(
        address indexed token,
        address indexed source,
        uint256 total,
        uint256 basket,
        uint256 creator,
        uint256 daoReward,
        uint256 treasury
    );
    event LaunchFeesConverted(address indexed token, uint256 launchAmount, uint256 nativeOutput);
    event BasketFeesSettled(address indexed token, address indexed vault, uint256 amount);
    event DaoFeesSettled(address indexed daoToken, uint256 amount);
    event TreasuryFeesSettled(address indexed treasury, uint256 amount);
    event UnattributedNativeSwept(address indexed treasury, uint256 amount);
    event CreatorFeesClaimed(
        address indexed token, address indexed claimant, address indexed recipient, uint256 amount
    );
    event CreatorFeeSplitConfigured(
        address indexed token,
        address indexed creator,
        address[] recipients,
        uint16[] sharesBps,
        bool locked
    );
    event CreatorFeesAssigned(address indexed token, address indexed recipient, uint256 amount);
    event CreatorRewardStreamUpdated(
        address indexed token,
        address indexed recipient,
        uint256 rewardRate,
        uint256 periodFinish,
        uint256 claimable,
        uint256 unvested
    );
    event ConversionPauseChanged(bool paused, address indexed caller);

    constructor(
        RobynDaoToken daoToken_,
        RobynV4AssetRouter assetRouter_,
        address payable treasury_,
        address guardian_,
        uint256 creatorRewardStreamDuration_
    ) {
        if (
            address(daoToken_) == address(0) || address(assetRouter_) == address(0)
                || treasury_ == address(0) || guardian_ == address(0)
                || address(daoToken_).code.length == 0 || address(assetRouter_).code.length == 0
        ) revert InvalidConfiguration();
        if (creatorRewardStreamDuration_ == 0 || creatorRewardStreamDuration_ > 7 days) {
            revert InvalidConfiguration();
        }
        daoToken = daoToken_;
        assetRouter = assetRouter_;
        treasury = treasury_;
        guardian = guardian_;
        CREATOR_REWARD_STREAM_DURATION = creatorRewardStreamDuration_;
        initializer = msg.sender;
    }

    receive() external payable {
        if (msg.sender != address(assetRouter) && msg.sender != address(assetRouter.poolManager()))
        {
            revert Unauthorized();
        }
    }

    function bindCoordinator(address coordinator_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (coordinator != address(0)) revert AlreadyBound();

        if (coordinator_ == address(0) || coordinator_.code.length == 0) {
            revert InvalidConfiguration();
        }
        coordinator = coordinator_;
        emit CoordinatorBound(coordinator_);
    }

    function bindMaintenanceCoordinator(address maintenanceCoordinator_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (maintenanceCoordinator != address(0)) revert AlreadyBound();
        if (maintenanceCoordinator_ == address(0) || maintenanceCoordinator_.code.length == 0) {
            revert InvalidConfiguration();
        }
        maintenanceCoordinator = maintenanceCoordinator_;
        emit MaintenanceCoordinatorBound(maintenanceCoordinator_);
    }

    function bindDaoRewardReceiver(address receiver) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (daoRewardReceiver != address(0)) revert AlreadyBound();
        if (receiver == address(0) || receiver.code.length == 0) revert InvalidConfiguration();
        daoRewardReceiver = receiver;
        emit DaoRewardReceiverBound(receiver);
    }

    function setPaused(bool paused_) external {
        if (paused_) {
            if (msg.sender != guardian && msg.sender != treasury) revert Unauthorized();
        } else if (msg.sender != treasury) {
            revert Unauthorized();
        }
        paused = paused_;
        emit ConversionPauseChanged(paused_, msg.sender);
    }

    function registerLaunch(
        IERC20 token,
        address creator,
        RobynNativeBasketVaultV2 vault,
        address market,
        address locker,
        address hook
    ) external {
        if (msg.sender != coordinator) revert Unauthorized();
        if (
            address(token) == address(0) || creator == address(0) || address(vault) == address(0)
                || market == address(0) || locker == address(0) || hook == address(0)
                || hook.code.length == 0 || address(vault.launchToken()) != address(token)
        ) revert InvalidConfiguration();
        LaunchFeeAccount storage account = _launchAccounts[address(token)];
        if (account.registered) revert LaunchAlreadyRegistered();
        account.creator = creator;
        account.vault = vault;
        account.market = market;
        account.locker = locker;
        account.hook = hook;
        account.registered = true;
        CreatorFeeSplit storage split = _creatorFeeSplits[address(token)];
        split.recipients.push(creator);
        split.sharesBps.push(BPS);
        emit LaunchRegistered(address(token), creator, address(vault), market, locker, hook);
        emit CreatorFeeSplitConfigured(
            address(token), creator, split.recipients, split.sharesBps, false
        );
    }

    function launchAccount(address token) external view returns (LaunchFeeAccount memory) {
        return _launchAccounts[token];
    }

    function creatorFeeSplit(address token)
        external
        view
        returns (address[] memory recipients, uint16[] memory sharesBps, bool locked)
    {
        if (!_launchAccounts[token].registered) revert UnknownLaunch();
        CreatorFeeSplit storage split = _creatorFeeSplits[token];
        return (split.recipients, split.sharesBps, split.locked);
    }

    function setCreatorFeeSplit(
        address token,
        address[] calldata recipients,
        uint16[] calldata sharesBps,
        bool lockConfiguration
    ) external {
        LaunchFeeAccount storage account = _launchAccounts[token];
        if (!account.registered) revert UnknownLaunch();
        if (msg.sender != account.creator) revert Unauthorized();
        CreatorFeeSplit storage split = _creatorFeeSplits[token];
        if (split.locked) revert CreatorSplitLocked();
        _validateCreatorFeeSplit(recipients, sharesBps);
        delete split.recipients;
        delete split.sharesBps;
        for (uint256 index; index < recipients.length; ++index) {
            split.recipients.push(recipients[index]);
            split.sharesBps.push(sharesBps[index]);
        }
        split.locked = lockConfiguration;
        emit CreatorFeeSplitConfigured(token, msg.sender, recipients, sharesBps, lockConfiguration);
    }

    function claimableCreatorNativeByRecipient(address token, address recipient)
        public
        view
        returns (uint256)
    {
        if (!_launchAccounts[token].registered) revert UnknownLaunch();
        CreatorRewardStream memory stream = _creatorRewardStreams[token][recipient];
        return stream.accrued + _newlyVestedCreatorRewards(stream);
    }

    function creatorRewardStream(address token, address recipient)
        external
        view
        returns (CreatorRewardState memory state)
    {
        if (!_launchAccounts[token].registered) revert UnknownLaunch();
        CreatorRewardStream memory stream = _creatorRewardStreams[token][recipient];
        uint256 newlyVested = _newlyVestedCreatorRewards(stream);
        uint256 vestedInStream = _vestedCreatorStreamRewards(stream);
        state = CreatorRewardState({
            claimable: stream.accrued + newlyVested,
            unvested: stream.streamTotal - vestedInStream,
            assigned: cumulativeCreatorNativeByRecipient[token][recipient],
            vested: claimedCreatorNativeByRecipient[token][recipient] + stream.accrued
                + newlyVested,
            claimed: claimedCreatorNativeByRecipient[token][recipient],
            ratePerSecond: stream.rewardRate,
            lastUpdateTime: stream.lastUpdateTime,
            streamEnd: stream.periodFinish
        });
    }

    function checkpointCreatorRewards(address token, address recipient) external {
        if (!_launchAccounts[token].registered) revert UnknownLaunch();
        _updateCreatorStream(token, recipient);
    }

    function routeNativeFees(IERC20 token) external payable nonReentrant {
        LaunchFeeAccount storage account = _authorizedAccount(address(token));
        _allocateNative(address(token), account, msg.sender, msg.value);
    }

    function convertAndRouteLaunchFees(
        IERC20 token,
        uint128 amount,
        uint256 minimumNativeOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 nativeOut) {
        LaunchFeeAccount storage account = _authorizedAccount(address(token));
        if (msg.sender != account.locker && msg.sender != account.hook) revert InvalidSource();
        if (paused) revert ConversionPaused();
        if (amount == 0 || minimumNativeOut == 0) revert InvalidConfiguration();
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(assetRouter), amount);
        uint256 beforeBalance = address(this).balance;
        nativeOut = assetRouter.swapExactAssetForNative(
            address(token), amount, minimumNativeOut, payable(address(this)), deadline
        );
        token.forceApprove(address(assetRouter), 0);
        uint256 delta = address(this).balance - beforeBalance;
        if (nativeOut != delta || nativeOut < minimumNativeOut) revert InvalidConfiguration();
        account.cumulativeLaunchFeesConverted += amount;
        if (msg.sender == account.hook) {
            account.cumulativeHookLaunchFeesConverted += amount;
        } else {
            account.cumulativeLockedLaunchFeesConverted += amount;
        }
        emit LaunchFeesConverted(address(token), amount, nativeOut);
        _allocateNative(address(token), account, msg.sender, nativeOut);
    }

    function claimCreatorFees(address token) external nonReentrant returns (uint256 amount) {
        amount = _debitCreatorClaim(token, msg.sender);
        _payCreatorClaim(token, msg.sender, payable(msg.sender), amount);
    }

    function claimCreatorFeesTo(address token, address payable recipient)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (recipient == address(0)) revert InvalidConfiguration();
        amount = _debitCreatorClaim(token, msg.sender);
        _payCreatorClaim(token, msg.sender, recipient, amount);
    }

    function claimCreatorFeesBatch(address[] calldata tokens)
        external
        nonReentrant
        returns (uint256 amount)
    {
        return _claimCreatorBatch(tokens, payable(msg.sender));
    }

    function claimCreatorFeesBatchTo(address[] calldata tokens, address payable recipient)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (recipient == address(0)) revert InvalidConfiguration();
        return _claimCreatorBatch(tokens, recipient);
    }

    function totalNativeLiabilities() public view returns (uint256) {
        return totalCreatorNativeLiability + totalBasketNativeLiability + totalDaoNativeLiability
            + totalTreasuryNativeLiability;
    }

    function unattributedNative() public view returns (uint256) {
        uint256 liabilities = totalNativeLiabilities();
        return address(this).balance > liabilities ? address(this).balance - liabilities : 0;
    }

    function settleBasketFees(address token, uint256 amount) external nonReentrant {
        LaunchFeeAccount storage account = _launchAccounts[token];
        if (!account.registered) revert UnknownLaunch();
        if (amount == 0 || amount > account.pendingBasketNative) revert InvalidConfiguration();
        account.pendingBasketNative -= amount;
        account.cumulativeBasketNativeSettled += amount;
        totalBasketNativeLiability -= amount;
        // The coordinator registers this immutable launch-token vault after
        // validating vault.launchToken() against the canonical token.
        // slither-disable-next-line arbitrary-send-eth
        uint256 received = account.vault.recordFees{ value: amount }();
        if (received != amount) revert InvalidConfiguration();
        emit BasketFeesSettled(token, address(account.vault), amount);
        _assertSolvent();
    }

    function settleDaoFees(address token, uint256 amount) external nonReentrant {
        LaunchFeeAccount storage account = _launchAccounts[token];
        if (!account.registered || daoRewardReceiver == address(0)) revert InvalidConfiguration();
        if (amount == 0 || amount > account.pendingDaoNative) revert InvalidConfiguration();
        account.pendingDaoNative -= amount;
        account.cumulativeDaoNativeSettled += amount;
        totalDaoNativeLiability -= amount;
        ISchema19DaoRewardReceiver(daoRewardReceiver).depositRewards{ value: amount }(token);
        emit DaoFeesSettled(daoRewardReceiver, amount);
        _assertSolvent();
    }

    function settleTreasuryFees(address token, uint256 amount) external nonReentrant {
        LaunchFeeAccount storage account = _launchAccounts[token];
        if (!account.registered || daoRewardReceiver == address(0)) revert InvalidConfiguration();
        if (amount == 0 || amount > account.pendingTreasuryNative) revert InvalidConfiguration();
        account.pendingTreasuryNative -= amount;
        account.cumulativeTreasuryNativeSettled += amount;
        totalTreasuryNativeLiability -= amount;
        _sendNative(treasury, amount);
        emit TreasuryFeesSettled(treasury, amount);
        _assertSolvent();
    }

    function settleDaoFees(uint256 amount) external nonReentrant {
        if (daoRewardReceiver != address(0)) revert InvalidConfiguration();
        if (amount == 0 || amount > totalDaoNativeLiability || daoToken.eligibleRewardSupply() == 0)
        {
            revert InvalidConfiguration();
        }
        totalDaoNativeLiability -= amount;
        daoToken.depositRewards{ value: amount }();
        emit DaoFeesSettled(address(daoToken), amount);
        _assertSolvent();
    }

    function settleTreasuryFees(uint256 amount) external nonReentrant {
        if (daoRewardReceiver != address(0)) revert InvalidConfiguration();
        if (amount == 0 || amount > totalTreasuryNativeLiability) revert InvalidConfiguration();
        totalTreasuryNativeLiability -= amount;
        _sendNative(treasury, amount);
        emit TreasuryFeesSettled(treasury, amount);
        _assertSolvent();
    }

    function sweepUnattributedNative() external nonReentrant returns (uint256 amount) {
        amount = unattributedNative();
        if (amount == 0) revert NothingPending();
        _sendNative(treasury, amount);
        emit UnattributedNativeSwept(treasury, amount);
        _assertSolvent();
    }

    function _claimCreatorBatch(address[] calldata tokens, address payable recipient)
        private
        returns (uint256 amount)
    {
        if (tokens.length == 0) revert InvalidConfiguration();
        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 index; index < tokens.length; ++index) {
            for (uint256 prior; prior < index; ++prior) {
                if (tokens[index] == tokens[prior]) revert InvalidConfiguration();
            }
            amounts[index] = _debitCreatorClaim(tokens[index], msg.sender);
            amount += amounts[index];
        }
        if (amount == 0) revert NothingPending();
        for (uint256 index; index < tokens.length; ++index) {
            if (amounts[index] != 0) {
                emit CreatorFeesClaimed(tokens[index], msg.sender, recipient, amounts[index]);
            }
        }
        _sendNative(recipient, amount);
    }

    function _debitCreatorClaim(address token, address creator) private returns (uint256 amount) {
        LaunchFeeAccount storage account = _launchAccounts[token];
        if (!account.registered) revert UnknownLaunch();
        _updateCreatorStream(token, creator);
        CreatorRewardStream storage stream = _creatorRewardStreams[token][creator];
        amount = stream.accrued;
        uint256 available = address(this).balance;
        if (amount > available || amount > totalCreatorNativeLiability) {
            revert RewardAccountingInsolvent(amount, available);
        }
        stream.accrued = 0;
        claimedCreatorNativeByRecipient[token][creator] += amount;
        account.claimableCreatorNative -= amount;
        account.claimedCreatorNative += amount;
        totalCreatorNativeLiability -= amount;
    }

    function _payCreatorClaim(
        address token,
        address creator,
        address payable recipient,
        uint256 amount
    ) private {
        if (amount == 0) revert NothingPending();
        emit CreatorFeesClaimed(token, creator, recipient, amount);
        _sendNative(recipient, amount);
    }

    function _authorizedAccount(address token)
        private
        view
        returns (LaunchFeeAccount storage account)
    {
        account = _launchAccounts[token];
        if (!account.registered) revert UnknownLaunch();
        if (
            msg.sender != account.market && msg.sender != account.locker
                && msg.sender != account.hook
        ) {
            revert InvalidSource();
        }
    }

    function _allocateNative(
        address token,
        LaunchFeeAccount storage account,
        address source,
        uint256 amount
    ) private {
        if (amount == 0) revert InvalidConfiguration();
        uint256 creatorAmount = (amount * CREATOR_BPS) / BPS;
        uint256 daoAmount = (amount * DAO_REWARD_BPS) / BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / BPS;
        uint256 basketAmount = amount - creatorAmount - daoAmount - treasuryAmount;
        account.claimableCreatorNative += creatorAmount;
        account.cumulativeCreatorNative += creatorAmount;
        _assignCreatorFees(token, creatorAmount);
        account.cumulativeNativeFees += amount;
        if (source == account.market) {
            account.cumulativeBondingNativeFees += amount;
        } else if (source == account.locker) {
            account.cumulativeLockedLpNativeFees += amount;
        } else if (source == account.hook) {
            account.cumulativeHookNativeFees += amount;
        } else {
            revert InvalidSource();
        }
        totalCreatorNativeLiability += creatorAmount;
        account.pendingBasketNative += basketAmount;
        totalBasketNativeLiability += basketAmount;
        totalDaoNativeLiability += daoAmount;
        totalTreasuryNativeLiability += treasuryAmount;
        totalDaoNativeRewards += daoAmount;
        account.pendingDaoNative += daoAmount;
        account.pendingTreasuryNative += treasuryAmount;
        totalTreasuryNative += treasuryAmount;
        totalBasketNative += basketAmount;
        emit NativeFeesRouted(
            token, source, amount, basketAmount, creatorAmount, daoAmount, treasuryAmount
        );
        _assertSolvent();
    }

    function _assignCreatorFees(address token, uint256 amount) private {
        CreatorFeeSplit storage split = _creatorFeeSplits[token];
        uint256 assigned;
        uint256 last = split.recipients.length - 1;
        for (uint256 index; index < split.recipients.length; ++index) {
            uint256 share =
                index == last ? amount - assigned : (amount * split.sharesBps[index]) / BPS;
            assigned += share;
            address recipient = split.recipients[index];
            _updateCreatorStream(token, recipient);
            _startOrExtendCreatorStream(token, recipient, share);
            cumulativeCreatorNativeByRecipient[token][recipient] += share;
            emit CreatorFeesAssigned(token, recipient, share);
        }
    }

    function _updateCreatorStream(address token, address recipient) private {
        CreatorRewardStream storage stream = _creatorRewardStreams[token][recipient];
        uint256 newlyVested = _newlyVestedCreatorRewards(stream);
        if (newlyVested != 0) {
            stream.accrued += newlyVested;
            stream.streamReleased += newlyVested;
        }
        uint256 applicable =
            block.timestamp < stream.periodFinish ? block.timestamp : stream.periodFinish;
        if (applicable > stream.lastUpdateTime) stream.lastUpdateTime = applicable;
    }

    function _startOrExtendCreatorStream(address token, address recipient, uint256 amount) private {
        CreatorRewardStream storage stream = _creatorRewardStreams[token][recipient];
        uint256 remaining = stream.streamTotal - stream.streamReleased;
        uint256 distributable = remaining + amount;
        stream.rewardRate = distributable / CREATOR_REWARD_STREAM_DURATION;
        stream.periodFinish = block.timestamp + CREATOR_REWARD_STREAM_DURATION;
        stream.lastUpdateTime = block.timestamp;
        stream.streamStartTime = block.timestamp;
        stream.streamTotal = distributable;
        stream.streamReleased = 0;
        emit CreatorRewardStreamUpdated(
            token, recipient, stream.rewardRate, stream.periodFinish, stream.accrued, distributable
        );
    }

    function _vestedCreatorStreamRewards(CreatorRewardStream memory stream)
        private
        view
        returns (uint256)
    {
        if (stream.streamTotal == 0 || block.timestamp <= stream.streamStartTime) return 0;
        if (block.timestamp >= stream.periodFinish) return stream.streamTotal;
        return (stream.streamTotal * (block.timestamp - stream.streamStartTime))
            / CREATOR_REWARD_STREAM_DURATION;
    }

    function _newlyVestedCreatorRewards(CreatorRewardStream memory stream)
        private
        view
        returns (uint256)
    {
        uint256 vested = _vestedCreatorStreamRewards(stream);
        return vested > stream.streamReleased ? vested - stream.streamReleased : 0;
    }

    function _validateCreatorFeeSplit(address[] calldata recipients, uint16[] calldata sharesBps)
        private
        pure
    {
        uint256 count = recipients.length;
        if (count == 0 || count > MAX_CREATOR_RECIPIENTS || count != sharesBps.length) {
            revert InvalidConfiguration();
        }
        uint256 total;
        for (uint256 index; index < count; ++index) {
            if (recipients[index] == address(0) || sharesBps[index] == 0) {
                revert InvalidConfiguration();
            }
            total += sharesBps[index];
            for (uint256 prior; prior < index; ++prior) {
                if (recipients[index] == recipients[prior]) revert InvalidConfiguration();
            }
        }
        if (total != BPS) revert InvalidConfiguration();
    }

    function _assertSolvent() private view {
        if (address(this).balance < totalNativeLiabilities()) revert Insolvent();
    }

    // Recipients are canonical creators or creator-selected claim targets after
    // ownership checks; liabilities are cleared before this pull-payment call.
    // slither-disable-next-line arbitrary-send-eth
    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
    }
}
