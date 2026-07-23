// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IRobynConversionRouter } from "../FeeBasketVault.sol";
import { IRobynRouteRegistry } from "../RobynRouteRegistry.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    IQuoterV2,
    ISwapRouter
} from "../uniswap/UniswapV3Interfaces.sol";

/// @notice Testnet-only hybrid router for deterministic mocks and funded direct V3 pools.
contract TestnetAssetConversionRouter is
    IRobynConversionRouter,
    IRobynRouteRegistry,
    Ownable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "2.0.0";
    string public constant TESTNET_MOCK_ONLY = "robyn-controlled-testnet-assets";
    bytes32 private constant REASON_NONE = bytes32("no-route");
    bytes32 private constant REASON_PAUSED = bytes32("paused");
    bytes32 private constant REASON_POOL = bytes32("pool-unavailable");
    bytes32 private constant REASON_LIQUIDITY = bytes32("low-liquidity");
    bytes32 private constant REASON_INVENTORY = bytes32("no-inventory");
    bytes32 private constant REASON_TWAP = bytes32("twap-unavailable");
    bytes32 private constant REASON_DEVIATION = bytes32("price-deviation");

    error InvalidConfiguration();
    error InvalidRoute();
    error RouteUnavailable();
    error Expired();
    error InsufficientOutput(uint256 minimum, uint256 actual);

    struct Route {
        RouteKind kind;
        bool paused;
        uint24 poolFee;
        uint32 twapWindow;
        int24 maximumTickDeviation;
        uint128 minimumLiquidity;
        uint256 fixedRateX18;
    }

    IUniswapV3Factory public immutable uniswapFactory;
    ISwapRouter public immutable swapRouter;
    IQuoterV2 public immutable quoter;
    mapping(address => mapping(address => Route)) public routes;

    event FixedRouteSet(address indexed inputToken, address indexed outputToken, uint256 rateX18);
    event UniswapRouteSet(
        address indexed inputToken,
        address indexed outputToken,
        uint24 poolFee,
        uint128 minimumLiquidity,
        uint32 twapWindow,
        int24 maximumTickDeviation
    );
    event RoutePauseSet(address indexed inputToken, address indexed outputToken, bool paused);
    event TestnetAssetSwap(
        address indexed inputToken,
        address indexed outputToken,
        address indexed recipient,
        RouteKind kind,
        uint256 inputAmount,
        uint256 outputAmount
    );

    constructor(
        address owner_,
        IUniswapV3Factory factory_,
        ISwapRouter swapRouter_,
        IQuoterV2 quoter_
    ) Ownable(owner_) {
        if (
            owner_ == address(0) || address(factory_) == address(0)
                || address(swapRouter_) == address(0) || address(quoter_) == address(0)
                || address(factory_).code.length == 0 || address(swapRouter_).code.length == 0
                || address(quoter_).code.length == 0
        ) revert InvalidConfiguration();
        uniswapFactory = factory_;
        swapRouter = swapRouter_;
        quoter = quoter_;
    }

    function setFixedRoute(address inputToken, address outputToken, uint256 rateX18)
        external
        onlyOwner
    {
        _validatePair(inputToken, outputToken);
        if (rateX18 == 0) revert InvalidRoute();
        routes[inputToken][outputToken] = Route({
            kind: RouteKind.FixedTestnet,
            paused: false,
            poolFee: 0,
            twapWindow: 0,
            maximumTickDeviation: 0,
            minimumLiquidity: 0,
            fixedRateX18: rateX18
        });
        emit FixedRouteSet(inputToken, outputToken, rateX18);
    }

    function setUniswapRoute(
        address inputToken,
        address outputToken,
        uint24 poolFee,
        uint128 minimumLiquidity,
        uint32 twapWindow,
        int24 maximumTickDeviation
    ) external onlyOwner {
        _validatePair(inputToken, outputToken);
        if (
            poolFee == 0 || minimumLiquidity == 0 || twapWindow == 0 || maximumTickDeviation <= 0
                || uniswapFactory.getPool(inputToken, outputToken, poolFee) == address(0)
        ) revert InvalidRoute();
        routes[inputToken][outputToken] = Route({
            kind: RouteKind.UniswapV3,
            paused: false,
            poolFee: poolFee,
            twapWindow: twapWindow,
            maximumTickDeviation: maximumTickDeviation,
            minimumLiquidity: minimumLiquidity,
            fixedRateX18: 0
        });
        emit UniswapRouteSet(
            inputToken, outputToken, poolFee, minimumLiquidity, twapWindow, maximumTickDeviation
        );
    }

    function setRoutePaused(address inputToken, address outputToken, bool paused)
        external
        onlyOwner
    {
        if (routes[inputToken][outputToken].kind == RouteKind.None) revert InvalidRoute();
        routes[inputToken][outputToken].paused = paused;
        emit RoutePauseSet(inputToken, outputToken, paused);
    }

    function routeStatus(address inputToken, address outputToken)
        public
        view
        returns (RouteStatus memory status)
    {
        Route memory route = routes[inputToken][outputToken];
        status.kind = route.kind;
        status.poolFee = route.poolFee;
        status.fixedRateX18 = route.fixedRateX18;
        if (route.kind == RouteKind.None) {
            status.reason = REASON_NONE;
            return status;
        }
        if (route.paused) {
            status.reason = REASON_PAUSED;
            return status;
        }
        if (route.kind == RouteKind.FixedTestnet) {
            status.ready =
                route.fixedRateX18 != 0 && IERC20(outputToken).balanceOf(address(this)) != 0;
            status.reason = status.ready
                ? bytes32(0)
                : route.fixedRateX18 == 0 ? REASON_NONE : REASON_INVENTORY;
            return status;
        }
        address poolAddress = uniswapFactory.getPool(inputToken, outputToken, route.poolFee);
        status.venue = poolAddress;
        if (poolAddress == address(0) || poolAddress.code.length == 0) {
            status.reason = REASON_POOL;
            return status;
        }
        (bool healthy, uint128 currentLiquidity, bytes32 reason) = _poolHealth(
            IUniswapV3Pool(poolAddress),
            route.minimumLiquidity,
            route.twapWindow,
            route.maximumTickDeviation
        );
        status.liquidity = currentLiquidity;
        if (!healthy) {
            status.reason = reason;
            return status;
        }
        status.ready = true;
    }

    function _poolHealth(
        IUniswapV3Pool pool,
        uint128 minimumLiquidity,
        uint32 twapWindow,
        int24 maximumTickDeviation
    ) private view returns (bool healthy, uint128 currentLiquidity, bytes32 reason) {
        try pool.liquidity() returns (uint128 liquidity_) {
            currentLiquidity = liquidity_;
        } catch {
            return (false, 0, REASON_POOL);
        }
        if (currentLiquidity < minimumLiquidity) {
            return (false, currentLiquidity, REASON_LIQUIDITY);
        }
        return _twapHealth(pool, currentLiquidity, twapWindow, maximumTickDeviation);
    }

    function _twapHealth(
        IUniswapV3Pool pool,
        uint128 currentLiquidity,
        uint32 twapWindow,
        int24 maximumTickDeviation
    ) private view returns (bool healthy, uint128 liquidity_, bytes32 reason) {
        liquidity_ = currentLiquidity;
        try pool.slot0() returns (
            uint160 sqrtPriceX96, int24 currentTick, uint16, uint16, uint16, uint8, bool unlocked
        ) {
            if (sqrtPriceX96 == 0 || !unlocked) return (false, liquidity_, REASON_POOL);
            uint32[] memory secondsAgos = new uint32[](2);
            secondsAgos[0] = twapWindow;
            try pool.observe(secondsAgos) returns (int56[] memory cumulatives, uint160[] memory) {
                int24 meanTick =
                    int24((cumulatives[1] - cumulatives[0]) / int56(uint56(twapWindow)));
                int24 deviation =
                    currentTick > meanTick ? currentTick - meanTick : meanTick - currentTick;
                if (deviation > maximumTickDeviation) return (false, liquidity_, REASON_DEVIATION);
                return (true, liquidity_, bytes32(0));
            } catch {
                return (false, liquidity_, REASON_TWAP);
            }
        } catch {
            return (false, liquidity_, REASON_POOL);
        }
    }

    function isRouteReady(address inputToken, address outputToken) external view returns (bool) {
        return routeStatus(inputToken, outputToken).ready;
    }

    function quoteExactInput(address inputToken, address outputToken, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        RouteStatus memory status = routeStatus(inputToken, outputToken);
        if (!status.ready || amountIn == 0) revert RouteUnavailable();
        if (status.kind == RouteKind.FixedTestnet) {
            amountOut = (amountIn * status.fixedRateX18) / 1e18;
            if (IERC20(outputToken).balanceOf(address(this)) < amountOut) {
                revert RouteUnavailable();
            }
            return amountOut;
        }
        (amountOut,,,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: inputToken,
                tokenOut: outputToken,
                amountIn: amountIn,
                fee: status.poolFee,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 outputAmount) {
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert Expired();
        RouteStatus memory status = routeStatus(inputToken, outputToken);
        if (!status.ready || amountIn == 0 || recipient == address(0)) revert RouteUnavailable();
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        if (status.kind == RouteKind.FixedTestnet) {
            outputAmount = (amountIn * status.fixedRateX18) / 1e18;
            if (outputAmount < minimumAmountOut) {
                revert InsufficientOutput(minimumAmountOut, outputAmount);
            }
            IERC20(outputToken).safeTransfer(recipient, outputAmount);
        } else {
            IERC20(inputToken).forceApprove(address(swapRouter), amountIn);
            outputAmount = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: inputToken,
                    tokenOut: outputToken,
                    fee: status.poolFee,
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minimumAmountOut,
                    sqrtPriceLimitX96: 0
                })
            );
            IERC20(inputToken).forceApprove(address(swapRouter), 0);
        }
        emit TestnetAssetSwap(
            inputToken, outputToken, recipient, status.kind, amountIn, outputAmount
        );
    }

    function _validatePair(address inputToken, address outputToken) private pure {
        if (inputToken == address(0) || outputToken == address(0) || inputToken == outputToken) {
            revert InvalidRoute();
        }
    }
}
