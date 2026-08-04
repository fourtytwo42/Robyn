// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

interface IRobynLegacyRewardToken {
    function claimRewardsTo(address payable recipient) external returns (uint256 amount);
}

/// @notice One beneficiary's non-transferable RDAO custody and delegation boundary.
/// @dev Deployed as deterministic EIP-1167 clones by RobynRdaoStaking.
contract RobynRdaoStakeEscrow {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error AlreadyInitialized();
    error InvalidConfiguration();

    IERC20 public token;
    address public manager;
    address public beneficiary;
    bool public initialized;

    event Initialized(address indexed token, address indexed manager, address indexed beneficiary);
    event DelegateChanged(address indexed delegatee);
    event PrincipalReleased(address indexed recipient, uint256 amount);
    event LegacyRewardsForwarded(address indexed recipient, uint256 amount);

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    function initialize(IERC20 token_, address manager_, address beneficiary_, address delegatee)
        external
    {
        if (initialized) revert AlreadyInitialized();
        if (
            address(token_) == address(0) || address(token_).code.length == 0
                || manager_ == address(0) || beneficiary_ == address(0) || delegatee == address(0)
        ) revert InvalidConfiguration();
        initialized = true;
        token = token_;
        manager = manager_;
        beneficiary = beneficiary_;
        IVotes(address(token_)).delegate(delegatee);
        emit Initialized(address(token_), manager_, beneficiary_);
        emit DelegateChanged(delegatee);
    }

    function setDelegate(address delegatee) external onlyManager {
        if (delegatee == address(0)) revert InvalidConfiguration();
        IVotes(address(token)).delegate(delegatee);
        emit DelegateChanged(delegatee);
    }

    function release(address recipient, uint256 amount) external onlyManager {
        if (recipient == address(0) || amount == 0) revert InvalidConfiguration();
        token.safeTransfer(recipient, amount);
        emit PrincipalReleased(recipient, amount);
    }

    function forwardLegacyRewards(address payable recipient)
        external
        onlyManager
        returns (uint256 amount)
    {
        if (recipient == address(0)) revert InvalidConfiguration();
        amount = IRobynLegacyRewardToken(address(token)).claimRewardsTo(recipient);
        emit LegacyRewardsForwarded(recipient, amount);
    }
}
