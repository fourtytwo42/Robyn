// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RobynLaunchToken} from "../RobynLaunchToken.sol";
import {RobynNativeBasketVaultV2} from "./RobynNativeBasketVaultV2.sol";
import {RobynV4BondingCurveMarket} from "./RobynV4BondingCurveMarket.sol";
import {RobynV4GraduationAdapter} from "./RobynV4GraduationAdapter.sol";

/// @notice Size-bounded bonding-market creation helper controlled by one market factory.
contract RobynV4MarketDeployer {
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
        RobynLaunchToken token,
        RobynNativeBasketVaultV2 vault,
        address creator,
        address seedAuthority,
        RobynV4BondingCurveMarket.CurveConfig memory curve,
        RobynV4GraduationAdapter adapter
    ) external returns (RobynV4BondingCurveMarket market) {
        if (msg.sender != controller) revert Unauthorized();
        market = new RobynV4BondingCurveMarket(token, vault, creator, seedAuthority, curve, adapter);
    }
}
