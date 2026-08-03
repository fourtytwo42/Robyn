// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RobynLaunchToken} from "./RobynLaunchToken.sol";
import {IRobynMaintenanceCoordinator} from "./interfaces/IRobynMaintenanceCoordinator.sol";

/// @notice Holder-paid claim entry point that never lets maintenance failure undo a claim.
contract RobynClaimsRouter is ReentrancyGuard {
    string public constant CONTRACT_VERSION = "1.0.0-schema19";

    error InvalidConfiguration();

    IRobynMaintenanceCoordinator public immutable maintenanceCoordinator;
    uint256 public immutable maintenanceCallGasLimit;

    event HolderRewardsClaimed(
        address indexed token, address indexed account, uint256 claimed, bool maintenanceCallSucceeded
    );

    constructor(IRobynMaintenanceCoordinator maintenanceCoordinator_, uint256 maintenanceCallGasLimit_) {
        if (
            address(maintenanceCoordinator_) == address(0) || address(maintenanceCoordinator_).code.length == 0
                || maintenanceCallGasLimit_ < 50_000
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
