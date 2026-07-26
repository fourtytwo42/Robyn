// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RobynDaoToken} from "../dao/RobynDaoToken.sol";
import {RobynNativeBasketVaultV2} from "./RobynNativeBasketVaultV2.sol";
import {RobynV4AssetRouter} from "./RobynV4AssetRouter.sol";

/// @notice Immutable native-ETH 50/25/20/5 fee policy with per-token creator liabilities.
contract RobynNativeProtocolFeeRouterV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant CREATOR_BPS = 2_500;
    uint16 public constant DAO_REWARD_BPS = 2_000;
    uint16 public constant TREASURY_BPS = 500;
    string public constant CONTRACT_VERSION = "4.0.0";

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
        bool registered;
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

    RobynDaoToken public immutable daoToken;
    RobynV4AssetRouter public immutable assetRouter;
    address payable public immutable treasury;
    address public immutable guardian;
    address public immutable initializer;
    address public coordinator;
    bool public paused;

    mapping(address token => LaunchFeeAccount account) private _launchAccounts;
    uint256 public totalCreatorNativeLiability;
    uint256 public totalDaoNativeRewards;
    uint256 public totalTreasuryNative;
    uint256 public totalBasketNative;

    event CoordinatorBound(address indexed coordinator);
    event LaunchRegistered(
        address indexed token,
        address indexed creator,
        address indexed vault,
        address market,
        address locker,
        address hook
    );
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
    event CreatorFeesClaimed(address indexed token, address indexed creator, address indexed recipient, uint256 amount);
    event ConversionPauseChanged(bool paused, address indexed caller);

    constructor(
        RobynDaoToken daoToken_,
        RobynV4AssetRouter assetRouter_,
        address payable treasury_,
        address guardian_
    ) {
        if (
            address(daoToken_) == address(0) || address(assetRouter_) == address(0) || treasury_ == address(0)
                || guardian_ == address(0) || address(daoToken_).code.length == 0
                || address(assetRouter_).code.length == 0
        ) revert InvalidConfiguration();
        daoToken = daoToken_;
        assetRouter = assetRouter_;
        treasury = treasury_;
        guardian = guardian_;
        initializer = msg.sender;
    }

    receive() external payable {
        if (msg.sender != address(assetRouter) && msg.sender != address(assetRouter.poolManager())) {
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
                || market == address(0) || locker == address(0) || hook == address(0) || hook.code.length == 0
                || address(vault.launchToken()) != address(token)
        ) revert InvalidConfiguration();
        LaunchFeeAccount storage account = _launchAccounts[address(token)];
        if (account.registered) revert LaunchAlreadyRegistered();
        account.creator = creator;
        account.vault = vault;
        account.market = market;
        account.locker = locker;
        account.hook = hook;
        account.registered = true;
        emit LaunchRegistered(address(token), creator, address(vault), market, locker, hook);
    }

    function launchAccount(address token) external view returns (LaunchFeeAccount memory) {
        return _launchAccounts[token];
    }

    function routeNativeFees(IERC20 token) external payable nonReentrant {
        LaunchFeeAccount storage account = _authorizedAccount(address(token));
        _allocateNative(address(token), account, msg.sender, msg.value);
    }

    function convertAndRouteLaunchFees(IERC20 token, uint128 amount, uint256 minimumNativeOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeOut)
    {
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

    function claimCreatorFeesBatch(address[] calldata tokens) external nonReentrant returns (uint256 amount) {
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

    function _claimCreatorBatch(address[] calldata tokens, address payable recipient) private returns (uint256 amount) {
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
        if (account.creator != creator) revert Unauthorized();
        amount = account.claimableCreatorNative;
        account.claimableCreatorNative = 0;
        account.claimedCreatorNative += amount;
        totalCreatorNativeLiability -= amount;
    }

    function _payCreatorClaim(address token, address creator, address payable recipient, uint256 amount) private {
        if (amount == 0) revert NothingPending();
        emit CreatorFeesClaimed(token, creator, recipient, amount);
        _sendNative(recipient, amount);
    }

    function _authorizedAccount(address token) private view returns (LaunchFeeAccount storage account) {
        account = _launchAccounts[token];
        if (!account.registered) revert UnknownLaunch();
        if (msg.sender != account.market && msg.sender != account.locker && msg.sender != account.hook) {
            revert InvalidSource();
        }
    }

    function _allocateNative(address token, LaunchFeeAccount storage account, address source, uint256 amount) private {
        if (amount == 0) revert InvalidConfiguration();
        uint256 creatorAmount = (amount * CREATOR_BPS) / BPS;
        uint256 daoAmount = (amount * DAO_REWARD_BPS) / BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / BPS;
        uint256 basketAmount = amount - creatorAmount - daoAmount - treasuryAmount;
        account.claimableCreatorNative += creatorAmount;
        account.cumulativeCreatorNative += creatorAmount;
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
        totalDaoNativeRewards += daoAmount;
        totalTreasuryNative += treasuryAmount;
        totalBasketNative += basketAmount;
        account.vault.recordFees{value: basketAmount}();
        daoToken.depositRewards{value: daoAmount}();
        (bool sent,) = treasury.call{value: treasuryAmount}("");
        if (!sent) revert NativeTransferFailed();
        emit NativeFeesRouted(token, source, amount, basketAmount, creatorAmount, daoAmount, treasuryAmount);
        assert(address(this).balance >= totalCreatorNativeLiability);
    }

    // Recipients are canonical creators or creator-selected claim targets after
    // ownership checks; liabilities are cleared before this pull-payment call.
    // slither-disable-next-line arbitrary-send-eth
    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }
}
