// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Provider-neutral interface for a code-hash-pinned asset execution adapter.
interface IRobynExecutionAdapter {
    function asset() external view returns (address);
    function wrappedNative() external view returns (address);

    /// @dev The caller transfers `amountIn` of `sellToken` to the adapter before execution.
    /// The adapter must transfer the measured `buyToken` output to `recipient`.
    function execute(
        address sellToken,
        address buyToken,
        uint256 amountIn,
        uint256 minimumOutput,
        address recipient,
        uint256 deadline,
        bytes calldata providerCalldata
    ) external returns (uint256 amountOut);
}
