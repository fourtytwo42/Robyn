// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { UniswapV3BondingCurveMarket } from "./UniswapV3BondingCurveMarket.sol";
import { UniswapV3GraduationAdapter } from "./UniswapV3GraduationAdapter.sol";

/// @notice Size-bounded creation helper controlled by one market factory.
contract UniswapV3MarketDeployer {
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
        RobynLaunchToken launchToken,
        FeeBasketVault feeVault,
        address marketOwner,
        UniswapV3BondingCurveMarket.CurveConfig memory curve,
        UniswapV3GraduationAdapter adapter
    ) external returns (UniswapV3BondingCurveMarket market) {
        if (msg.sender != controller) revert Unauthorized();
        market = new UniswapV3BondingCurveMarket(
            baseAsset, launchToken, feeVault, marketOwner, curve, adapter
        );
    }
}
