// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fixed-supply token with transfer-aware, multi-asset one-hour reward streams.
contract RobynLaunchToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant MAX_REWARD_ASSETS = 5;
    uint8 public constant MAX_EXCLUDED_ACCOUNTS = 16;
    uint256 public constant MAGNITUDE = 2 ** 128;
    uint256 public REWARD_STREAM_DURATION = 1 hours;
    string public constant CONTRACT_VERSION = "7.0.0-schema19";

    error Unauthorized();
    error InvalidAssetCount();
    error InvalidAsset(uint256 index);
    error DuplicateAsset(uint256 firstIndex, uint256 secondIndex);
    error InvalidAccount();
    error InvalidAmount();
    error InvalidAssetIndex(uint256 index);
    error NoRewardAvailable();
    error ExclusionsAlreadySealed();
    error ExclusionsNotSealed();
    error DuplicateExcludedAccount(address account);
    error TooManyExcludedAccounts(uint256 count);
    error InvalidTokenUri();
    error NoEligibleRewardSupply();
    error RewardAccountingInsolvent(uint256 assetIndex, uint256 required, uint256 available);

    struct RewardStream {
        uint256 rewardRate;
        uint256 periodFinish;
        uint256 lastUpdateTime;
        uint256 streamStartTime;
        uint256 streamTotal;
        uint256 streamReleased;
    }

    address public immutable controller;
    address public immutable initializationAuthority;
    uint256 public immutable rewardAssetCount;
    uint256 public eligibleSupply;
    bool public exclusionsSealed;
    mapping(address => bool) public isExcluded;
    IERC20[] private _rewardAssets;
    RewardStream[] private _streams;
    uint256[] public magnifiedRewardPerShare;
    uint256[] public pendingWithoutSupply;
    uint256[] public distributionRemainder;
    uint256[] public totalRewardsReceived;
    uint256[] public totalRewardsDistributed;
    uint256[] public totalRewardsClaimed;
    mapping(address => mapping(uint256 => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(uint256 => uint256)) private _accruedRewards;
    mapping(address => mapping(uint256 => uint256)) private _withdrawn;
    string private _tokenUri;

    event RewardReceived(
        uint256 indexed assetIndex,
        address indexed asset,
        uint256 received,
        uint256 distributed,
        uint256 pendingWithoutSupply
    );
    event RewardStreamUpdated(
        uint256 indexed assetIndex,
        uint256 rewardRate,
        uint256 periodFinish,
        uint256 queuedRewards,
        uint256 eligibleSupply
    );
    event RewardStreamPaused(uint256 indexed assetIndex, uint256 queuedRewards);
    event RewardClaimed(address indexed account, uint256 indexed assetIndex, address indexed asset, uint256 amount);
    event ExclusionsSealed(address[] accounts, uint256 eligibleSupply);
    event RewardStreamDurationConfigured(uint256 duration);

    constructor(
        string memory name_,
        string memory symbol_,
        address creator_,
        uint256 initialSupply_,
        address controller_,
        address[] memory rewardAssets_,
        string memory tokenUri_
    ) ERC20(name_, symbol_) {
        if (creator_ == address(0) || controller_ == address(0)) {
            revert InvalidAccount();
        }
        if (initialSupply_ == 0) revert InvalidAmount();
        _validateTokenUri(tokenUri_);
        uint256 count = rewardAssets_.length;
        if (count == 0 || count > MAX_REWARD_ASSETS) revert InvalidAssetCount();
        for (uint256 i; i < count; ++i) {
            if (rewardAssets_[i] == address(0)) revert InvalidAsset(i);
            for (uint256 j; j < i; ++j) {
                if (rewardAssets_[i] == rewardAssets_[j]) revert DuplicateAsset(j, i);
            }
            _rewardAssets.push(IERC20(rewardAssets_[i]));
            _streams.push(RewardStream(0, 0, 0, 0, 0, 0));
            magnifiedRewardPerShare.push(0);
            pendingWithoutSupply.push(0);
            distributionRemainder.push(0);
            totalRewardsReceived.push(0);
            totalRewardsDistributed.push(0);
            totalRewardsClaimed.push(0);
        }
        controller = controller_;
        initializationAuthority = msg.sender;
        rewardAssetCount = count;
        _tokenUri = tokenUri_;
        _mint(creator_, initialSupply_);
    }

    function configureRewardStreamDuration(uint256 duration) external {
        if (msg.sender != initializationAuthority || exclusionsSealed) revert Unauthorized();
        if (duration == 0 || duration > 7 days) revert InvalidAmount();
        REWARD_STREAM_DURATION = duration;
        emit RewardStreamDurationConfigured(duration);
    }

    function tokenURI() external view returns (string memory) {
        return _tokenUri;
    }

    function sealExclusions(address[] calldata accounts) external {
        if (msg.sender != initializationAuthority) revert Unauthorized();
        if (exclusionsSealed) revert ExclusionsAlreadySealed();
        if (accounts.length > MAX_EXCLUDED_ACCOUNTS) {
            revert TooManyExcludedAccounts(accounts.length);
        }
        for (uint256 i; i < accounts.length; ++i) {
            address account = accounts[i];
            if (account == address(0)) revert InvalidAccount();
            if (isExcluded[account]) revert DuplicateExcludedAccount(account);
            isExcluded[account] = true;
            eligibleSupply -= balanceOf(account);
        }
        exclusionsSealed = true;
        emit ExclusionsSealed(accounts, eligibleSupply);
    }

    function rewardAsset(uint256 index) public view returns (address) {
        _validateAssetIndex(index);
        return address(_rewardAssets[index]);
    }

    function rewardStream(uint256 index) external view returns (RewardStream memory) {
        _validateAssetIndex(index);
        return _streams[index];
    }

    function lastTimeRewardApplicable(uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        uint256 finish = _streams[index].periodFinish;
        return block.timestamp < finish ? block.timestamp : finish;
    }

    function currentRewardPerToken(uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        uint256 supply = eligibleSupply;
        if (supply == 0) return magnifiedRewardPerShare[index];
        uint256 newlyVested = _newlyVestedRewards(index);
        (uint256 increase,) = _rewardPerShareIncrease(newlyVested, supply, distributionRemainder[index]);
        return magnifiedRewardPerShare[index] + increase;
    }

    function streamingRewards(uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        RewardStream memory stream = _streams[index];
        return stream.streamTotal - _vestedStreamRewards(index);
    }

    function totalRewardsVested(uint256 index) external view returns (uint256) {
        _validateAssetIndex(index);
        uint256 supply = eligibleSupply;
        if (supply == 0) return totalRewardsDistributed[index];
        uint256 newlyVested = _newlyVestedRewards(index);
        return totalRewardsDistributed[index] + newlyVested;
    }

    function distributeReward(uint256 index, uint256 requestedAmount) external nonReentrant returns (uint256 received) {
        if (msg.sender != controller) revert Unauthorized();
        if (!exclusionsSealed) revert ExclusionsNotSealed();
        _validateAssetIndex(index);
        if (requestedAmount == 0) revert InvalidAmount();
        _updateStream(index);
        IERC20 asset = _rewardAssets[index];
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), requestedAmount);
        received = asset.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert InvalidAmount();
        totalRewardsReceived[index] += received;
        pendingWithoutSupply[index] += received;
        uint256 supply = eligibleSupply;
        if (supply != 0) _startOrExtendStream(index, supply);
        emit RewardReceived(index, address(asset), received, 0, pendingWithoutSupply[index]);
    }

    function activateQueuedRewards(uint256 index) external nonReentrant {
        _validateAssetIndex(index);
        _updateStream(index);
        if (eligibleSupply == 0) revert NoEligibleRewardSupply();
        if (pendingWithoutSupply[index] == 0) revert NoRewardAvailable();
        _startOrExtendStream(index, eligibleSupply);
    }

    function accumulativeRewardOf(address account, uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        if (isExcluded[account]) return 0;
        return _withdrawn[account][index] + withdrawableRewardOf(account, index);
    }

    function withdrawnRewardOf(address account, uint256 index) external view returns (uint256) {
        _validateAssetIndex(index);
        return _withdrawn[account][index];
    }

    function rewardAccountingState(uint256 index)
        external
        view
        returns (
            uint256 received,
            uint256 vested,
            uint256 unvested,
            uint256 claimed,
            uint256 queued,
            uint256 roundingCarry,
            uint256 available,
            uint256 outstanding,
            uint256 surplus,
            uint256 deficit
        )
    {
        _validateAssetIndex(index);
        received = totalRewardsReceived[index];
        unvested = streamingRewards(index);
        queued = pendingWithoutSupply[index];
        vested = received - queued - unvested;
        claimed = totalRewardsClaimed[index];
        roundingCarry = distributionRemainder[index];
        available = _rewardAssets[index].balanceOf(address(this));
        outstanding = received - claimed;
        if (available >= outstanding) surplus = available - outstanding;
        else deficit = outstanding - available;
    }

    function withdrawableRewardOf(address account, uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        if (isExcluded[account]) return 0;
        return _accruedRewards[account][index]
            + Math.mulDiv(
            balanceOf(account), currentRewardPerToken(index) - userRewardPerTokenPaid[account][index], MAGNITUDE
        );
    }

    function claim(uint256 index) public nonReentrant returns (uint256 amount) {
        _validateAssetIndex(index);
        return _claimAsset(msg.sender, index);
    }

    function claimAll() external nonReentrant returns (uint256 claimed) {
        return _claimAllFor(msg.sender);
    }

    /// @notice Claims every vested basket reward for `account` directly to that account.
    /// @dev Permissionless execution cannot redirect funds and is used by the Schema-19
    /// claims router to couple a holder-paid claim with best-effort maintenance.
    function claimAllFor(address account) external nonReentrant returns (uint256 claimed) {
        if (account == address(0)) revert InvalidAccount();
        return _claimAllFor(account);
    }

    function _claimAllFor(address account) private returns (uint256 claimed) {
        for (uint256 i; i < rewardAssetCount; ++i) {
            _updateAccount(account, i);
            uint256 amount = _accruedRewards[account][i];
            if (amount != 0) {
                claimed += _claimUpdatedAsset(account, i, amount);
            }
        }
        if (claimed == 0) revert NoRewardAvailable();
    }

    function _claimAsset(address account, uint256 index) private returns (uint256 amount) {
        _updateAccount(account, index);
        amount = _accruedRewards[account][index];
        if (amount == 0) revert NoRewardAvailable();
        return _claimUpdatedAsset(account, index, amount);
    }

    function _claimUpdatedAsset(address account, uint256 index, uint256 amount) private returns (uint256) {
        _accruedRewards[account][index] = 0;
        uint256 available = _rewardAssets[index].balanceOf(address(this));
        if (amount > available) revert RewardAccountingInsolvent(index, amount, available);
        _withdrawn[account][index] += amount;
        totalRewardsClaimed[index] += amount;
        _rewardAssets[index].safeTransfer(account, amount);
        emit RewardClaimed(account, index, address(_rewardAssets[index]), amount);
        return amount;
    }

    function _update(address from, address to, uint256 value) internal override {
        for (uint256 i; i < rewardAssetCount; ++i) {
            _updateAccount(from, i);
            if (to != from) _updateAccount(to, i);
        }
        super._update(from, to, value);
        if (value != 0) {
            bool fromEligible = from != address(0) && !isExcluded[from];
            bool toEligible = to != address(0) && !isExcluded[to];
            if (fromEligible && !toEligible) eligibleSupply -= value;
            if (!fromEligible && toEligible) eligibleSupply += value;
        }
        for (uint256 i; i < rewardAssetCount; ++i) {
            _reconcileEligibleSupply(i);
        }
    }

    function _updateAccount(address account, uint256 index) private {
        _updateStream(index);
        if (account != address(0) && !isExcluded[account]) {
            _accruedRewards[
                account
            ][
                index
            ] += Math.mulDiv(
                balanceOf(account), magnifiedRewardPerShare[index] - userRewardPerTokenPaid[account][index], MAGNITUDE
            );
            userRewardPerTokenPaid[account][index] = magnifiedRewardPerShare[index];
        }
    }

    function _updateStream(uint256 index) private {
        RewardStream storage stream = _streams[index];
        uint256 applicable = block.timestamp < stream.periodFinish ? block.timestamp : stream.periodFinish;
        if (applicable <= stream.lastUpdateTime) return;
        uint256 supply = eligibleSupply;
        if (supply == 0) {
            if (stream.streamTotal > stream.streamReleased) {
                pendingWithoutSupply[index] += stream.streamTotal - stream.streamReleased;
                stream.rewardRate = 0;
                stream.streamTotal = 0;
                stream.streamReleased = 0;
                stream.periodFinish = block.timestamp;
                emit RewardStreamPaused(index, pendingWithoutSupply[index]);
            }
            stream.lastUpdateTime = block.timestamp;
            return;
        }
        uint256 emitted = _newlyVestedRewards(index);
        (uint256 rewardPerShareIncrease, uint256 nextRemainder) =
            _rewardPerShareIncrease(emitted, supply, distributionRemainder[index]);
        magnifiedRewardPerShare[index] += rewardPerShareIncrease;
        distributionRemainder[index] = nextRemainder;
        totalRewardsDistributed[index] += emitted;
        stream.streamReleased += emitted;
        stream.lastUpdateTime = applicable;
    }

    function _reconcileEligibleSupply(uint256 index) private {
        RewardStream storage stream = _streams[index];
        if (eligibleSupply == 0) {
            if (stream.streamTotal > stream.streamReleased) {
                pendingWithoutSupply[index] += stream.streamTotal - stream.streamReleased;
                stream.rewardRate = 0;
                stream.streamTotal = 0;
                stream.streamReleased = 0;
                stream.periodFinish = block.timestamp;
                stream.lastUpdateTime = block.timestamp;
                emit RewardStreamPaused(index, pendingWithoutSupply[index]);
            }
            return;
        }
        if (stream.streamTotal == stream.streamReleased && pendingWithoutSupply[index] != 0) {
            _startOrExtendStream(index, eligibleSupply);
        }
    }

    function _startOrExtendStream(uint256 index, uint256 supply) private {
        RewardStream storage stream = _streams[index];
        uint256 remaining = stream.streamTotal - _vestedStreamRewards(index);
        uint256 distributable = pendingWithoutSupply[index] + remaining;
        if (supply == 0 || distributable == 0) revert InvalidAmount();
        stream.rewardRate = distributable / REWARD_STREAM_DURATION;
        stream.streamTotal = distributable;
        stream.streamReleased = 0;
        stream.streamStartTime = block.timestamp;
        stream.periodFinish = block.timestamp + REWARD_STREAM_DURATION;
        stream.lastUpdateTime = block.timestamp;
        pendingWithoutSupply[index] = 0;
        emit RewardStreamUpdated(index, stream.rewardRate, stream.periodFinish, pendingWithoutSupply[index], supply);
    }

    function _vestedStreamRewards(uint256 index) private view returns (uint256) {
        RewardStream memory stream = _streams[index];
        if (stream.streamTotal == 0 || block.timestamp <= stream.streamStartTime) return 0;
        if (block.timestamp >= stream.periodFinish) return stream.streamTotal;
        return (stream.streamTotal * (block.timestamp - stream.streamStartTime)) / REWARD_STREAM_DURATION;
    }

    function _newlyVestedRewards(uint256 index) private view returns (uint256) {
        RewardStream memory stream = _streams[index];
        uint256 vested = _vestedStreamRewards(index);
        return vested > stream.streamReleased ? vested - stream.streamReleased : 0;
    }

    function _rewardPerShareIncrease(uint256 amount, uint256 supply, uint256 priorRemainder)
        private
        pure
        returns (uint256 increase, uint256 nextRemainder)
    {
        increase = Math.mulDiv(amount, MAGNITUDE, supply);
        uint256 combinedRemainder = mulmod(amount, MAGNITUDE, supply) + priorRemainder;
        increase += combinedRemainder / supply;
        nextRemainder = combinedRemainder % supply;
    }

    function _validateAssetIndex(uint256 index) private view {
        if (index >= rewardAssetCount) revert InvalidAssetIndex(index);
    }

    function _validateTokenUri(string memory value) private pure {
        bytes memory uri = bytes(value);
        if (
            uri.length < 28 || uri.length > 140 || uri[0] != "i" || uri[1] != "p" || uri[2] != "f" || uri[3] != "s"
                || uri[4] != ":" || uri[5] != "/" || uri[6] != "/" || uri[7] != "b"
        ) revert InvalidTokenUri();
        for (uint256 i = 8; i < uri.length; ++i) {
            bytes1 character = uri[i];
            bool lowercase = character >= "a" && character <= "z";
            bool digit = character >= "2" && character <= "7";
            if (!lowercase && !digit) revert InvalidTokenUri();
        }
    }
}
