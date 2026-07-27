// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";
import { RobynV4GraduationAdapter } from "./RobynV4GraduationAdapter.sol";

/// @notice Size-bounded adapter creation helper controlled by one market factory.
contract RobynV4AdapterDeployer {
    error Unauthorized();
    error AlreadyBound();
    error InvalidController();

    address public immutable initializer;
    address public controller;

    struct Deployment {
        IERC20 launchToken;
        IPoolManager poolManager;
        IPositionManager positionManager;
        IAllowanceTransfer permit2;
        IStateView stateView;
        RobynV4AssetRouter assetRouter;
        IHooks hook;
        uint160 initialSqrtPriceX96;
        uint16 minimumUseBps;
        uint128 maximumNativeSwap;
    }

    constructor() {
        initializer = msg.sender;
    }

    function bindController(address controller_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (controller != address(0)) revert AlreadyBound();
        if (controller_ == address(0) || controller_.code.length == 0) revert InvalidController();
        controller = controller_;
    }

    function deploy(Deployment calldata deployment)
        external
        returns (RobynV4GraduationAdapter adapter)
    {
        if (msg.sender != controller) revert Unauthorized();
        adapter = new RobynV4GraduationAdapter(
            deployment.launchToken,
            deployment.poolManager,
            deployment.positionManager,
            deployment.permit2,
            deployment.stateView,
            deployment.assetRouter,
            deployment.hook,
            msg.sender,
            deployment.initialSqrtPriceX96,
            deployment.minimumUseBps,
            deployment.maximumNativeSwap
        );
    }
}
