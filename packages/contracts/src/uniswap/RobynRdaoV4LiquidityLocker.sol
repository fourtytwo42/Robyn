// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { SafeCallback } from "@uniswap/v4-periphery/src/base/SafeCallback.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { IRobynRdaoGraduationFinalizer } from "../RobynRdaoBondingSale.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../RobynRdaoStaking.sol";

interface IRobynRdaoSaleIdentity {
    function rdao() external view returns (IERC20);
    function staking() external view returns (RobynRdaoStaking);
    function graduationFinalizer() external view returns (IRobynRdaoGraduationFinalizer);
}

/// @notice Permanently owns the canonical full-range RDAO/WETH v4 position.
contract RobynRdaoV4LiquidityLocker is
    SafeCallback,
    ReentrancyGuard,
    IRobynRdaoGraduationFinalizer
{
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    string public constant CONTRACT_VERSION = "1.0.0-schema20";
    uint24 public constant POOL_FEE_PIPS = 10_000;
    int24 public constant TICK_SPACING = 200;
    int24 public constant TICK_LOWER = -887_200;
    int24 public constant TICK_UPPER = 887_200;
    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_CONTINUITY_DEVIATION_BPS = 1;

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyInitialized();
    error NotInitialized();
    error SlippageExceeded(uint256 minimum, uint256 actual);
    error LiquidityChanged(uint128 expected, uint128 actual);
    error ResidualTooLarge(uint256 wethResidual, uint256 rdaoResidual);

    enum CallbackAction { ADD, COLLECT, SWAP_RDAO_FOR_WETH }

    struct LockResult {
        uint160 sqrtPriceX96;
        uint128 liquidity;
        uint256 wethUsed;
        uint256 rdaoUsed;
        uint256 wethResidual;
        uint256 rdaoResidual;
    }

    IERC20 public immutable rdao;
    IRobynWrappedNative public immutable weth;
    RobynRdaoStaking public immutable staking;
    address public immutable initializer;
    uint256 public immutable maximumWethResidual;
    uint256 public immutable maximumRdaoResidual;
    PoolKey private _poolKey;
    bytes32 public immutable poolId;
    bool public saleBound;
    bool public initialized;
    address public sale;
    uint128 public principalLiquidity;
    uint256 public principalWethUsed;
    uint256 public principalRdaoUsed;
    uint256 public lockedWethResidual;
    uint256 public lockedRdaoResidual;
    uint160 public initialSqrtPriceX96;
    uint256 public cumulativeWethFees;
    uint256 public cumulativeRdaoFees;
    uint256 public cumulativeRdaoConverted;
    uint256 public cumulativeWethRewardsDeposited;

    event SaleBound(address indexed sale);
    event LiquidityPermanentlyLocked(
        bytes32 indexed poolId,
        uint128 liquidity,
        uint256 wethUsed,
        uint256 rdaoUsed,
        uint256 wethResidual,
        uint256 rdaoResidual,
        uint160 sqrtPriceX96
    );
    event FeesHarvested(
        address indexed caller,
        uint256 wethFees,
        uint256 rdaoFees,
        uint256 rdaoConversionOutput,
        uint256 stakingDeposit,
        uint128 unchangedLiquidity
    );

    constructor(
        IPoolManager poolManager_,
        IERC20 rdao_,
        IRobynWrappedNative weth_,
        RobynRdaoStaking staking_,
        uint256 maximumWethResidual_,
        uint256 maximumRdaoResidual_
    ) SafeCallback(poolManager_) {
        if (
            address(poolManager_) == address(0) || address(poolManager_).code.length == 0
                || address(rdao_) == address(0) || address(rdao_).code.length == 0
                || address(weth_) == address(0) || address(weth_).code.length == 0
                || address(staking_) == address(0) || address(staking_).code.length == 0
        ) revert InvalidConfiguration();
        rdao = rdao_;
        weth = weth_;
        staking = staking_;
        initializer = msg.sender;
        maximumWethResidual = maximumWethResidual_;
        maximumRdaoResidual = maximumRdaoResidual_;
        (Currency currency0, Currency currency1) = address(rdao_) < address(weth_)
            ? (Currency.wrap(address(rdao_)), Currency.wrap(address(weth_)))
            : (Currency.wrap(address(weth_)), Currency.wrap(address(rdao_)));
        _poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: POOL_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        poolId = PoolId.unwrap(_poolKey.toId());
    }

    function bindSale(address sale_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (saleBound || sale_ == address(0) || sale_.code.length == 0) {
            revert InvalidConfiguration();
        }
        IRobynRdaoSaleIdentity selected = IRobynRdaoSaleIdentity(sale_);
        if (
            address(selected.rdao()) != address(rdao)
                || address(selected.staking()) != address(staking)
                || address(selected.graduationFinalizer()) != address(this)
        ) revert InvalidConfiguration();
        sale = sale_;
        saleBound = true;
        emit SaleBound(sale_);
    }

    function poolKey() external view returns (PoolKey memory) { return _poolKey; }

    function finalizeRdaoLiquidity(
        IERC20 rdao_,
        uint256 tokenAmount,
        uint256 terminalVirtualTokenReserve,
        uint256 terminalVirtualNativeReserve,
        address staking_
    ) external payable nonReentrant returns (bytes32 selectedPoolId, uint256 positionId) {
        if (msg.sender != sale) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        if (
            address(rdao_) != address(rdao) || staking_ != address(staking) || tokenAmount == 0
                || tokenAmount > type(uint128).max || msg.value == 0
                || terminalVirtualTokenReserve == 0 || terminalVirtualNativeReserve == 0
                || rdao.balanceOf(address(this)) != tokenAmount
        ) revert InvalidConfiguration();
        LockResult memory result = _createAndLock(
            tokenAmount, terminalVirtualTokenReserve, terminalVirtualNativeReserve
        );
        if (
            result.wethResidual > maximumWethResidual
                || result.rdaoResidual > maximumRdaoResidual
        ) {
            revert ResidualTooLarge(result.wethResidual, result.rdaoResidual);
        }
        initialized = true;
        principalLiquidity = result.liquidity;
        principalWethUsed = result.wethUsed;
        principalRdaoUsed = result.rdaoUsed;
        lockedWethResidual = result.wethResidual;
        lockedRdaoResidual = result.rdaoResidual;
        initialSqrtPriceX96 = result.sqrtPriceX96;
        if (result.wethResidual != 0) {
            IERC20(address(weth)).forceApprove(address(staking), result.wethResidual);
            staking.depositWrappedRewards(address(rdao), result.wethResidual);
            IERC20(address(weth)).forceApprove(address(staking), 0);
            lockedWethResidual = 0;
        }
        selectedPoolId = poolId;
        positionId = uint256(poolId);
        emit LiquidityPermanentlyLocked(
            poolId,
            result.liquidity,
            result.wethUsed,
            result.rdaoUsed,
            result.wethResidual,
            result.rdaoResidual,
            result.sqrtPriceX96
        );
    }

    function _createAndLock(
        uint256 tokenAmount,
        uint256 terminalVirtualTokenReserve,
        uint256 terminalVirtualNativeReserve
    ) private returns (LockResult memory result) {
        weth.deposit{ value: msg.value }();
        (uint256 amount0, uint256 amount1) = address(rdao) < address(weth)
            ? (tokenAmount, msg.value)
            : (msg.value, tokenAmount);
        result.sqrtPriceX96 = _curveSqrtPrice(
            terminalVirtualTokenReserve, terminalVirtualNativeReserve
        );
        _requireCurveContinuity(
            result.sqrtPriceX96, terminalVirtualTokenReserve, terminalVirtualNativeReserve
        );
        poolManager.initialize(_poolKey, result.sqrtPriceX96);
        result.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            result.sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            amount0,
            amount1
        );
        if (result.liquidity == 0) revert InvalidConfiguration();
        (uint256 used0, uint256 used1) = abi.decode(
            poolManager.unlock(abi.encode(CallbackAction.ADD, result.liquidity, uint128(0))),
            (uint256, uint256)
        );
        result.rdaoUsed = address(rdao) < address(weth) ? used0 : used1;
        result.wethUsed = address(rdao) < address(weth) ? used1 : used0;
        result.wethResidual = msg.value - result.wethUsed;
        result.rdaoResidual = tokenAmount - result.rdaoUsed;
    }

    function harvest(uint128 minimumWethFromRdao, uint256 deadline)
        external
        nonReentrant
        returns (uint256 stakingDeposit)
    {
        if (!initialized) revert NotInitialized();
        if (block.timestamp > deadline) revert InvalidConfiguration();
        uint256 wethBefore = IERC20(address(weth)).balanceOf(address(this));
        uint256 rdaoBefore = rdao.balanceOf(address(this));
        (uint256 amount0, uint256 amount1) = abi.decode(
            poolManager.unlock(abi.encode(CallbackAction.COLLECT, uint128(0), uint128(0))),
            (uint256, uint256)
        );
        uint256 rdaoFees = address(rdao) < address(weth) ? amount0 : amount1;
        uint256 wethFees = address(rdao) < address(weth) ? amount1 : amount0;
        if (
            rdao.balanceOf(address(this)) - rdaoBefore != rdaoFees
                || IERC20(address(weth)).balanceOf(address(this)) - wethBefore != wethFees
        ) revert InvalidConfiguration();
        uint256 converted;
        if (rdaoFees != 0) {
            if (rdaoFees > type(uint128).max) revert InvalidConfiguration();
            converted = abi.decode(
                poolManager.unlock(
                    abi.encode(
                        CallbackAction.SWAP_RDAO_FOR_WETH,
                        uint128(rdaoFees),
                        minimumWethFromRdao
                    )
                ),
                (uint256)
            );
            if (converted < minimumWethFromRdao) {
                revert SlippageExceeded(minimumWethFromRdao, converted);
            }
        } else if (minimumWethFromRdao != 0) {
            revert SlippageExceeded(minimumWethFromRdao, 0);
        }
        stakingDeposit = wethFees + converted;
        if (stakingDeposit != 0) {
            IERC20(address(weth)).forceApprove(address(staking), stakingDeposit);
            staking.depositWrappedRewards(address(rdao), stakingDeposit);
            IERC20(address(weth)).forceApprove(address(staking), 0);
        }
        uint128 currentLiquidity = principalLiquidity;
        cumulativeWethFees += wethFees;
        cumulativeRdaoFees += rdaoFees;
        cumulativeRdaoConverted += rdaoFees;
        cumulativeWethRewardsDeposited += stakingDeposit;
        emit FeesHarvested(
            msg.sender, wethFees, rdaoFees, converted, stakingDeposit, currentLiquidity
        );
    }

    function _unlockCallback(bytes calldata data) internal override returns (bytes memory) {
        (CallbackAction action, uint128 amount, uint128 minimumOutput) =
            abi.decode(data, (CallbackAction, uint128, uint128));
        if (action == CallbackAction.ADD) return _addLiquidity(amount);
        if (action == CallbackAction.COLLECT) return _collectFees();
        return _swapRdaoForWeth(amount, minimumOutput);
    }

    function _addLiquidity(uint128 liquidity) private returns (bytes memory) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );
        int128 signed0 = delta.amount0();
        int128 signed1 = delta.amount1();
        if (signed0 >= 0 || signed1 >= 0) revert InvalidConfiguration();
        uint256 amount0 = uint256(uint128(-signed0));
        uint256 amount1 = uint256(uint128(-signed1));
        _settle(_poolKey.currency0, amount0);
        _settle(_poolKey.currency1, amount1);
        return abi.encode(amount0, amount1);
    }

    function _collectFees() private returns (bytes memory) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 0,
                salt: bytes32(0)
            }),
            bytes("")
        );
        int128 signed0 = delta.amount0();
        int128 signed1 = delta.amount1();
        if (signed0 < 0 || signed1 < 0) revert InvalidConfiguration();
        uint256 amount0 = uint256(uint128(signed0));
        uint256 amount1 = uint256(uint128(signed1));
        if (amount0 != 0) poolManager.take(_poolKey.currency0, address(this), amount0);
        if (amount1 != 0) poolManager.take(_poolKey.currency1, address(this), amount1);
        uint128 currentLiquidity = poolManager.getLiquidity(PoolId.wrap(poolId));
        if (currentLiquidity != principalLiquidity) {
            revert LiquidityChanged(principalLiquidity, currentLiquidity);
        }
        return abi.encode(amount0, amount1);
    }

    function _swapRdaoForWeth(uint128 amount, uint128 minimumOutput)
        private
        returns (bytes memory)
    {
        bool zeroForOne = address(rdao) < address(weth);
        BalanceDelta delta = poolManager.swap(
            _poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(amount)),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            bytes("")
        );
        int128 signedInput = zeroForOne ? delta.amount0() : delta.amount1();
        int128 signedOutput = zeroForOne ? delta.amount1() : delta.amount0();
        if (signedInput >= 0 || signedOutput <= 0) revert InvalidConfiguration();
        uint256 input = uint256(uint128(-signedInput));
        uint256 output = uint256(uint128(signedOutput));
        if (input != amount || output < minimumOutput) {
            revert SlippageExceeded(minimumOutput, output);
        }
        _settle(Currency.wrap(address(rdao)), input);
        poolManager.take(Currency.wrap(address(weth)), address(this), output);
        return abi.encode(output);
    }

    function _settle(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _curveSqrtPrice(uint256 terminalRdaoReserve, uint256 terminalWethReserve)
        private
        view
        returns (uint160 selected)
    {
        uint256 ratioX192 = address(rdao) < address(weth)
            ? Math.mulDiv(terminalWethReserve, 1 << 192, terminalRdaoReserve)
            : Math.mulDiv(terminalRdaoReserve, 1 << 192, terminalWethReserve);
        uint256 squareRoot = Math.sqrt(ratioX192);
        if (squareRoot <= TickMath.MIN_SQRT_PRICE || squareRoot >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidConfiguration();
        }
        selected = uint160(squareRoot);
    }

    function _requireCurveContinuity(
        uint160 sqrtPriceX96,
        uint256 terminalRdaoReserve,
        uint256 terminalWethReserve
    ) private view {
        uint256 ratioX96 = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96);
        uint256 poolWethPerRdao = address(rdao) < address(weth)
            ? Math.mulDiv(ratioX96, 1e18, 1 << 96)
            : Math.mulDiv(1e18, 1 << 96, ratioX96);
        uint256 curveWethPerRdao =
            Math.mulDiv(terminalWethReserve, 1e18, terminalRdaoReserve);
        uint256 difference = poolWethPerRdao > curveWethPerRdao
            ? poolWethPerRdao - curveWethPerRdao
            : curveWethPerRdao - poolWethPerRdao;
        if (Math.mulDiv(difference, BPS, curveWethPerRdao) > MAX_CONTINUITY_DEVIATION_BPS) {
            revert InvalidConfiguration();
        }
    }
}
