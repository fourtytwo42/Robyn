// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SafeCallback} from "@uniswap/v4-periphery/src/base/SafeCallback.sol";

/// @notice Permanently locks minimal native-ETH liquidity for disclosed Robyn testnet mock assets.
/// @dev This test-only contract intentionally has no liquidity-removal, fee-collection, or rescue path.
contract RobynV4TestAssetLiquidityLocker is SafeCallback, ReentrancyGuard {
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE_PIPS = 10_000;
    int24 public constant TICK_SPACING = 200;
    int24 public constant TICK_LOWER = -887_200;
    int24 public constant TICK_UPPER = 887_200;
    uint160 public constant INITIAL_SQRT_PRICE_X96 = 1 << 96;
    string public constant TESTNET_ONLY = "robyn-v4-test-asset-liquidity-locker";

    error Unauthorized();
    error Sealed();
    error InvalidConfiguration();
    error NativeTransferFailed();

    struct LockedPosition {
        address asset;
        uint128 liquidity;
        uint256 nativeAmount;
        uint256 tokenAmount;
    }

    address public immutable initializer;
    bool public configurationSealed;
    mapping(bytes32 poolId => LockedPosition position) private _positions;

    event TestAssetLiquidityLocked(
        address indexed asset, bytes32 indexed poolId, uint128 liquidity, uint256 nativeAmount, uint256 tokenAmount
    );
    event ConfigurationSealed();

    constructor(IPoolManager poolManager_) SafeCallback(poolManager_) {
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidConfiguration();
        }
        initializer = msg.sender;
    }

    receive() external payable {}

    function seed(address asset, uint128 liquidity, uint256 maximumTokenInput)
        external
        payable
        nonReentrant
        returns (bytes32 poolId, uint256 nativeAmount, uint256 tokenAmount)
    {
        if (msg.sender != initializer) revert Unauthorized();
        if (configurationSealed) revert Sealed();
        if (asset == address(0) || asset.code.length == 0 || liquidity == 0 || maximumTokenInput == 0 || msg.value == 0)
        {
            revert InvalidConfiguration();
        }

        PoolKey memory key = _poolKey(asset);
        poolId = PoolId.unwrap(key.toId());
        if (_positions[poolId].asset != address(0)) revert InvalidConfiguration();

        uint256 nativeBefore = address(this).balance - msg.value;
        uint256 tokenBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), maximumTokenInput);
        poolManager.initialize(key, INITIAL_SQRT_PRICE_X96);
        (nativeAmount, tokenAmount) = abi.decode(poolManager.unlock(abi.encode(key, liquidity)), (uint256, uint256));

        _positions[poolId] =
            LockedPosition({asset: asset, liquidity: liquidity, nativeAmount: nativeAmount, tokenAmount: tokenAmount});

        uint256 tokenRefund = IERC20(asset).balanceOf(address(this)) - tokenBefore;
        if (tokenRefund != 0) IERC20(asset).safeTransfer(msg.sender, tokenRefund);
        uint256 nativeRefund = address(this).balance - nativeBefore;
        if (nativeRefund != 0) {
            (bool refunded,) = payable(msg.sender).call{value: nativeRefund}("");
            if (!refunded) revert NativeTransferFailed();
        }
        emit TestAssetLiquidityLocked(asset, poolId, liquidity, nativeAmount, tokenAmount);
    }

    function seal() external {
        if (msg.sender != initializer) revert Unauthorized();
        if (configurationSealed) revert Sealed();
        configurationSealed = true;
        emit ConfigurationSealed();
    }

    function position(bytes32 poolId) external view returns (LockedPosition memory) {
        return _positions[poolId];
    }

    function poolKey(address asset) external pure returns (PoolKey memory) {
        return _poolKey(asset);
    }

    function _unlockCallback(bytes calldata data) internal override returns (bytes memory) {
        (PoolKey memory key, uint128 liquidity) = abi.decode(data, (PoolKey, uint128));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );
        int128 nativeDelta = delta.amount0();
        int128 tokenDelta = delta.amount1();
        if (nativeDelta >= 0 || tokenDelta >= 0) revert InvalidConfiguration();
        uint256 nativeAmount = SafeCast.toUint256(-int256(nativeDelta));
        uint256 tokenAmount = SafeCast.toUint256(-int256(tokenDelta));
        poolManager.settle{value: nativeAmount}();
        poolManager.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), tokenAmount);
        poolManager.settle();
        return abi.encode(nativeAmount, tokenAmount);
    }

    function _poolKey(address asset) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(asset),
            fee: POOL_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }
}
