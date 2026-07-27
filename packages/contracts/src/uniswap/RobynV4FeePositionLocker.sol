// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { RobynNativeProtocolFeeRouterV4 } from "./RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";
import { RobynV4FeeAndPhaseHook } from "./RobynV4FeeAndPhaseHook.sol";

interface IPositionManagerPermit2 is IPositionManager {
    function permit2() external view returns (IAllowanceTransfer);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Permanently owns one full-range v4 position and can collect fees without reducing principal.
contract RobynV4FeePositionLocker is IERC721Receiver, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "2.0.0";
    int24 public constant TICK_LOWER = -887_200;
    int24 public constant TICK_UPPER = 887_200;
    uint32 public constant TWAP_WINDOW = 5 minutes;
    uint32 public constant MAX_OBSERVATION_AGE = 15 minutes;
    uint24 public constant MAX_SPOT_TWAP_TICK_DEVIATION = 198;
    uint16 public constant MAX_PRICE_IMPACT_BPS = 100;
    uint16 public constant BPS = 10_000;
    uint24 public constant FEE_DENOMINATOR = 1_000_000;

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyInitialized();
    error NotInitialized();
    error LiquidityChanged(uint128 expected, uint128 actual);
    error NativeTransferFailed();
    error StaleObservation(uint256 age);
    error SpotTwapDeviation(uint256 ticks);
    error ExcessivePriceImpact(uint256 idealNative, uint256 quotedNative);
    error SaleTooLarge(uint256 quotedNative, uint256 maximumNative);
    error ResidualTooLarge(uint256 nativeResidual, uint256 tokenResidual);
    error NothingPending();

    IPositionManagerPermit2 public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    IPoolManager public immutable poolManager;
    IERC20 public immutable launchToken;
    address public immutable adapter;
    address payable public immutable treasury;
    address public immutable tokenSink;
    uint128 public immutable maximumNativeSaleOutput;
    uint256 public immutable maximumNativeResidual;
    uint256 public immutable maximumTokenResidual;
    PoolKey private _poolKey;
    RobynNativeProtocolFeeRouterV4 public feeRouter;

    uint256 public positionTokenId;
    uint128 public principalLiquidity;
    uint256 public tokenLiquidityUsed;
    uint256 public nativeLiquidityUsed;
    uint256 public principalNativeResidual;
    uint256 public principalTokenResidual;
    uint256 public pendingCollectedNativeFees;
    uint256 public pendingCollectedTokenFees;
    uint256 public cumulativeCollectedNativeFees;
    uint256 public cumulativeCollectedTokenFees;
    uint256 public cumulativeUnattributedNativeSwept;
    uint256 public cumulativeUnattributedTokenSwept;
    bool public initialized;

    event PositionLocked(
        bytes32 indexed poolId,
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 tokenUsed,
        uint256 nativeUsed
    );
    event FeesCollected(
        address indexed caller,
        uint256 nativeAmount,
        uint256 launchTokenAmount,
        uint128 unchangedLiquidity
    );
    event FeeRouterBound(address indexed feeRouter);
    event PrincipalResidualRecorded(uint256 nativeResidual, uint256 tokenResidual);
    event UnattributedNativeSwept(address indexed treasury, uint256 amount);
    event UnattributedTokenSwept(address indexed tokenSink, uint256 amount);

    constructor(
        IPositionManagerPermit2 positionManager_,
        IAllowanceTransfer permit2_,
        IPoolManager poolManager_,
        IERC20 launchToken_,
        PoolKey memory poolKey_,
        address adapter_,
        uint128 maximumNativeSaleOutput_,
        address payable treasury_,
        address tokenSink_,
        uint256 maximumNativeResidual_,
        uint256 maximumTokenResidual_
    ) {
        if (
            address(positionManager_) == address(0) || address(permit2_) == address(0)
                || address(poolManager_) == address(0) || address(launchToken_) == address(0)
                || adapter_ == address(0) || address(positionManager_).code.length == 0
                || address(permit2_).code.length == 0 || address(poolManager_).code.length == 0
                || address(launchToken_).code.length == 0
                || address(positionManager_.poolManager()) != address(poolManager_)
                || address(positionManager_.permit2()) != address(permit2_)
                || Currency.unwrap(poolKey_.currency0) != address(0)
                || Currency.unwrap(poolKey_.currency1) != address(launchToken_)
                || poolKey_.tickSpacing <= 0 || TICK_LOWER % poolKey_.tickSpacing != 0
                || TICK_UPPER % poolKey_.tickSpacing != 0 || maximumNativeSaleOutput_ == 0
                || treasury_ == address(0) || tokenSink_ == address(0)
                || tokenSink_.code.length == 0
        ) revert InvalidConfiguration();
        positionManager = positionManager_;
        permit2 = permit2_;
        poolManager = poolManager_;
        launchToken = launchToken_;
        adapter = adapter_;
        treasury = treasury_;
        tokenSink = tokenSink_;
        maximumNativeSaleOutput = maximumNativeSaleOutput_;
        maximumNativeResidual = maximumNativeResidual_;
        maximumTokenResidual = maximumTokenResidual_;
        _poolKey = poolKey_;
    }

    receive() external payable { }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function bindFeeRouter(RobynNativeProtocolFeeRouterV4 feeRouter_) external {
        if (msg.sender != adapter) revert Unauthorized();
        if (address(feeRouter) != address(0)) revert AlreadyInitialized();
        if (address(feeRouter_) == address(0) || address(feeRouter_).code.length == 0) {
            revert InvalidConfiguration();
        }
        feeRouter = feeRouter_;
        emit FeeRouterBound(address(feeRouter_));
    }

    // The adapter-only initializer is guarded and validates balances after the
    // position-manager interaction before committing immutable principal.
    // slither-disable-next-line reentrancy-balance,reentrancy-eth
    function mintAndLock(uint256 tokenAmount, uint256 minimumUseBps)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 tokenUsed, uint256 nativeUsed)
    {
        if (msg.sender != adapter) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        if (tokenAmount == 0 || msg.value == 0 || minimumUseBps == 0 || minimumUseBps > 10_000) {
            revert InvalidConfiguration();
        }
        if (launchToken.balanceOf(address(this)) < tokenAmount) revert InvalidConfiguration();

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(_poolKey.toId());
        if (sqrtPriceX96 == 0) revert InvalidConfiguration();
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            msg.value,
            tokenAmount
        );
        if (liquidity == 0) revert InvalidConfiguration();
        (uint256 requiredNative, uint256 requiredToken) = (
            SqrtPriceMath.getAmount0Delta(
                sqrtPriceX96, TickMath.getSqrtPriceAtTick(TICK_UPPER), liquidity, true
            ),
            SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtPriceAtTick(TICK_LOWER), sqrtPriceX96, liquidity, true
            )
        );
        if (
            requiredNative == 0 || requiredToken == 0 || requiredNative > msg.value
                || requiredToken > tokenAmount
        ) {
            revert InvalidConfiguration();
        }

        tokenId = positionManager.nextTokenId();
        uint256 nativeBefore = address(this).balance - msg.value;
        uint256 tokenBefore = launchToken.balanceOf(address(this)) - tokenAmount;
        launchToken.forceApprove(address(permit2), requiredToken);
        permit2.approve(
            address(launchToken), address(positionManager), uint160(requiredToken), type(uint48).max
        );
        positionManager.modifyLiquidities{ value: requiredNative }(
            _mintPlan(liquidity, uint128(requiredNative), uint128(requiredToken)), block.timestamp
        );
        permit2.approve(address(launchToken), address(positionManager), 0, 0);
        launchToken.forceApprove(address(permit2), 0);

        if (positionManager.ownerOf(tokenId) != address(this)) revert InvalidConfiguration();
        uint128 actualLiquidity = positionManager.getPositionLiquidity(tokenId);
        if (actualLiquidity != liquidity) revert LiquidityChanged(liquidity, actualLiquidity);
        nativeUsed = msg.value - (address(this).balance - nativeBefore);
        tokenUsed = tokenAmount - (launchToken.balanceOf(address(this)) - tokenBefore);
        if (tokenUsed * 10_000 < tokenAmount * minimumUseBps) {
            revert InvalidConfiguration();
        }
        uint256 nativeRefund = msg.value - nativeUsed;
        uint256 tokenResidual = tokenAmount - tokenUsed;
        if (nativeRefund > maximumNativeResidual || tokenResidual > maximumTokenResidual) {
            revert ResidualTooLarge(nativeRefund, tokenResidual);
        }
        principalNativeResidual = nativeRefund;
        principalTokenResidual = tokenResidual;
        emit PrincipalResidualRecorded(nativeRefund, tokenResidual);

        initialized = true;
        positionTokenId = tokenId;
        principalLiquidity = liquidity;
        tokenLiquidityUsed = tokenUsed;
        nativeLiquidityUsed = nativeUsed;
        emit PositionLocked(
            PoolId.unwrap(_poolKey.toId()), tokenId, liquidity, tokenUsed, nativeUsed
        );
    }

    function collectFees(uint128 minimumNative, uint128 minimumToken)
        external
        nonReentrant
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        if (!initialized) revert NotInitialized();
        uint128 beforeLiquidity = positionManager.getPositionLiquidity(positionTokenId);
        if (beforeLiquidity != principalLiquidity) {
            revert LiquidityChanged(principalLiquidity, beforeLiquidity);
        }
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = launchToken.balanceOf(address(this));
        positionManager.modifyLiquidities(
            _collectPlan(minimumNative, minimumToken), block.timestamp
        );
        uint128 afterLiquidity = positionManager.getPositionLiquidity(positionTokenId);
        if (afterLiquidity != principalLiquidity) {
            revert LiquidityChanged(principalLiquidity, afterLiquidity);
        }
        nativeAmount = address(this).balance - nativeBefore;
        tokenAmount = launchToken.balanceOf(address(this)) - tokenBefore;
        pendingCollectedNativeFees += nativeAmount;
        pendingCollectedTokenFees += tokenAmount;
        cumulativeCollectedNativeFees += nativeAmount;
        cumulativeCollectedTokenFees += tokenAmount;
        emit FeesCollected(msg.sender, nativeAmount, tokenAmount, afterLiquidity);
    }

    // Native value can only enter the adapter-bound canonical fee router.
    // slither-disable-next-line arbitrary-send-eth
    function routeCollectedNative(uint256 amount) external nonReentrant {
        if (address(feeRouter) == address(0) || amount == 0 || amount > pendingCollectedNativeFees)
        {
            revert InvalidConfiguration();
        }
        pendingCollectedNativeFees -= amount;
        feeRouter.routeNativeFees{ value: amount }(launchToken);
    }

    function convertCollectedToken(uint128 amount, uint256 minimumNativeOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeOut)
    {
        if (address(feeRouter) == address(0) || amount == 0 || amount > pendingCollectedTokenFees) {
            revert InvalidConfiguration();
        }
        _enforceSaleSafety(amount);
        pendingCollectedTokenFees -= amount;
        launchToken.forceApprove(address(feeRouter), amount);
        nativeOut =
            feeRouter.convertAndRouteLaunchFees(launchToken, amount, minimumNativeOut, deadline);
        launchToken.forceApprove(address(feeRouter), 0);
    }

    function unattributedNative() public view returns (uint256) {
        uint256 attributed = principalNativeResidual + pendingCollectedNativeFees;
        return address(this).balance > attributed ? address(this).balance - attributed : 0;
    }

    function unattributedLaunchTokens() public view returns (uint256) {
        uint256 attributed = principalTokenResidual + pendingCollectedTokenFees;
        uint256 balance = launchToken.balanceOf(address(this));
        return balance > attributed ? balance - attributed : 0;
    }

    function sweepUnattributedNative() external nonReentrant returns (uint256 amount) {
        amount = unattributedNative();
        if (amount == 0) revert NothingPending();
        cumulativeUnattributedNativeSwept += amount;
        _sendNative(treasury, amount);
        emit UnattributedNativeSwept(treasury, amount);
    }

    function sweepUnattributedLaunchTokens() external nonReentrant returns (uint256 amount) {
        amount = unattributedLaunchTokens();
        if (amount == 0) revert NothingPending();
        cumulativeUnattributedTokenSwept += amount;
        launchToken.safeTransfer(tokenSink, amount);
        emit UnattributedTokenSwept(tokenSink, amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(positionManager)) revert Unauthorized();
        return IERC721Receiver.onERC721Received.selector;
    }

    function _mintPlan(uint128 liquidity, uint128 nativeAmount, uint128 tokenAmount)
        private
        view
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.CLOSE_CURRENCY),
            uint8(Actions.CLOSE_CURRENCY)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            _poolKey,
            TICK_LOWER,
            TICK_UPPER,
            liquidity,
            nativeAmount,
            tokenAmount,
            address(this),
            bytes("")
        );
        params[1] = abi.encode(_poolKey.currency0);
        params[2] = abi.encode(_poolKey.currency1);
        return abi.encode(actions, params);
    }

    function _collectPlan(uint128 minimumNative, uint128 minimumToken)
        private
        view
        returns (bytes memory)
    {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(positionTokenId, uint256(0), minimumNative, minimumToken, bytes(""));
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1, address(this));
        return abi.encode(actions, params);
    }

    function _enforceSaleSafety(uint128 amount) private {
        bytes32 id = PoolId.unwrap(_poolKey.toId());
        RobynV4FeeAndPhaseHook hook = RobynV4FeeAndPhaseHook(payable(address(_poolKey.hooks)));
        RobynV4FeeAndPhaseHook.Observation memory latest = hook.latestObservation(id);
        uint256 latestAge = block.timestamp - uint256(latest.timestamp);
        if (latestAge > MAX_OBSERVATION_AGE) revert StaleObservation(latestAge);
        (int24 meanTick,) = hook.consult(id, TWAP_WINDOW);
        (uint160 sqrtPriceX96, int24 spotTick,,) = poolManager.getSlot0(_poolKey.toId());
        uint256 tickDeviation = spotTick >= meanTick
            ? uint256(uint24(spotTick - meanTick))
            : uint256(uint24(meanTick - spotTick));
        if (tickDeviation > MAX_SPOT_TWAP_TICK_DEVIATION) {
            revert SpotTwapDeviation(tickDeviation);
        }

        (uint256 quotedNative,) =
            feeRouter.assetRouter().quoteAssetToNative(address(launchToken), amount);
        if (quotedNative == 0 || quotedNative > maximumNativeSaleOutput) {
            revert SaleTooLarge(quotedNative, maximumNativeSaleOutput);
        }
        uint256 ratioX96 = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96);
        uint256 nativePerTokenX18 = Math.mulDiv(1e18, 1 << 96, ratioX96);
        uint256 idealNative = Math.mulDiv(amount, nativePerTokenX18, 1e18);
        uint256 feeAdjustedQuote =
            Math.mulDiv(quotedNative, FEE_DENOMINATOR, FEE_DENOMINATOR - _poolKey.fee);
        feeAdjustedQuote = Math.mulDiv(feeAdjustedQuote, BPS, BPS - hook.PROTOCOL_FEE_BPS());
        if (idealNative == 0 || feeAdjustedQuote * BPS < idealNative * (BPS - MAX_PRICE_IMPACT_BPS))
        {
            revert ExcessivePriceImpact(idealNative, quotedNative);
        }
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
    }
}
