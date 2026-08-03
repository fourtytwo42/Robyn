// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IRobynMaintenanceCoordinator {
    function taskGasLimit() external view returns (uint256);
    function processRewards(address token) external returns (bool succeeded);
}
