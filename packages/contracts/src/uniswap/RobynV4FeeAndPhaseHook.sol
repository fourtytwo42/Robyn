// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { RobynNativeProtocolFeeRouterV4 } from "./RobynNativeProtocolFeeRouterV4.sol";

/// @notice Immutable one-percent fee and observation hook for registered Robyn launch pools.
contract RobynV4FeeAndPhaseHook is ReentrancyGuard {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    uint8 public constant OBSERVATION_CAPACITY = 64;
    uint16 public constant BPS = 10_000;
    uint16 public constant PROTOCOL_FEE_BPS = 100;
    uint32 public constant TWAP_WINDOW = 5 minutes;
    uint32 public constant MAX_OBSERVATION_AGE = 15 minutes;
    uint24 public constant MAX_SPOT_TWAP_TICK_DEVIATION = 198;
    uint16 public constant MAX_PRICE_IMPACT_BPS = 100;
    uint16 public constant MAX_CONVERSION_SLIPPAGE_BPS = 100;
    uint24 public constant FEE_DENOMINATOR = 1_000_000;
    string public constant CONTRACT_VERSION = "3.0.0";

    enum PoolPhase {
        Unregistered,
        Bonding,
        Graduating,
        Trading
    }

    error Unauthorized();
    error AlreadyBound();
    error InvalidConfiguration();
    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error InsufficientHistory();
    error InvalidAmount();
    error StaleObservation(uint256 age);
    error SpotTwapDeviation(uint256 ticks);
    error ExcessivePriceImpact(uint256 idealNative, uint256 quotedNative);
    error WeakMinimumOutput(uint256 supplied, uint256 required);
    error SaleTooLarge(uint256 quotedNative, uint256 maximumNative);
    error InvalidPhase(PoolPhase expected, PoolPhase actual);

    struct Observation {
        uint32 timestamp;
        int24 tick;
        int56 tickCumulative;
    }

    IPoolManager public immutable poolManager;
    RobynNativeProtocolFeeRouterV4 public immutable feeRouter;
    address public immutable initializer;
    address public immutable positionManager;
    bytes32 public immutable deploymentDomain;
    address public registrar;
    mapping(bytes32 poolId => bool registered) public registeredPool;
    mapping(bytes32 poolId => PoolPhase phase) public poolPhase;
    mapping(bytes32 poolId => address controller) public phaseController;
    mapping(bytes32 poolId => address token) public tokenByPoolId;
    mapping(address token => PoolKey key) private _poolKeys;
    mapping(address token => uint256 amount) public pendingNativeFees;
    mapping(address token => uint256 amount) public pendingTokenFees;
    mapping(address token => uint256 amount) public cumulativeNativeFees;
    mapping(address token => uint256 amount) public cumulativeTokenFees;
    mapping(bytes32 poolId => uint8 count) public observationCount;
    mapping(bytes32 poolId => uint8 index) public observationIndex;
    mapping(bytes32 poolId => mapping(uint8 index => Observation observation)) private
        _observations;

    event RegistrarBound(address indexed registrar);
    event PoolRegistered(bytes32 indexed poolId);
    event PoolPhaseChanged(bytes32 indexed poolId, address indexed token, PoolPhase phase);
    event ObservationRecorded(
        bytes32 indexed poolId, uint8 indexed index, uint32 timestamp, int24 tick, int56 cumulative
    );
    event ProtocolFeeAccrued(
        bytes32 indexed poolId,
        address indexed token,
        address indexed currency,
        uint256 amount,
        bool exactInput,
        bool zeroForOne
    );
    event NativeFeesSettled(address indexed token, address indexed caller, uint256 amount);
    event TokenFeesConverted(
        address indexed token, address indexed caller, uint256 tokenAmount, uint256 nativeOut
    );

    constructor(
        IPoolManager poolManager_,
        RobynNativeProtocolFeeRouterV4 feeRouter_,
        address initializer_,
        address positionManager_,
        bytes32 deploymentDomain_
    ) {
        if (
            address(poolManager_) == address(0) || address(poolManager_).code.length == 0
                || address(feeRouter_) == address(0) || address(feeRouter_).code.length == 0
                || initializer_ == address(0) || positionManager_ == address(0)
                || positionManager_.code.length == 0 || deploymentDomain_ == bytes32(0)
        ) {
            revert InvalidConfiguration();
        }
        poolManager = poolManager_;
        feeRouter = feeRouter_;
        initializer = initializer_;
        positionManager = positionManager_;
        deploymentDomain = deploymentDomain_;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: true,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    function bindRegistrar(address registrar_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (registrar != address(0)) revert AlreadyBound();
        if (registrar_ == address(0) || registrar_.code.length == 0) revert InvalidConfiguration();
        registrar = registrar_;
        emit RegistrarBound(registrar_);
    }

    function registerPool(PoolKey calldata key, address controller)
        external
        returns (bytes32 poolId)
    {
        if (msg.sender != registrar) revert Unauthorized();
        if (address(key.hooks) != address(this)) revert InvalidConfiguration();
        address token = Currency.unwrap(key.currency1);
        if (
            Currency.unwrap(key.currency0) != address(0) || token == address(0)
                || token.code.length == 0
        ) {
            revert InvalidConfiguration();
        }
        poolId = PoolId.unwrap(key.toId());
        if (registeredPool[poolId]) revert PoolAlreadyRegistered();
        if (controller == address(0) || controller.code.length == 0) revert InvalidConfiguration();
        registeredPool[poolId] = true;
        tokenByPoolId[poolId] = token;
        _poolKeys[token] = key;
        poolPhase[poolId] = PoolPhase.Bonding;
        phaseController[poolId] = controller;
        emit PoolRegistered(poolId);
        emit PoolPhaseChanged(poolId, token, PoolPhase.Bonding);
    }

    function beginGraduation(address token) external {
        bytes32 poolId = _poolIdForToken(token);
        if (msg.sender != phaseController[poolId]) revert Unauthorized();
        PoolPhase current = poolPhase[poolId];
        if (current != PoolPhase.Bonding) revert InvalidPhase(PoolPhase.Bonding, current);
        poolPhase[poolId] = PoolPhase.Graduating;
        emit PoolPhaseChanged(poolId, token, PoolPhase.Graduating);
    }

    function activateTrading(address token) external {
        bytes32 poolId = _poolIdForToken(token);
        if (msg.sender != phaseController[poolId]) revert Unauthorized();
        PoolPhase current = poolPhase[poolId];
        if (current != PoolPhase.Graduating) revert InvalidPhase(PoolPhase.Graduating, current);
        poolPhase[poolId] = PoolPhase.Trading;
        emit PoolPhaseChanged(poolId, token, PoolPhase.Trading);
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        returns (bytes4)
    {
        _requirePoolManager();
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (!registeredPool[poolId]) revert PoolNotRegistered();
        _write(poolId, tick);
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external returns (bytes4) {
        _requirePoolManager();
        bytes32 poolId = _registeredPoolId(key);
        PoolPhase current = poolPhase[poolId];
        if (current == PoolPhase.Graduating) {
            if (sender != positionManager) revert Unauthorized();
        } else if (current != PoolPhase.Trading) {
            revert InvalidPhase(PoolPhase.Trading, current);
        }
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requirePoolManager();
        bytes32 poolId = _registeredPoolId(key);
        PoolPhase current = poolPhase[poolId];
        if (current != PoolPhase.Trading) revert InvalidPhase(PoolPhase.Trading, current);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeDonate(address, PoolKey calldata key, uint256, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        _requirePoolManager();
        bytes32 poolId = _registeredPoolId(key);
        PoolPhase current = poolPhase[poolId];
        if (current != PoolPhase.Trading) revert InvalidPhase(PoolPhase.Trading, current);
        return IHooks.beforeDonate.selector;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external returns (bytes4, int128) {
        _requirePoolManager();
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (!registeredPool[poolId]) revert PoolNotRegistered();
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        _write(poolId, tick);

        return (IHooks.afterSwap.selector, _accrueProtocolFee(poolId, key, params, delta));
    }

    function settleNativeFees(IERC20 token, uint256 amount) external nonReentrant {
        address tokenAddress = address(token);
        if (amount == 0 || amount > pendingNativeFees[tokenAddress]) revert InvalidAmount();
        pendingNativeFees[tokenAddress] -= amount;
        feeRouter.routeNativeFees{ value: amount }(token);
        emit NativeFeesSettled(tokenAddress, msg.sender, amount);
    }

    function convertTokenFees(
        IERC20 token,
        uint128 amount,
        uint256 minimumNativeOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 nativeOut) {
        address tokenAddress = address(token);
        if (amount == 0 || amount > pendingTokenFees[tokenAddress]) revert InvalidAmount();
        _enforceSaleSafety(tokenAddress, amount, minimumNativeOut);
        pendingTokenFees[tokenAddress] -= amount;
        token.forceApprove(address(feeRouter), amount);
        nativeOut = feeRouter.convertAndRouteLaunchFees(token, amount, minimumNativeOut, deadline);
        token.forceApprove(address(feeRouter), 0);
        emit TokenFeesConverted(tokenAddress, msg.sender, amount, nativeOut);
    }

    function _accrueProtocolFee(
        bytes32 poolId,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta
    ) private returns (int128 feeDelta) {
        bool exactInput = params.amountSpecified < 0;
        int128 unspecifiedDelta = _unspecifiedDelta(params, delta);
        if (exactInput ? unspecifiedDelta <= 0 : unspecifiedDelta >= 0) revert InvalidAmount();
        uint256 transferred = _absoluteDelta(unspecifiedDelta);
        if (transferred == 0) revert InvalidAmount();
        uint256 fee =
            exactInput ? _ceilDiv(transferred * PROTOCOL_FEE_BPS, BPS) : _ceilDiv(transferred, 99);
        if (fee == 0 || fee > uint256(uint128(type(int128).max))) revert InvalidAmount();

        Currency currency = _unspecifiedCurrency(key, params);
        poolManager.take(currency, address(this), fee);
        address token = tokenByPoolId[poolId];
        address currencyAddress = Currency.unwrap(currency);
        if (currencyAddress == address(0)) {
            pendingNativeFees[token] += fee;
            cumulativeNativeFees[token] += fee;
        } else {
            if (currencyAddress != token) revert InvalidConfiguration();
            pendingTokenFees[token] += fee;
            cumulativeTokenFees[token] += fee;
        }
        emit ProtocolFeeAccrued(poolId, token, currencyAddress, fee, exactInput, params.zeroForOne);
        return int128(uint128(fee));
    }

    function poolKey(address token) external view returns (PoolKey memory) {
        PoolKey memory key = _poolKeys[token];
        if (Currency.unwrap(key.currency1) == address(0)) revert PoolNotRegistered();
        return key;
    }

    function latestObservation(bytes32 poolId) external view returns (Observation memory) {
        uint8 count = observationCount[poolId];
        if (count == 0) revert InsufficientHistory();
        return _observations[poolId][observationIndex[poolId]];
    }

    function observation(bytes32 poolId, uint8 index) external view returns (Observation memory) {
        if (index >= OBSERVATION_CAPACITY) revert InvalidConfiguration();
        return _observations[poolId][index];
    }

    // Signed remainder correction implements Uniswap-style negative tick
    // rounding; it is deterministic arithmetic and not randomness.
    // slither-disable-next-line weak-prng
    function consult(bytes32 poolId, uint32 secondsAgo)
        external
        view
        returns (int24 arithmeticMeanTick, uint32 oldestAge)
    {
        if (secondsAgo == 0) revert InvalidConfiguration();
        uint8 count = observationCount[poolId];
        if (count < 2) revert InsufficientHistory();
        uint32 now32 = uint32(block.timestamp);
        uint32 target = now32 - secondsAgo;
        uint8 latestIndex = observationIndex[poolId];
        Observation memory latest = _observations[poolId][latestIndex];
        int56 currentCumulative =
            latest.tickCumulative + int56(latest.tick) * int56(uint56(now32 - latest.timestamp));
        Observation memory selected = _observationAtOrBefore(poolId, target, count, latestIndex);
        int56 targetCumulative = selected.tickCumulative + int56(selected.tick)
            * int56(uint56(target - selected.timestamp));
        int56 delta = currentCumulative - targetCumulative;
        int56 divisor = int56(uint56(secondsAgo));
        int56 quotient = delta / divisor;
        if (delta < 0 && delta % divisor != 0) --quotient;
        arithmeticMeanTick = int24(quotient);
        oldestAge = now32 - selected.timestamp;
    }

    function _observationAtOrBefore(bytes32 poolId, uint32 target, uint8 count, uint8 latestIndex)
        private
        view
        returns (Observation memory selected)
    {
        for (uint8 offset; offset < count; ++offset) {
            uint8 index =
                uint8((uint16(latestIndex) + OBSERVATION_CAPACITY - offset) % OBSERVATION_CAPACITY);
            Observation memory candidate = _observations[poolId][index];
            if (candidate.timestamp <= target) return candidate;
        }
        revert InsufficientHistory();
    }

    function _write(bytes32 poolId, int24 tick) private {
        uint32 timestamp = uint32(block.timestamp);
        uint8 count = observationCount[poolId];
        if (count == 0) {
            _observations[poolId][0] = Observation(timestamp, tick, 0);
            observationCount[poolId] = 1;
            emit ObservationRecorded(poolId, 0, timestamp, tick, 0);
            return;
        }
        uint8 previousIndex = observationIndex[poolId];
        Observation memory previous = _observations[poolId][previousIndex];
        if (previous.timestamp == timestamp) {
            previous.tick = tick;
            _observations[poolId][previousIndex] = previous;
            return;
        }
        int56 cumulative = previous.tickCumulative + int56(previous.tick)
            * int56(uint56(timestamp - previous.timestamp));
        uint8 nextIndex = uint8((uint16(previousIndex) + 1) % OBSERVATION_CAPACITY);
        _observations[poolId][nextIndex] = Observation(timestamp, tick, cumulative);
        observationIndex[poolId] = nextIndex;
        if (count < OBSERVATION_CAPACITY) observationCount[poolId] = count + 1;
        emit ObservationRecorded(poolId, nextIndex, timestamp, tick, cumulative);
    }

    function _enforceSaleSafety(address token, uint128 amount, uint256 minimumNativeOut) private {
        PoolKey memory key = _poolKeys[token];
        uint160 sqrtPriceX96 = _validatedSqrtPrice(PoolId.unwrap(key.toId()));
        _validateConversionQuote(token, amount, minimumNativeOut, sqrtPriceX96, key.fee);
    }

    function _validatedSqrtPrice(bytes32 poolId) private view returns (uint160 sqrtPriceX96) {
        Observation memory latest = _latestObservation(poolId);
        uint256 latestAge = block.timestamp - uint256(latest.timestamp);
        if (latestAge > MAX_OBSERVATION_AGE) revert StaleObservation(latestAge);
        (int24 meanTick,) = this.consult(poolId, TWAP_WINDOW);
        int24 spotTick;
        (sqrtPriceX96, spotTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        uint256 tickDeviation = spotTick >= meanTick
            ? uint256(uint24(spotTick - meanTick))
            : uint256(uint24(meanTick - spotTick));
        if (tickDeviation > MAX_SPOT_TWAP_TICK_DEVIATION) revert SpotTwapDeviation(tickDeviation);
    }

    function _validateConversionQuote(
        address token,
        uint128 amount,
        uint256 minimumNativeOut,
        uint160 sqrtPriceX96,
        uint24 poolFee
    ) private {
        (uint256 quotedNative,) = feeRouter.assetRouter().quoteAssetToNative(token, amount);
        uint256 maximumNative = feeRouter.assetRouter().routeStatus(token).maximumNativeInput;
        if (quotedNative == 0 || quotedNative > maximumNative) {
            revert SaleTooLarge(quotedNative, maximumNative);
        }
        uint256 requiredMinimum = Math.mulDiv(quotedNative, BPS - MAX_CONVERSION_SLIPPAGE_BPS, BPS);
        if (minimumNativeOut < requiredMinimum) {
            revert WeakMinimumOutput(minimumNativeOut, requiredMinimum);
        }

        uint256 ratioX96 = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96);
        uint256 idealNative = Math.mulDiv(amount, Math.mulDiv(1e18, 1 << 96, ratioX96), 1e18);
        uint256 adjustedQuote =
            Math.mulDiv(quotedNative, FEE_DENOMINATOR, FEE_DENOMINATOR - poolFee);
        adjustedQuote = Math.mulDiv(adjustedQuote, BPS, BPS - PROTOCOL_FEE_BPS);
        if (idealNative == 0 || adjustedQuote * BPS < idealNative * (BPS - MAX_PRICE_IMPACT_BPS)) {
            revert ExcessivePriceImpact(idealNative, quotedNative);
        }
    }

    function _latestObservation(bytes32 poolId) private view returns (Observation memory) {
        uint8 count = observationCount[poolId];
        if (count == 0) revert InsufficientHistory();
        return _observations[poolId][observationIndex[poolId]];
    }

    function _unspecifiedDelta(SwapParams calldata params, BalanceDelta delta)
        private
        pure
        returns (int128)
    {
        bool specifiedIsCurrency0 = params.zeroForOne == (params.amountSpecified < 0);
        return specifiedIsCurrency0 ? delta.amount1() : delta.amount0();
    }

    function _unspecifiedCurrency(PoolKey calldata key, SwapParams calldata params)
        private
        pure
        returns (Currency)
    {
        bool specifiedIsCurrency0 = params.zeroForOne == (params.amountSpecified < 0);
        return specifiedIsCurrency0 ? key.currency1 : key.currency0;
    }

    function _absoluteDelta(int128 value) private pure returns (uint256) {
        int256 widened = int256(value);
        return value >= 0 ? uint256(widened) : uint256(-widened);
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }

    function _requirePoolManager() private view {
        if (msg.sender != address(poolManager)) revert Unauthorized();
    }

    function _registeredPoolId(PoolKey calldata key) private view returns (bytes32 poolId) {
        poolId = PoolId.unwrap(key.toId());
        if (!registeredPool[poolId]) revert PoolNotRegistered();
    }

    function _poolIdForToken(address token) private view returns (bytes32 poolId) {
        PoolKey memory key = _poolKeys[token];
        if (Currency.unwrap(key.currency1) == address(0)) revert PoolNotRegistered();
        poolId = PoolId.unwrap(key.toId());
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert Unauthorized();
    }
}
