// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-supply governance token with transfer-aware seven-day native reward streams.
contract RobynDaoToken is ERC20, ERC20Permit, ERC20Votes, ReentrancyGuard {
    uint256 public constant FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 private constant MAGNITUDE = 1 << 128;
    uint256 private constant MAX_EXCLUSIONS = 16;
    uint256 public constant REWARD_STREAM_DURATION = 7 days;
    string public constant CONTRACT_VERSION = "3.0.0";

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyBound();
    error ExclusionsAlreadySealed();
    error RewardAccountExcluded();
    error NothingToClaim();
    error NativeTransferFailed();
    error NoEligibleRewardSupply();

    address public immutable initializer;
    address public rewardDepositor;
    bool public exclusionsSealed;
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public streamStartTime;
    uint256 public streamTotal;
    uint256 public streamReleased;
    uint256 public rewardPerTokenStored;
    uint256 public queuedRewards;
    uint256 public totalRewardsDeposited;
    uint256 public totalRewardsClaimed;

    mapping(address => bool) public isRewardExcluded;
    address[] private _rewardExclusions;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) private _accruedRewards;
    mapping(address => uint256) public withdrawnRewards;

    event RewardDepositorBound(address indexed rewardDepositor);
    event RewardExclusionsSealed(address[] accounts);
    event RewardsDeposited(uint256 amount, uint256 eligibleSupply, uint256 cumulativeDeposited);
    event RewardsClaimed(address indexed account, address indexed recipient, uint256 amount);
    event RewardStreamUpdated(
        uint256 rewardRate, uint256 periodFinish, uint256 queuedRewards, uint256 eligibleSupply
    );
    event RewardStreamPaused(uint256 queuedRewards);

    constructor(address[] memory recipients, uint256[] memory amounts)
        ERC20("Robyn DAO", "RDAO")
        ERC20Permit("Robyn DAO")
    {
        if (recipients.length == 0 || recipients.length != amounts.length) {
            revert InvalidConfiguration();
        }
        initializer = msg.sender;
        uint256 allocated;
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0) || amounts[i] == 0) revert InvalidConfiguration();
            allocated += amounts[i];
            _mint(recipients[i], amounts[i]);
        }
        if (allocated != FIXED_SUPPLY) revert InvalidConfiguration();
    }

    function bindRewardDepositor(address depositor) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (rewardDepositor != address(0)) revert AlreadyBound();
        if (depositor == address(0) || depositor.code.length == 0 || !exclusionsSealed) {
            revert InvalidConfiguration();
        }
        rewardDepositor = depositor;
        emit RewardDepositorBound(depositor);
    }

    function sealRewardExclusions(address[] calldata accounts) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (exclusionsSealed) revert ExclusionsAlreadySealed();
        if (accounts.length == 0 || accounts.length > MAX_EXCLUSIONS) {
            revert InvalidConfiguration();
        }
        for (uint256 i; i < accounts.length; ++i) {
            address account = accounts[i];
            if (account == address(0) || isRewardExcluded[account]) revert InvalidConfiguration();
            isRewardExcluded[account] = true;
            _rewardExclusions.push(account);
        }
        exclusionsSealed = true;
        emit RewardExclusionsSealed(accounts);
    }

    function rewardExclusions() external view returns (address[] memory) {
        return _rewardExclusions;
    }

    function eligibleRewardSupply() public view returns (uint256 supply) {
        supply = totalSupply();
        for (uint256 i; i < _rewardExclusions.length; ++i) {
            supply -= balanceOf(_rewardExclusions[i]);
        }
    }

    function depositRewards() external payable nonReentrant {
        if (msg.sender != rewardDepositor) revert Unauthorized();
        if (msg.value == 0) revert InvalidConfiguration();
        _updateReward(address(0));
        totalRewardsDeposited += msg.value;
        queuedRewards += msg.value;
        uint256 supply = eligibleRewardSupply();
        if (supply != 0) _startOrExtendStream(supply);
        emit RewardsDeposited(msg.value, supply, totalRewardsDeposited);
    }

    function activateQueuedRewards() external nonReentrant {
        _updateReward(address(0));
        uint256 supply = eligibleRewardSupply();
        if (supply == 0) revert NoEligibleRewardSupply();
        if (queuedRewards == 0) revert NothingToClaim();
        _startOrExtendStream(supply);
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function currentRewardPerToken() public view returns (uint256) {
        uint256 supply = eligibleRewardSupply();
        if (supply == 0) return rewardPerTokenStored;
        uint256 newlyVested = _newlyVestedRewards();
        return rewardPerTokenStored + (newlyVested * MAGNITUDE) / supply;
    }

    function streamingRewards() public view returns (uint256) {
        return streamTotal - _vestedStreamRewards();
    }

    function totalRewardsVested() external view returns (uint256) {
        return totalRewardsDeposited - queuedRewards - streamingRewards();
    }

    function magnifiedRewardPerShare() external view returns (uint256) {
        return rewardPerTokenStored;
    }

    function accumulativeRewardOf(address account) public view returns (uint256) {
        if (isRewardExcluded[account]) return 0;
        return withdrawnRewards[account] + claimableRewardOf(account);
    }

    function claimableRewardOf(address account) public view returns (uint256) {
        if (isRewardExcluded[account]) return 0;
        return _accruedRewards[account]
            + (balanceOf(account) * (currentRewardPerToken() - userRewardPerTokenPaid[account]))
            / MAGNITUDE;
    }

    function claimRewards() external returns (uint256 amount) {
        return _claim(msg.sender, payable(msg.sender));
    }

    function claimRewardsTo(address payable recipient) external returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidConfiguration();
        return _claim(msg.sender, recipient);
    }

    function _claim(address account, address payable recipient)
        private
        nonReentrant
        returns (uint256 amount)
    {
        if (isRewardExcluded[account]) revert RewardAccountExcluded();
        _updateReward(account);
        amount = _accruedRewards[account];
        if (amount == 0) revert NothingToClaim();
        _accruedRewards[account] = 0;
        withdrawnRewards[account] += amount;
        totalRewardsClaimed += amount;
        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
        emit RewardsClaimed(account, recipient, amount);
    }

    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        _updateReward(from);
        if (to != from) _updateReward(to);
        super._update(from, to, value);
        _reconcileEligibleSupply();
    }

    function _updateReward(address account) private {
        uint256 nextRewardPerToken = currentRewardPerToken();
        uint256 newlyVested = _newlyVestedRewards();
        rewardPerTokenStored = nextRewardPerToken;
        streamReleased += newlyVested;
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0) && !isRewardExcluded[account]) {
            _accruedRewards[
                    account
                ] += (balanceOf(account) * (nextRewardPerToken - userRewardPerTokenPaid[account]))
                / MAGNITUDE;
            userRewardPerTokenPaid[account] = nextRewardPerToken;
        }
    }

    function _reconcileEligibleSupply() private {
        uint256 supply = eligibleRewardSupply();
        if (supply == 0) {
            if (streamTotal > streamReleased) {
                queuedRewards += streamTotal - streamReleased;
                rewardRate = 0;
                streamTotal = 0;
                streamReleased = 0;
                periodFinish = block.timestamp;
                lastUpdateTime = block.timestamp;
                emit RewardStreamPaused(queuedRewards);
            }
            return;
        }
        if (streamTotal == streamReleased && queuedRewards != 0) {
            _startOrExtendStream(supply);
        }
    }

    function _startOrExtendStream(uint256 supply) private {
        uint256 remaining = streamingRewards();
        uint256 distributable = queuedRewards + remaining;
        rewardRate = distributable / REWARD_STREAM_DURATION;
        streamTotal = distributable;
        streamReleased = 0;
        streamStartTime = block.timestamp;
        periodFinish = block.timestamp + REWARD_STREAM_DURATION;
        lastUpdateTime = block.timestamp;
        queuedRewards = 0;
        emit RewardStreamUpdated(rewardRate, periodFinish, queuedRewards, supply);
    }

    function _vestedStreamRewards() private view returns (uint256) {
        if (streamTotal == 0 || block.timestamp <= streamStartTime) return 0;
        if (block.timestamp >= periodFinish) return streamTotal;
        return (streamTotal * (block.timestamp - streamStartTime)) / REWARD_STREAM_DURATION;
    }

    function _newlyVestedRewards() private view returns (uint256) {
        uint256 vested = _vestedStreamRewards();
        return vested > streamReleased ? vested - streamReleased : 0;
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
