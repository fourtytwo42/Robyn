// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPositionManagerPermit2, RobynV4FeePositionLocker} from "./RobynV4FeePositionLocker.sol";

/// @notice Size-bounded immutable locker creation helper controlled by one market factory.
contract RobynV4LockerDeployer {
    error Unauthorized();
    error AlreadyBound();
    error InvalidController();

    address public immutable initializer;
    address public controller;

    constructor() {
        initializer = msg.sender;
    }

    function bindController(address controller_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (controller != address(0)) revert AlreadyBound();
        if (controller_ == address(0) || controller_.code.length == 0) revert InvalidController();
        controller = controller_;
    }

    function deploy(
        IPositionManagerPermit2 positionManager,
        IAllowanceTransfer permit2,
        IPoolManager poolManager,
        IERC20 launchToken,
        PoolKey memory key,
        address feeRecipient,
        uint128 maximumNativeSwap
    ) external returns (RobynV4FeePositionLocker locker) {
        if (msg.sender != controller) revert Unauthorized();
        locker = new RobynV4FeePositionLocker(
            positionManager, permit2, poolManager, launchToken, key, feeRecipient, maximumNativeSwap
        );
    }
}
