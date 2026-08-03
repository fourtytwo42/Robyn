// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RobynLaunchToken} from "./RobynLaunchToken.sol";
import {IRobynMaintenanceCoordinator} from "./interfaces/IRobynMaintenanceCoordinator.sol";

/// @notice Holder-paid claim entry point that never lets maintenance failure undo a claim.
contract RobynClaimsRouter is ReentrancyGuard {
    string public constant CONTRACT_VERSION = "1.0.0-schema19";
    uint256 public constant MAINTENANCE_CALL_OVERHEAD = 50_000;
    uint256 public constant MAXIMUM_MAINTENANCE_TASK_GAS = 2_000_000;

    error InvalidConfiguration();

    IRobynMaintenanceCoordinator public immutable maintenanceCoordinator;
    uint256 public immutable maintenanceCallGasLimit;

    event HolderRewardsClaimed(
        address indexed token, address indexed account, uint256 claimed, bool maintenanceCallSucceeded
    );

    constructor(IRobynMaintenanceCoordinator maintenanceCoordinator_, uint256 maintenanceCallGasLimit_) {
        uint256 taskGas = maintenanceCoordinator_.taskGasLimit();
        if (
            address(maintenanceCoordinator_) == address(0) || address(maintenanceCoordinator_).code.length == 0
                || taskGas < 100_000 || taskGas > MAXIMUM_MAINTENANCE_TASK_GAS
                || maintenanceCallGasLimit_ < taskGas + MAINTENANCE_CALL_OVERHEAD
                || maintenanceCallGasLimit_
                    > MAXIMUM_MAINTENANCE_TASK_GAS + MAINTENANCE_CALL_OVERHEAD
        ) revert InvalidConfiguration();
        maintenanceCoordinator = maintenanceCoordinator_;
        maintenanceCallGasLimit = maintenanceCallGasLimit_;
    }

    function claimAll(RobynLaunchToken token)
        external
        nonReentrant
        returns (uint256 claimed, bool maintenanceCallSucceeded)
    {
        if (address(token) == address(0) || address(token).code.length == 0) {
            revert InvalidConfiguration();
        }
        claimed = token.claimAllFor(msg.sender);
        (maintenanceCallSucceeded,) = address(maintenanceCoordinator).call{gas: maintenanceCallGasLimit}(
            abi.encodeCall(IRobynMaintenanceCoordinator.processRewards, (address(token)))
        );
        emit HolderRewardsClaimed(address(token), msg.sender, claimed, maintenanceCallSucceeded);
    }
}
