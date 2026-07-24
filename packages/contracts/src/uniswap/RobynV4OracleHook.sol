// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Observation-only v4 hook for registered Robyn launch pools.
contract RobynV4OracleHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint8 public constant OBSERVATION_CAPACITY = 64;
    string public constant CONTRACT_VERSION = "1.0.0";

    error Unauthorized();
    error AlreadyBound();
    error InvalidConfiguration();
    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error InsufficientHistory();

    struct Observation {
        uint32 timestamp;
        int24 tick;
        int56 tickCumulative;
    }

    IPoolManager public immutable poolManager;
    address public immutable initializer;
    address public registrar;
    mapping(bytes32 poolId => bool registered) public registeredPool;
    mapping(bytes32 poolId => uint8 count) public observationCount;
    mapping(bytes32 poolId => uint8 index) public observationIndex;
    mapping(bytes32 poolId => mapping(uint8 index => Observation observation)) private _observations;

    event RegistrarBound(address indexed registrar);
    event PoolRegistered(bytes32 indexed poolId);
    event ObservationRecorded(
        bytes32 indexed poolId, uint8 indexed index, uint32 timestamp, int24 tick, int56 cumulative
    );

    constructor(IPoolManager poolManager_) {
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidConfiguration();
        }
        poolManager = poolManager_;
        initializer = msg.sender;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: false,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
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

    function registerPool(PoolKey calldata key) external returns (bytes32 poolId) {
        if (msg.sender != registrar) revert Unauthorized();
        if (address(key.hooks) != address(this)) revert InvalidConfiguration();
        poolId = PoolId.unwrap(key.toId());
        if (registeredPool[poolId]) revert PoolAlreadyRegistered();
        registeredPool[poolId] = true;
        emit PoolRegistered(poolId);
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick) external returns (bytes4) {
        _requirePoolManager();
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (!registeredPool[poolId]) revert PoolNotRegistered();
        _write(poolId, tick);
        return IHooks.afterInitialize.selector;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        returns (bytes4, int128)
    {
        _requirePoolManager();
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (!registeredPool[poolId]) revert PoolNotRegistered();
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        _write(poolId, tick);
        return (IHooks.afterSwap.selector, 0);
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
        int56 currentCumulative = latest.tickCumulative + int56(latest.tick) * int56(uint56(now32 - latest.timestamp));
        Observation memory selected = _observationAtOrBefore(poolId, target, count, latestIndex);
        int56 targetCumulative =
            selected.tickCumulative + int56(selected.tick) * int56(uint56(target - selected.timestamp));
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
            uint8 index = uint8((uint16(latestIndex) + OBSERVATION_CAPACITY - offset) % OBSERVATION_CAPACITY);
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
        int56 cumulative =
            previous.tickCumulative + int56(previous.tick) * int56(uint56(timestamp - previous.timestamp));
        uint8 nextIndex = uint8((uint16(previousIndex) + 1) % OBSERVATION_CAPACITY);
        _observations[poolId][nextIndex] = Observation(timestamp, tick, cumulative);
        observationIndex[poolId] = nextIndex;
        if (count < OBSERVATION_CAPACITY) observationCount[poolId] = count + 1;
        emit ObservationRecorded(poolId, nextIndex, timestamp, tick, cumulative);
    }

    function _requirePoolManager() private view {
        if (msg.sender != address(poolManager)) revert Unauthorized();
    }
}
