// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { SafeCallback } from "@uniswap/v4-periphery/src/base/SafeCallback.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

/// @notice Governance-controlled registry and bounded single-hop v4 executor for ETH basket routes.
contract RobynV4AssetRouter is SafeCallback, ReentrancyGuard {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "1.2.0";
    uint16 public constant BPS = 10_000;
    uint24 public constant FEE_DENOMINATOR = 1_000_000;
    uint16 public constant MAX_PROTECTED_ROUTE_SLIPPAGE_BPS = 100;

    error Unauthorized();
    error AlreadyBound();
    error InvalidConfiguration();
    error RouteUnavailable(address asset);
    error InvalidAmount();
    error WeakMinimumOutput(uint256 supplied, uint256 required);
    error ExcessivePriceImpact(uint256 idealOutput, uint256 quotedOutput);
    error DeadlineExpired();
    error NativeTransferFailed();

    struct Route {
        uint24 fee;
        int24 tickSpacing;
        IHooks hooks;
        uint128 minimumLiquidity;
        uint128 maximumNativeInput;
        int24 referenceTick;
        uint24 maximumReferenceTickDeviation;
        bool enforceReferencePrice;
        bytes32 verificationClass;
        bool enabled;
    }

    struct RouteStatus {
        bytes32 poolId;
        uint128 liquidity;
        uint128 minimumLiquidity;
        uint128 maximumNativeInput;
        int24 spotTick;
        int24 referenceTick;
        uint24 maximumReferenceTickDeviation;
        bool enforceReferencePrice;
        bytes32 verificationClass;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        bool ready;
        bytes32 reason;
    }

    bytes32 public constant REASON_NOT_CONFIGURED = keccak256("ROUTE_NOT_CONFIGURED");
    bytes32 public constant REASON_DISABLED = keccak256("ROUTE_DISABLED");
    bytes32 public constant REASON_UNINITIALIZED = keccak256("POOL_UNINITIALIZED");
    bytes32 public constant REASON_THIN_LIQUIDITY = keccak256("INSUFFICIENT_LIQUIDITY");
    bytes32 public constant REASON_REFERENCE_PRICE_DEVIATION =
        keccak256("REFERENCE_PRICE_DEVIATION");

    address public immutable governor;
    address public immutable initializer;
    address public launchRegistrar;
    IV4Quoter public immutable quoter;
    IStateView public immutable stateView;
    mapping(address asset => Route route) private _routes;

    event LaunchRegistrarBound(address indexed registrar);
    event RouteConfigured(
        address indexed asset,
        bytes32 indexed poolId,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint128 minimumLiquidity,
        uint128 maximumNativeInput,
        int24 referenceTick,
        uint24 maximumReferenceTickDeviation,
        bool enforceReferencePrice,
        bytes32 verificationClass,
        bool enabled
    );
    event AssetSwap(
        address indexed caller,
        address indexed asset,
        address indexed recipient,
        bool nativeToAsset,
        uint256 inputAmount,
        uint256 outputAmount
    );

    constructor(
        IPoolManager poolManager_,
        IV4Quoter quoter_,
        IStateView stateView_,
        address governor_
    ) SafeCallback(poolManager_) {
        if (
            address(poolManager_) == address(0) || address(quoter_) == address(0)
                || address(stateView_) == address(0) || governor_ == address(0)
                || address(poolManager_).code.length == 0 || address(quoter_).code.length == 0
                || address(stateView_).code.length == 0
        ) revert InvalidConfiguration();
        quoter = quoter_;
        stateView = stateView_;
        governor = governor_;
        initializer = msg.sender;
    }

    receive() external payable { }

    function bindLaunchRegistrar(address registrar) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (launchRegistrar != address(0)) revert AlreadyBound();
        if (registrar == address(0) || registrar.code.length == 0) revert InvalidConfiguration();
        launchRegistrar = registrar;
        emit LaunchRegistrarBound(registrar);
    }

    function configureRoute(address asset, Route calldata route_) external {
        if (msg.sender != governor && (msg.sender != initializer || launchRegistrar != address(0)))
        {
            revert Unauthorized();
        }
        _configureRoute(asset, route_);
    }

    function _configureRoute(address asset, Route calldata route_) private {
        if (
            asset == address(0) || asset.code.length == 0 || route_.fee == 0
                || route_.tickSpacing <= 0 || route_.minimumLiquidity == 0
                || route_.maximumNativeInput == 0 || route_.fee >= FEE_DENOMINATOR
                || (route_.enforceReferencePrice && route_.maximumReferenceTickDeviation == 0)
                || (!route_.enforceReferencePrice
                    && (route_.referenceTick != 0 || route_.maximumReferenceTickDeviation != 0))
        ) revert InvalidConfiguration();
        _routes[asset] = route_;
        emit RouteConfigured(
            asset,
            PoolId.unwrap(_poolKey(asset, route_).toId()),
            route_.fee,
            route_.tickSpacing,
            address(route_.hooks),
            route_.minimumLiquidity,
            route_.maximumNativeInput,
            route_.referenceTick,
            route_.maximumReferenceTickDeviation,
            route_.enforceReferencePrice,
            route_.verificationClass,
            route_.enabled
        );
    }

    function configureLaunchRoute(address asset, Route calldata route_) external {
        if (msg.sender != launchRegistrar) revert Unauthorized();
        _configureRoute(asset, route_);
    }

    function route(address asset) external view returns (Route memory) {
        return _routes[asset];
    }

    function poolKey(address asset) external view returns (PoolKey memory) {
        Route memory configured = _routes[asset];
        if (configured.fee == 0) revert RouteUnavailable(asset);
        return _poolKey(asset, configured);
    }

    function routeStatus(address asset) public view returns (RouteStatus memory status) {
        Route memory configured = _routes[asset];
        status.fee = configured.fee;
        status.tickSpacing = configured.tickSpacing;
        status.hooks = address(configured.hooks);
        status.minimumLiquidity = configured.minimumLiquidity;
        status.maximumNativeInput = configured.maximumNativeInput;
        status.referenceTick = configured.referenceTick;
        status.maximumReferenceTickDeviation = configured.maximumReferenceTickDeviation;
        status.enforceReferencePrice = configured.enforceReferencePrice;
        status.verificationClass = configured.verificationClass;
        if (configured.fee == 0) {
            status.reason = REASON_NOT_CONFIGURED;
            return status;
        }
        PoolId id = _poolKey(asset, configured).toId();
        status.poolId = PoolId.unwrap(id);
        (uint160 sqrtPriceX96, int24 spotTick,,) = stateView.getSlot0(id);
        status.spotTick = spotTick;
        if (sqrtPriceX96 == 0) {
            status.reason = REASON_UNINITIALIZED;
            return status;
        }
        status.liquidity = stateView.getLiquidity(id);
        if (!configured.enabled) {
            status.reason = REASON_DISABLED;
            return status;
        }
        if (status.liquidity < configured.minimumLiquidity) {
            status.reason = REASON_THIN_LIQUIDITY;
            return status;
        }
        if (
            configured.enforceReferencePrice
                && _absoluteTickDifference(spotTick, configured.referenceTick)
                    > configured.maximumReferenceTickDeviation
        ) {
            status.reason = REASON_REFERENCE_PRICE_DEVIATION;
            return status;
        }
        status.ready = true;
    }

    function quoteNativeToAsset(address asset, uint128 amountIn)
        external
        returns (uint256 amountOut, uint256 gasEstimate)
    {
        Route memory configured = _requireReady(asset, amountIn);
        return quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: _poolKey(asset, configured),
                zeroForOne: true,
                exactAmount: amountIn,
                hookData: bytes("")
            })
        );
    }

    function quoteAssetToNative(address asset, uint128 amountIn)
        external
        returns (uint256 amountOut, uint256 gasEstimate)
    {
        Route memory configured = _requireReady(asset, 0);
        return quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: _poolKey(asset, configured),
                zeroForOne: false,
                exactAmount: amountIn,
                hookData: bytes("")
            })
        );
    }

    function swapExactNativeForAsset(
        address asset,
        uint256 minimumOutput,
        address recipient,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 amountOut) {
        _checkDeadline(deadline);
        if (msg.value == 0 || msg.value > type(uint128).max || minimumOutput == 0) {
            revert InvalidAmount();
        }
        Route memory configured = _requireReady(asset, uint128(msg.value));
        if (configured.enforceReferencePrice) {
            (uint256 currentQuote,) = quoter.quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                    poolKey: _poolKey(asset, configured),
                    zeroForOne: true,
                    exactAmount: uint128(msg.value),
                    hookData: bytes("")
                })
            );
            (uint160 spotSqrtPriceX96,,,) = stateView.getSlot0(_poolKey(asset, configured).toId());
            uint256 idealOutput = _idealAssetOutput(uint128(msg.value), spotSqrtPriceX96);
            if (currentQuote < protectedQuoteFloor(idealOutput, configured.fee)) {
                revert ExcessivePriceImpact(idealOutput, currentQuote);
            }
            uint256 requiredMinimum =
                Math.mulDiv(currentQuote, BPS - MAX_PROTECTED_ROUTE_SLIPPAGE_BPS, BPS);
            if (minimumOutput < requiredMinimum) {
                revert WeakMinimumOutput(minimumOutput, requiredMinimum);
            }
        }
        amountOut = _executeSwap(
            _poolKey(asset, configured), true, uint128(msg.value), minimumOutput, recipient
        );
        emit AssetSwap(msg.sender, asset, recipient, true, msg.value, amountOut);
    }

    function protectedQuoteFloor(uint256 idealOutput, uint24 fee) public pure returns (uint256) {
        if (fee >= FEE_DENOMINATOR) revert InvalidConfiguration();
        uint256 feeAdjustedIdeal = Math.mulDiv(idealOutput, FEE_DENOMINATOR - fee, FEE_DENOMINATOR);
        return Math.mulDiv(feeAdjustedIdeal, BPS - MAX_PROTECTED_ROUTE_SLIPPAGE_BPS, BPS);
    }

    function swapExactAssetForNative(
        address asset,
        uint128 amountIn,
        uint256 minimumOutput,
        address payable recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        _checkDeadline(deadline);
        if (amountIn == 0 || minimumOutput == 0 || recipient == address(0)) revert InvalidAmount();
        Route memory configured = _requireReady(asset, 0);
        amountOut =
            _executeSwap(_poolKey(asset, configured), false, amountIn, minimumOutput, recipient);
        emit AssetSwap(msg.sender, asset, recipient, false, amountIn, amountOut);
    }

    function _executeSwap(
        PoolKey memory key,
        bool zeroForOne,
        uint128 amountIn,
        uint256 minimumOutput,
        address recipient
    ) private returns (uint256 amountOut) {
        if (recipient == address(0) || minimumOutput > type(uint128).max) {
            revert InvalidConfiguration();
        }
        uint256 nativeBefore = address(this).balance - msg.value;
        bytes memory result = poolManager.unlock(
            abi.encode(key, zeroForOne, amountIn, minimumOutput, recipient, msg.sender)
        );
        amountOut = abi.decode(result, (uint256));
        uint256 refund = address(this).balance - nativeBefore;
        if (refund != 0) {
            (bool refunded,) = payable(msg.sender).call{ value: refund }("");
            if (!refunded) revert NativeTransferFailed();
        }
    }

    function _unlockCallback(bytes calldata data) internal override returns (bytes memory) {
        (
            PoolKey memory key,
            bool zeroForOne,
            uint128 amountIn,
            uint256 minimumOutput,
            address recipient,
            address payer
        ) = abi.decode(data, (PoolKey, bool, uint128, uint256, address, address));
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(amountIn)),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            bytes("")
        );
        int128 signedInput = zeroForOne ? delta.amount0() : delta.amount1();
        int128 signedOutput = zeroForOne ? delta.amount1() : delta.amount0();
        if (signedInput >= 0 || signedOutput <= 0) revert InvalidAmount();
        uint256 inputAmount = uint256(uint128(-signedInput));
        uint256 amountOut = uint256(uint128(signedOutput));
        if (amountOut < minimumOutput) revert InvalidAmount();
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        Currency output = zeroForOne ? key.currency1 : key.currency0;
        if (input.isAddressZero()) {
            poolManager.settle{ value: inputAmount }();
        } else {
            poolManager.sync(input);
            IERC20(Currency.unwrap(input))
                .safeTransferFrom(payer, address(poolManager), inputAmount);
            poolManager.settle();
        }
        poolManager.take(output, recipient, amountOut);
        return abi.encode(amountOut);
    }

    function _poolKey(address asset, Route memory configured)
        private
        pure
        returns (PoolKey memory)
    {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(asset),
            fee: configured.fee,
            tickSpacing: configured.tickSpacing,
            hooks: configured.hooks
        });
    }

    function _requireReady(address asset, uint128 nativeInput)
        private
        view
        returns (Route memory configured)
    {
        RouteStatus memory status = routeStatus(asset);
        if (!status.ready) revert RouteUnavailable(asset);
        configured = _routes[asset];
        if (nativeInput != 0 && nativeInput > configured.maximumNativeInput) {
            revert InvalidAmount();
        }
    }

    function _checkDeadline(uint256 deadline) private view {
        if (deadline < block.timestamp) revert DeadlineExpired();
    }

    function _absoluteTickDifference(int24 left, int24 right) private pure returns (uint24) {
        int256 difference = int256(left) - int256(right);
        return uint24(uint256(difference < 0 ? -difference : difference));
    }

    function _idealAssetOutput(uint128 nativeInput, uint160 sqrtPriceX96)
        private
        pure
        returns (uint256)
    {
        uint256 scaled = Math.mulDiv(nativeInput, sqrtPriceX96, 1 << 96);
        return Math.mulDiv(scaled, sqrtPriceX96, 1 << 96);
    }
}
