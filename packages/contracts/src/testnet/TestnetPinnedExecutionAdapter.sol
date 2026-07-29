// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRobynExecutionAdapter} from "../uniswap/IRobynExecutionAdapter.sol";
import {IRobynPriceGuard} from "../uniswap/IRobynPriceGuard.sol";

/// @notice Deterministic chain-46630 adapter used to exercise schema-12 provider routes.
/// @dev This contract is testnet-only and is forbidden from production manifests.
contract TestnetPinnedExecutionAdapter is IRobynExecutionAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant TESTNET_MOCK_ONLY = "schema12-deterministic-provider-adapter";
    uint256 private constant ONE = 1e18;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidPair();
    error InvalidAmount();
    error InvalidExecutionData();
    error DeadlineExpired();
    error InsufficientInventory();

    address public immutable router;
    address public immutable asset;
    address public immutable wrappedNative;
    address public immutable inventorySink;
    uint256 public immutable assetPerWrappedNativeX18;

    event TestnetProviderSwap(
        bytes32 indexed quoteId,
        address indexed sellToken,
        address indexed buyToken,
        address recipient,
        uint256 inputAmount,
        uint256 outputAmount
    );

    constructor(
        address router_,
        address asset_,
        address wrappedNative_,
        address inventorySink_,
        uint256 assetPerWrappedNativeX18_
    ) {
        if (
            router_ == address(0) || asset_ == address(0) || wrappedNative_ == address(0)
                || inventorySink_ == address(0) || asset_ == wrappedNative_ || assetPerWrappedNativeX18_ == 0
                || router_.code.length == 0 || asset_.code.length == 0 || wrappedNative_.code.length == 0
        ) revert InvalidConfiguration();
        router = router_;
        asset = asset_;
        wrappedNative = wrappedNative_;
        inventorySink = inventorySink_;
        assetPerWrappedNativeX18 = assetPerWrappedNativeX18_;
    }

    function quote(address sellToken, address buyToken, uint256 amountIn, bytes32 quoteId)
        external
        view
        returns (uint256 amountOut, bytes memory executionData)
    {
        amountOut = _quote(sellToken, buyToken, amountIn);
        executionData = abi.encode(quoteId, amountOut);
    }

    function execute(
        address sellToken,
        address buyToken,
        uint256 amountIn,
        uint256 minimumOutput,
        address recipient,
        uint256 deadline,
        bytes calldata providerCalldata
    ) external nonReentrant returns (uint256 amountOut) {
        if (msg.sender != router) revert Unauthorized();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0 || minimumOutput == 0 || recipient == address(0)) {
            revert InvalidAmount();
        }
        if (providerCalldata.length != 64) revert InvalidExecutionData();
        (bytes32 quoteId, uint256 quotedOutput) = abi.decode(providerCalldata, (bytes32, uint256));
        if (quoteId == bytes32(0)) revert InvalidExecutionData();
        amountOut = _quote(sellToken, buyToken, amountIn);
        if (quotedOutput != amountOut || amountOut < minimumOutput) revert InvalidExecutionData();

        IERC20 sell = IERC20(sellToken);
        IERC20 buy = IERC20(buyToken);
        // The deterministic fixture is pre-funded with both sides so it can
        // exercise the same adapter in both directions. Require the router's
        // input to be present, consume exactly that input, and leave the
        // remaining test inventory available for the opposite direction.
        if (sell.balanceOf(address(this)) < amountIn) revert InvalidAmount();
        if (buy.balanceOf(address(this)) < amountOut) revert InsufficientInventory();
        sell.safeTransfer(inventorySink, amountIn);
        buy.safeTransfer(recipient, amountOut);
        emit TestnetProviderSwap(quoteId, sellToken, buyToken, recipient, amountIn, amountOut);
    }

    function _quote(address sellToken, address buyToken, uint256 amountIn) private view returns (uint256 amountOut) {
        if (sellToken == wrappedNative && buyToken == asset) {
            return amountIn * assetPerWrappedNativeX18 / ONE;
        }
        if (sellToken == asset && buyToken == wrappedNative) {
            return amountIn * ONE / assetPerWrappedNativeX18;
        }
        revert InvalidPair();
    }
}

/// @notice Independent deterministic guard for the chain-46630 provider fixture.
/// @dev Mainnet provider routes require a separately qualified live onchain guard.
contract TestnetFixedRatePriceGuard is IRobynPriceGuard {
    string public constant TESTNET_MOCK_ONLY = "schema12-deterministic-price-guard";
    uint256 private constant ONE = 1e18;

    address public immutable asset;
    address public immutable wrappedNative;
    uint256 public immutable assetPerWrappedNativeX18;

    constructor(address asset_, address wrappedNative_, uint256 assetPerWrappedNativeX18_) {
        if (
            asset_ == address(0) || wrappedNative_ == address(0) || asset_ == wrappedNative_
                || assetPerWrappedNativeX18_ == 0 || asset_.code.length == 0 || wrappedNative_.code.length == 0
        ) revert TestnetPinnedExecutionAdapter.InvalidConfiguration();
        asset = asset_;
        wrappedNative = wrappedNative_;
        assetPerWrappedNativeX18 = assetPerWrappedNativeX18_;
    }

    function validate(address sellToken, address buyToken, uint256 amountIn, uint256 amountOut)
        external
        view
        returns (bool)
    {
        if (sellToken == wrappedNative && buyToken == asset) {
            return amountOut == amountIn * assetPerWrappedNativeX18 / ONE;
        }
        if (sellToken == asset && buyToken == wrappedNative) {
            return amountOut == amountIn * ONE / assetPerWrappedNativeX18;
        }
        return false;
    }
}
