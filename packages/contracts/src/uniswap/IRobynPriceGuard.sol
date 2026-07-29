// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Independent onchain price guard for provider-executed asset routes.
interface IRobynPriceGuard {
    function validate(address sellToken, address buyToken, uint256 amountIn, uint256 amountOut)
        external
        view
        returns (bool);
}
