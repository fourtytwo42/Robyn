// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { UniswapV3GraduationAdapter } from "./UniswapV3GraduationAdapter.sol";

/// @notice Size-bounded creation helper controlled by one market factory.
contract UniswapV3AdapterDeployer {
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
        if (controller_ == address(0) || controller_.code.length == 0) {
            revert InvalidController();
        }
        controller = controller_;
    }

    function deploy(
        IERC20 baseAsset,
        IERC20 launchToken,
        FeeBasketVault feeVault,
        UniswapV3GraduationAdapter.AdapterConfig memory config
    ) external returns (UniswapV3GraduationAdapter adapter) {
        if (msg.sender != controller) revert Unauthorized();
        adapter =
            new UniswapV3GraduationAdapter(baseAsset, launchToken, feeVault, msg.sender, config);
    }
}
