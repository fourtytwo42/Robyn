// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INativeFeeConverter} from "../dao/INativeFeeConverter.sol";
import {IQuoterV2, ISwapRouter, IUniswapV3Factory, IUniswapV3Pool} from "./UniswapV3Interfaces.sol";

interface IWrappedNative is IERC20 {
    function withdraw(uint256 amount) external;
}

/// @notice Canonical-v3 fee conversion guarded by TWAP/spot agreement and bounded quoted impact.
contract UniswapV3NativeFeeConverter is INativeFeeConverter {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error AlreadyBound();
    error InvalidConfiguration();
    error InvalidDeadline();
    error MissingPool();
    error UnsafeMinimum(uint256 required, uint256 supplied);
    error TwapDeviation(int24 currentTick, int24 meanTick);
    error BalanceDeltaMismatch();

    IUniswapV3Factory public immutable factory;
    ISwapRouter public immutable swapRouter;
    IQuoterV2 public immutable quoter;
    IERC20 public immutable baseAsset;
    IWrappedNative public immutable wrappedNative;
    uint24 public immutable launchPoolFee;
    uint24 public immutable nativePoolFee;
    uint32 public immutable twapWindow;
    uint16 public immutable maximumPriceImpactBps;
    int24 public immutable maximumTickDeviation;
    address public immutable initializer;
    address public feeRouter;

    event FeeRouterBound(address indexed feeRouter);
    event FeeConverted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(
        IUniswapV3Factory factory_,
        ISwapRouter swapRouter_,
        IQuoterV2 quoter_,
        IERC20 baseAsset_,
        IWrappedNative wrappedNative_,
        uint24 launchPoolFee_,
        uint24 nativePoolFee_,
        uint32 twapWindow_,
        uint16 maximumPriceImpactBps_,
        int24 maximumTickDeviation_
    ) {
        if (
            address(factory_) == address(0) || address(swapRouter_) == address(0) || address(quoter_) == address(0)
                || address(baseAsset_) == address(0) || address(wrappedNative_) == address(0)
                || address(baseAsset_) == address(wrappedNative_) || launchPoolFee_ == 0 || nativePoolFee_ == 0
                || twapWindow_ == 0 || maximumPriceImpactBps_ > 1_000 || maximumTickDeviation_ <= 0
        ) revert InvalidConfiguration();
        factory = factory_;
        swapRouter = swapRouter_;
        quoter = quoter_;
        baseAsset = baseAsset_;
        wrappedNative = wrappedNative_;
        launchPoolFee = launchPoolFee_;
        nativePoolFee = nativePoolFee_;
        twapWindow = twapWindow_;
        maximumPriceImpactBps = maximumPriceImpactBps_;
        maximumTickDeviation = maximumTickDeviation_;
        initializer = msg.sender;
    }

    receive() external payable {
        if (msg.sender != address(wrappedNative)) revert Unauthorized();
    }

    function bindFeeRouter(address feeRouter_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (feeRouter != address(0)) revert AlreadyBound();
        if (feeRouter_ == address(0) || feeRouter_.code.length == 0) revert InvalidConfiguration();
        feeRouter = feeRouter_;
        emit FeeRouterBound(feeRouter_);
    }

    function convertBaseToNative(
        IERC20 baseAsset_,
        uint256 amount,
        uint256 minimumNativeOut,
        uint256 deadline,
        address payable recipient
    ) external returns (uint256 nativeOut) {
        _authorize(deadline);
        if (address(baseAsset_) != address(baseAsset) || recipient == address(0)) revert InvalidConfiguration();
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 wrappedBefore = wrappedNative.balanceOf(address(this));
        _swap(baseAsset, IERC20(address(wrappedNative)), nativePoolFee, amount, minimumNativeOut, address(this));
        nativeOut = wrappedNative.balanceOf(address(this)) - wrappedBefore;
        if (nativeOut < minimumNativeOut) revert BalanceDeltaMismatch();
        wrappedNative.withdraw(nativeOut);
        (bool sent,) = recipient.call{value: nativeOut}("");
        if (!sent) revert BalanceDeltaMismatch();
    }

    function convertLaunchToBase(
        IERC20 launchToken,
        IERC20 baseAsset_,
        uint256 amount,
        uint256 minimumBaseOut,
        uint256 deadline,
        address recipient
    ) external returns (uint256 baseOut) {
        _authorize(deadline);
        if (
            address(baseAsset_) != address(baseAsset) || address(launchToken) == address(baseAsset)
                || recipient == address(0)
        ) revert InvalidConfiguration();
        launchToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 beforeBalance = baseAsset.balanceOf(recipient);
        _swap(launchToken, baseAsset, launchPoolFee, amount, minimumBaseOut, recipient);
        baseOut = baseAsset.balanceOf(recipient) - beforeBalance;
        if (baseOut < minimumBaseOut) revert BalanceDeltaMismatch();
    }

    function minimumSafeOutput(IERC20 tokenIn, IERC20 tokenOut, uint24 fee, uint256 amount) public returns (uint256) {
        if (amount == 0) revert InvalidConfiguration();
        address pool = factory.getPool(address(tokenIn), address(tokenOut), fee);
        if (pool == address(0) || pool.code.length == 0) revert MissingPool();
        _assertTwap(pool);
        (uint256 quote,,,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: address(tokenIn), tokenOut: address(tokenOut), amountIn: amount, fee: fee, sqrtPriceLimitX96: 0
            })
        );
        return (quote * (10_000 - maximumPriceImpactBps)) / 10_000;
    }

    function _assertTwap(address pool) private view {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        (int56[] memory cumulatives,) = IUniswapV3Pool(pool).observe(secondsAgos);
        int56 delta = cumulatives[1] - cumulatives[0];
        int24 meanTick = int24(delta / int56(uint56(twapWindow)));
        if (delta < 0 && (delta % int56(uint56(twapWindow)) != 0)) --meanTick;
        (, int24 currentTick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 difference = currentTick > meanTick ? currentTick - meanTick : meanTick - currentTick;
        if (difference > maximumTickDeviation) revert TwapDeviation(currentTick, meanTick);
    }

    function _swap(IERC20 tokenIn, IERC20 tokenOut, uint24 fee, uint256 amount, uint256 minimumOut, address recipient)
        private
        returns (uint256 amountOut)
    {
        uint256 safeMinimum = minimumSafeOutput(tokenIn, tokenOut, fee, amount);
        if (minimumOut < safeMinimum) revert UnsafeMinimum(safeMinimum, minimumOut);
        tokenIn.forceApprove(address(swapRouter), amount);
        amountOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                fee: fee,
                recipient: recipient,
                amountIn: amount,
                amountOutMinimum: minimumOut,
                sqrtPriceLimitX96: 0
            })
        );
        tokenIn.forceApprove(address(swapRouter), 0);
        emit FeeConverted(address(tokenIn), address(tokenOut), amount, amountOut);
    }

    function _authorize(uint256 deadline) private view {
        if (msg.sender != feeRouter) revert Unauthorized();
        if (deadline < block.timestamp) revert InvalidDeadline();
    }
}
