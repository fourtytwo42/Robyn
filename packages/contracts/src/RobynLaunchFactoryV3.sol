// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRobynConversionRouter } from "./FeeBasketVault.sol";
import { RobynLaunchDeployerV2 } from "./RobynLaunchDeployerV2.sol";
import { RobynLaunchFactoryV2 } from "./RobynLaunchFactoryV2.sol";
import { IRobynRouteRegistry } from "./RobynRouteRegistry.sol";

/// @notice Fresh coordinator-only factory that rejects baskets without usable routes.
contract RobynLaunchFactoryV3 is RobynLaunchFactoryV2 {
    string public constant ROUTE_FACTORY_VERSION = "4.0.0";

    error RouteRegistryUnavailable();
    error AssetRouteUnavailable(uint256 index, address asset, bytes32 reason);

    IRobynRouteRegistry public immutable routeRegistry;

    constructor(
        IERC20 baseAsset_,
        IRobynConversionRouter conversionRouter_,
        RobynLaunchDeployerV2 launchDeployer_,
        uint256 minimumConversionBase_,
        uint256 maximumPendingDelay_
    )
        RobynLaunchFactoryV2(
            baseAsset_,
            conversionRouter_,
            launchDeployer_,
            minimumConversionBase_,
            maximumPendingDelay_
        )
    {
        if (address(conversionRouter_).code.length == 0) revert RouteRegistryUnavailable();
        routeRegistry = IRobynRouteRegistry(address(conversionRouter_));
    }

    function requireBasketRoutes(address[] calldata assets) external view {
        for (uint256 index; index < assets.length; ++index) {
            IRobynRouteRegistry.RouteStatus memory status =
                routeRegistry.routeStatus(address(baseAsset), assets[index]);
            if (!status.ready) {
                revert AssetRouteUnavailable(index, assets[index], status.reason);
            }
        }
    }
}
