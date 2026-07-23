// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { RobynProtocolFeeRouter } from "../dao/RobynProtocolFeeRouter.sol";
import {
    INonfungiblePositionManager,
    IQuoterV2,
    ISwapRouter,
    IUniswapV3Factory,
    IUniswapV3Pool
} from "./UniswapV3Interfaces.sol";
import { RewardFeePositionLocker } from "./RewardFeePositionLocker.sol";

/// @notice Market-bound Uniswap v3 graduation and post-graduation execution adapter.
contract UniswapV3GraduationAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    string public constant CONTRACT_VERSION = "1.0.0";

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidAmount();
    error BalanceDeltaMismatch();
    error PoolMismatch();
    error PoolAlreadyExists(address pool);
    error MarketAlreadyBound();
    error InsufficientLiquidityUse(uint256 minimum, uint256 actual);
    error GraduationPriceMismatch(uint256 curvePrice, uint256 configuredPoolPrice);

    struct MintOutcome {
        address graduatedPool;
        uint256 tokenId;
        uint128 liquidity;
        uint256 tokenUsed;
        uint256 baseUsed;
    }

    struct AdapterConfig {
        IUniswapV3Factory factory;
        INonfungiblePositionManager positionManager;
        ISwapRouter swapRouter;
        IQuoterV2 quoter;
        uint24 poolFee;
        int24 tickLower;
        int24 tickUpper;
        uint160 initialSqrtPriceX96;
        uint16 minimumUseBps;
        uint16 maximumPriceDeviationBps;
    }

    IERC20 public immutable baseAsset;
    IERC20 public immutable launchToken;
    FeeBasketVault public immutable feeVault;
    address public immutable marketBindingAuthority;
    address public bondingMarket;
    IUniswapV3Factory public immutable factory;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    IQuoterV2 public immutable quoter;
    uint24 public immutable poolFee;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;
    uint160 public immutable initialSqrtPriceX96;
    uint16 public immutable minimumUseBps;
    uint16 public immutable maximumPriceDeviationBps;
    RewardFeePositionLocker public immutable locker;

    address public immutable pool;
    uint256 public positionTokenId;
    uint128 public positionLiquidity;
    uint256 public tokenLiquidityUsed;
    uint256 public baseLiquidityUsed;
    bool public initialized;

    event LiquidityGraduated(
        address indexed pool,
        address indexed locker,
        uint256 indexed positionTokenId,
        uint128 liquidity,
        uint256 tokenUsed,
        uint256 baseUsed,
        uint256 tokenResidualLocked,
        uint256 baseResidualLocked
    );
    event PoolTrade(
        address indexed recipient,
        address indexed inputToken,
        uint256 inputAmount,
        uint256 outputAmount
    );

    constructor(
        IERC20 baseAsset_,
        IERC20 launchToken_,
        FeeBasketVault feeVault_,
        address marketBindingAuthority_,
        AdapterConfig memory config_
    ) {
        int24 tickSpacing = config_.factory.feeAmountTickSpacing(config_.poolFee);
        if (
            address(baseAsset_) == address(0) || address(launchToken_) == address(0)
                || address(feeVault_) == address(0) || marketBindingAuthority_ == address(0)
                || address(config_.factory) == address(0)
                || address(config_.positionManager) == address(0)
                || address(config_.swapRouter) == address(0)
                || address(config_.quoter) == address(0)
                || address(config_.factory).code.length == 0
                || address(config_.positionManager).code.length == 0
                || address(config_.swapRouter).code.length == 0
                || address(config_.quoter).code.length == 0 || config_.poolFee == 0
                || tickSpacing == 0 || config_.tickLower >= config_.tickUpper
                || config_.tickLower % tickSpacing != 0 || config_.tickUpper % tickSpacing != 0
                || config_.initialSqrtPriceX96 == 0 || config_.minimumUseBps == 0
                || config_.minimumUseBps > BPS || config_.maximumPriceDeviationBps > 1_000
                || address(feeVault_.baseAsset()) != address(baseAsset_)
                || address(feeVault_.launchToken()) != address(launchToken_)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchToken = launchToken_;
        feeVault = feeVault_;
        marketBindingAuthority = marketBindingAuthority_;
        factory = config_.factory;
        positionManager = config_.positionManager;
        swapRouter = config_.swapRouter;
        quoter = config_.quoter;
        poolFee = config_.poolFee;
        tickLower = config_.tickLower;
        tickUpper = config_.tickUpper;
        initialSqrtPriceX96 = config_.initialSqrtPriceX96;
        minimumUseBps = config_.minimumUseBps;
        maximumPriceDeviationBps = config_.maximumPriceDeviationBps;
        locker = new RewardFeePositionLocker(
            config_.positionManager,
            baseAsset_,
            launchToken_,
            feeVault_,
            address(this),
            config_.poolFee
        );
        address existingPool =
            config_.factory.getPool(address(baseAsset_), address(launchToken_), config_.poolFee);
        if (existingPool != address(0)) revert PoolAlreadyExists(existingPool);
        pool =
            config_.factory.createPool(address(baseAsset_), address(launchToken_), config_.poolFee);
        if (pool == address(0)) revert PoolMismatch();
    }

    function bindMarket(address bondingMarket_) external {
        if (msg.sender != marketBindingAuthority) revert Unauthorized();
        if (bondingMarket != address(0)) revert MarketAlreadyBound();
        if (bondingMarket_ == address(0) || bondingMarket_.code.length == 0) {
            revert InvalidConfiguration();
        }
        bondingMarket = bondingMarket_;
    }

    function bindFeeRouter(RobynProtocolFeeRouter feeRouter_) external {
        if (msg.sender != marketBindingAuthority) revert Unauthorized();
        locker.bindFeeRouter(feeRouter_);
    }

    function initialize(uint256 tokenAmount, uint256 baseAmount, uint256 finalCurvePriceX18)
        external
        nonReentrant
        returns (address graduatedPool, uint256 tokenId)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        if (tokenAmount == 0 || baseAmount == 0 || finalCurvePriceX18 == 0) {
            revert InvalidAmount();
        }
        uint256 configuredPrice = configuredBasePerTokenX18();
        uint256 difference = finalCurvePriceX18 > configuredPrice
            ? finalCurvePriceX18 - configuredPrice
            : configuredPrice - finalCurvePriceX18;
        if (Math.mulDiv(difference, BPS, finalCurvePriceX18) > maximumPriceDeviationBps) {
            revert GraduationPriceMismatch(finalCurvePriceX18, configuredPrice);
        }

        _pullLiquidity(tokenAmount, baseAmount);
        MintOutcome memory outcome = _mintLiquidity(tokenAmount, baseAmount);
        graduatedPool = outcome.graduatedPool;
        tokenId = outcome.tokenId;
        uint256 minimumTokenUsed = (tokenAmount * minimumUseBps) / BPS;
        uint256 minimumBaseUsed = (baseAmount * minimumUseBps) / BPS;
        if (outcome.tokenUsed < minimumTokenUsed) {
            revert InsufficientLiquidityUse(minimumTokenUsed, outcome.tokenUsed);
        }
        if (outcome.baseUsed < minimumBaseUsed) {
            revert InsufficientLiquidityUse(minimumBaseUsed, outcome.baseUsed);
        }

        uint256 tokenResidual = tokenAmount - outcome.tokenUsed;
        uint256 baseResidual = baseAmount - outcome.baseUsed;
        if (tokenResidual != 0) launchToken.safeTransfer(address(locker), tokenResidual);
        if (baseResidual != 0) baseAsset.safeTransfer(address(locker), baseResidual);

        positionTokenId = tokenId;
        positionLiquidity = outcome.liquidity;
        tokenLiquidityUsed = outcome.tokenUsed;
        baseLiquidityUsed = outcome.baseUsed;
        initialized = true;
        emit LiquidityGraduated(
            graduatedPool,
            address(locker),
            tokenId,
            outcome.liquidity,
            outcome.tokenUsed,
            outcome.baseUsed,
            tokenResidual,
            baseResidual
        );
    }

    function buyFor(address recipient, uint256 baseInput, uint256 minimumTokenOutput)
        external
        nonReentrant
        returns (uint256 tokenOutput)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (!initialized) revert NotInitialized();
        if (recipient == address(0) || baseInput == 0 || minimumTokenOutput == 0) {
            revert InvalidAmount();
        }
        baseAsset.safeTransferFrom(msg.sender, address(this), baseInput);
        baseAsset.forceApprove(address(swapRouter), baseInput);
        tokenOutput = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(baseAsset),
                tokenOut: address(launchToken),
                fee: poolFee,
                recipient: recipient,
                amountIn: baseInput,
                amountOutMinimum: minimumTokenOutput,
                sqrtPriceLimitX96: 0
            })
        );
        baseAsset.forceApprove(address(swapRouter), 0);
        emit PoolTrade(recipient, address(baseAsset), baseInput, tokenOutput);
    }

    function quoteBuy(uint256 baseInput)
        external
        returns (uint256 nominalFeeAmount, uint256 tokenOutput)
    {
        if (!initialized) revert NotInitialized();
        if (baseInput == 0) revert InvalidAmount();
        (tokenOutput,,,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: address(baseAsset),
                tokenOut: address(launchToken),
                amountIn: baseInput,
                fee: poolFee,
                sqrtPriceLimitX96: 0
            })
        );
        nominalFeeAmount = Math.mulDiv(baseInput, poolFee, 1_000_000);
    }

    function quoteSell(uint256 tokenInput)
        external
        returns (uint256 nominalFeeAmount, uint256 baseOutput)
    {
        if (!initialized) revert NotInitialized();
        if (tokenInput == 0) revert InvalidAmount();
        (baseOutput,,,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: address(launchToken),
                tokenOut: address(baseAsset),
                amountIn: tokenInput,
                fee: poolFee,
                sqrtPriceLimitX96: 0
            })
        );
        uint256 nominalTokenFee = Math.mulDiv(tokenInput, poolFee, 1_000_000);
        nominalFeeAmount = Math.mulDiv(nominalTokenFee, _spotBasePerTokenX18(), 1e18);
    }

    function sellFor(address recipient, uint256 tokenInput, uint256 minimumBaseOutput)
        external
        nonReentrant
        returns (uint256 baseOutput)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (!initialized) revert NotInitialized();
        if (recipient == address(0) || tokenInput == 0 || minimumBaseOutput == 0) {
            revert InvalidAmount();
        }
        launchToken.safeTransferFrom(msg.sender, address(this), tokenInput);
        launchToken.forceApprove(address(swapRouter), tokenInput);
        baseOutput = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(launchToken),
                tokenOut: address(baseAsset),
                fee: poolFee,
                recipient: recipient,
                amountIn: tokenInput,
                amountOutMinimum: minimumBaseOutput,
                sqrtPriceLimitX96: 0
            })
        );
        launchToken.forceApprove(address(swapRouter), 0);
        emit PoolTrade(recipient, address(launchToken), tokenInput, baseOutput);
    }

    function spotBasePerTokenX18() external view returns (uint256) {
        if (!initialized) revert NotInitialized();
        return _spotBasePerTokenX18();
    }

    function _spotBasePerTokenX18() private view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        return _basePerTokenX18(sqrtPriceX96);
    }

    function configuredBasePerTokenX18() public view returns (uint256) {
        return _basePerTokenX18(initialSqrtPriceX96);
    }

    function _basePerTokenX18(uint160 sqrtPriceX96) private view returns (uint256) {
        uint256 ratioX96 = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96);
        if (address(launchToken) < address(baseAsset)) {
            return Math.mulDiv(ratioX96, 1e18, 1 << 96);
        }
        return Math.mulDiv(1e18, 1 << 96, ratioX96);
    }

    function _ordered(uint256 tokenAmount, uint256 baseAmount)
        private
        view
        returns (address token0, address token1, uint256 amount0, uint256 amount1)
    {
        if (address(launchToken) < address(baseAsset)) {
            return (address(launchToken), address(baseAsset), tokenAmount, baseAmount);
        }
        return (address(baseAsset), address(launchToken), baseAmount, tokenAmount);
    }

    function _pullLiquidity(uint256 tokenAmount, uint256 baseAmount) private {
        uint256 tokenBefore = launchToken.balanceOf(address(this));
        uint256 baseBefore = baseAsset.balanceOf(address(this));
        launchToken.safeTransferFrom(msg.sender, address(this), tokenAmount);
        baseAsset.safeTransferFrom(msg.sender, address(this), baseAmount);
        if (
            launchToken.balanceOf(address(this)) - tokenBefore != tokenAmount
                || baseAsset.balanceOf(address(this)) - baseBefore != baseAmount
        ) revert BalanceDeltaMismatch();
    }

    function _mintLiquidity(uint256 tokenAmount, uint256 baseAmount)
        private
        returns (MintOutcome memory outcome)
    {
        (address token0, address token1, uint256 amount0, uint256 amount1) =
            _ordered(tokenAmount, baseAmount);
        outcome.graduatedPool = positionManager.createAndInitializePoolIfNecessary(
            token0, token1, poolFee, initialSqrtPriceX96
        );
        if (
            outcome.graduatedPool == address(0) || outcome.graduatedPool != pool
                || factory.getPool(token0, token1, poolFee) != outcome.graduatedPool
        ) revert PoolMismatch();

        launchToken.forceApprove(address(positionManager), tokenAmount);
        baseAsset.forceApprove(address(positionManager), baseAmount);
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            fee: poolFee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min: (amount0 * minimumUseBps) / BPS,
            amount1Min: (amount1 * minimumUseBps) / BPS,
            recipient: address(locker),
            deadline: block.timestamp
        });
        uint256 used0;
        uint256 used1;
        (outcome.tokenId, outcome.liquidity, used0, used1) = positionManager.mint(params);
        locker.bindPosition(outcome.tokenId);
        launchToken.forceApprove(address(positionManager), 0);
        baseAsset.forceApprove(address(positionManager), 0);
        (outcome.tokenUsed, outcome.baseUsed) =
            token0 == address(launchToken) ? (used0, used1) : (used1, used0);
    }
}
