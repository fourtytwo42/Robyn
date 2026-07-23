// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Route readiness and quote surface used by atomic launches and keepers.
interface IRobynRouteRegistry {
    enum RouteKind {
        None,
        FixedTestnet,
        UniswapV3
    }

    struct RouteStatus {
        RouteKind kind;
        bool ready;
        address venue;
        uint24 poolFee;
        uint128 liquidity;
        uint256 fixedRateX18;
        bytes32 reason;
    }

    function routeStatus(address inputToken, address outputToken)
        external
        view
        returns (RouteStatus memory status);

    function isRouteReady(address inputToken, address outputToken) external view returns (bool);

    /// @dev Deliberately non-view because canonical Uniswap quoters simulate a swap by reverting.
    function quoteExactInput(address inputToken, address outputToken, uint256 amountIn)
        external
        returns (uint256 amountOut);
}
