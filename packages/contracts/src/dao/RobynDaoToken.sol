// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-supply Robyn governance token with transfer-aware native rewards.
contract RobynDaoToken is ERC20, ERC20Permit, ERC20Votes, ReentrancyGuard {
    uint256 public constant FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 private constant MAGNITUDE = 1 << 128;
    uint256 private constant MAX_EXCLUSIONS = 16;

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyBound();
    error ExclusionsAlreadySealed();
    error RewardAccountExcluded();
    error NothingToClaim();
    error NativeTransferFailed();

    address public immutable initializer;
    address public rewardDepositor;
    bool public exclusionsSealed;
    uint256 public magnifiedRewardPerShare;
    uint256 public totalRewardsDeposited;
    uint256 public totalRewardsClaimed;

    mapping(address => bool) public isRewardExcluded;
    address[] private _rewardExclusions;
    mapping(address => int256) private _magnifiedRewardCorrections;
    mapping(address => uint256) public withdrawnRewards;

    event RewardDepositorBound(address indexed rewardDepositor);
    event RewardExclusionsSealed(address[] accounts);
    event RewardsDeposited(uint256 amount, uint256 eligibleSupply, uint256 cumulativeDeposited);
    event RewardsClaimed(address indexed account, address indexed recipient, uint256 amount);

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
        if (depositor == address(0) || depositor.code.length == 0 || !exclusionsSealed) revert InvalidConfiguration();
        rewardDepositor = depositor;
        emit RewardDepositorBound(depositor);
    }

    function sealRewardExclusions(address[] calldata accounts) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (exclusionsSealed) revert ExclusionsAlreadySealed();
        if (accounts.length == 0 || accounts.length > MAX_EXCLUSIONS) revert InvalidConfiguration();
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

    function depositRewards() external payable {
        if (msg.sender != rewardDepositor) revert Unauthorized();
        if (msg.value == 0) revert InvalidConfiguration();
        uint256 supply = eligibleRewardSupply();
        if (supply == 0) revert InvalidConfiguration();
        magnifiedRewardPerShare += (msg.value * MAGNITUDE) / supply;
        totalRewardsDeposited += msg.value;
        emit RewardsDeposited(msg.value, supply, totalRewardsDeposited);
    }

    function accumulativeRewardOf(address account) public view returns (uint256) {
        if (isRewardExcluded[account]) return 0;
        int256 magnified = int256(magnifiedRewardPerShare * balanceOf(account)) + _magnifiedRewardCorrections[account];
        if (magnified <= 0) return 0;
        return uint256(magnified) / MAGNITUDE;
    }

    function claimableRewardOf(address account) public view returns (uint256) {
        uint256 accumulated = accumulativeRewardOf(account);
        uint256 withdrawn = withdrawnRewards[account];
        return accumulated > withdrawn ? accumulated - withdrawn : 0;
    }

    function claimRewards() external returns (uint256 amount) {
        return _claim(msg.sender, payable(msg.sender));
    }

    function claimRewardsTo(address payable recipient) external returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidConfiguration();
        return _claim(msg.sender, recipient);
    }

    function _claim(address account, address payable recipient) private nonReentrant returns (uint256 amount) {
        if (isRewardExcluded[account]) revert RewardAccountExcluded();
        amount = claimableRewardOf(account);
        if (amount == 0) revert NothingToClaim();
        withdrawnRewards[account] += amount;
        totalRewardsClaimed += amount;
        (bool sent,) = recipient.call{value: amount}("");
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
        super._update(from, to, value);
        int256 correction = int256(magnifiedRewardPerShare * value);
        if (from != address(0)) _magnifiedRewardCorrections[from] += correction;
        if (to != address(0)) _magnifiedRewardCorrections[to] -= correction;
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
