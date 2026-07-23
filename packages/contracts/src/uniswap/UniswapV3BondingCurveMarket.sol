// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FeeBasketVault} from "../FeeBasketVault.sol";
import {RobynLaunchToken} from "../RobynLaunchToken.sol";
import {RobynProtocolFeeRouter} from "../dao/RobynProtocolFeeRouter.sol";
import {INonfungiblePositionManager, IQuoterV2, ISwapRouter, IUniswapV3Factory} from "./UniswapV3Interfaces.sol";
import {UniswapV3GraduationAdapter} from "./UniswapV3GraduationAdapter.sol";

/// @notice Robyn launch curve that atomically graduates into locked canonical Uniswap v3 liquidity.
contract UniswapV3BondingCurveMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    string public constant CONTRACT_VERSION = "1.0.0";

    struct CurveConfig {
        uint256 curveTokenAllocation;
        uint256 graduationTokenAllocation;
        uint256 initialVirtualTokenReserve;
        uint256 initialVirtualBaseReserve;
        uint256 graduationThresholdBase;
        uint16 curveFeeBps;
    }

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAmount();
    error AlreadySeeded();
    error NotSeeded();
    error Slippage(uint256 minimum, uint256 actual);
    error CurveInventoryExceeded();
    error FeeRouterAlreadyBound();

    IERC20 public immutable baseAsset;
    RobynLaunchToken public immutable launchToken;
    FeeBasketVault public immutable feeVault;
    address public immutable marketOwner;
    uint256 public immutable curveTokenAllocation;
    uint256 public immutable graduationTokenAllocation;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualBaseReserve;
    uint256 public immutable graduationThresholdBase;
    uint16 public immutable feeBps;
    UniswapV3GraduationAdapter public immutable graduationAdapter;
    RobynProtocolFeeRouter public feeRouter;

    uint256 public virtualTokenReserve;
    uint256 public virtualBaseReserve;
    uint256 public realCurveTokenReserve;
    bool public seeded;
    bool public graduated;

    event LiquiditySeeded(address indexed provider, uint256 tokenAmount, uint256 baseAmount);
    event Bought(address indexed buyer, uint256 baseInput, uint256 feeAmount, uint256 tokenOutput);
    event Sold(address indexed seller, uint256 tokenInput, uint256 feeAmount, uint256 baseOutput);
    event CurveState(
        uint256 virtualTokenReserve, uint256 virtualBaseReserve, uint256 realCurveTokenReserve, uint256 progressBps
    );
    event Graduated(
        address indexed pool,
        address indexed locker,
        uint256 indexed positionTokenId,
        uint256 tokenLiquidity,
        uint256 baseLiquidity,
        uint256 finalCurvePrice
    );
    event FeeRouterBound(address indexed feeRouter);

    constructor(
        IERC20 baseAsset_,
        RobynLaunchToken launchToken_,
        FeeBasketVault feeVault_,
        address marketOwner_,
        CurveConfig memory curve_,
        UniswapV3GraduationAdapter graduationAdapter_
    ) {
        if (
            address(baseAsset_) == address(0) || address(launchToken_) == address(0) || address(feeVault_) == address(0)
                || marketOwner_ == address(0) || curve_.curveTokenAllocation == 0
                || curve_.graduationTokenAllocation == 0
                || curve_.initialVirtualTokenReserve <= curve_.curveTokenAllocation
                || curve_.initialVirtualBaseReserve == 0 || curve_.graduationThresholdBase == 0
                || curve_.curveFeeBps == 0 || curve_.curveFeeBps > 1_000
                || address(feeVault_.baseAsset()) != address(baseAsset_)
                || address(feeVault_.launchToken()) != address(launchToken_)
                || address(graduationAdapter_) == address(0) || address(graduationAdapter_).code.length == 0
                || address(graduationAdapter_.baseAsset()) != address(baseAsset_)
                || address(graduationAdapter_.launchToken()) != address(launchToken_)
                || address(graduationAdapter_.feeVault()) != address(feeVault_)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchToken = launchToken_;
        feeVault = feeVault_;
        marketOwner = marketOwner_;
        curveTokenAllocation = curve_.curveTokenAllocation;
        graduationTokenAllocation = curve_.graduationTokenAllocation;
        initialVirtualTokenReserve = curve_.initialVirtualTokenReserve;
        initialVirtualBaseReserve = curve_.initialVirtualBaseReserve;
        graduationThresholdBase = curve_.graduationThresholdBase;
        feeBps = curve_.curveFeeBps;
        graduationAdapter = graduationAdapter_;
    }

    function bindFeeRouter(RobynProtocolFeeRouter feeRouter_) external {
        if (msg.sender != marketOwner && msg.sender != graduationAdapter.marketBindingAuthority()) {
            revert Unauthorized();
        }
        if (address(feeRouter) != address(0)) revert FeeRouterAlreadyBound();
        if (seeded || address(feeRouter_) == address(0) || address(feeRouter_).code.length == 0) {
            revert InvalidConfiguration();
        }
        feeRouter = feeRouter_;
        emit FeeRouterBound(address(feeRouter_));
    }

    function seed(uint256 tokenAmount, uint256 baseAmount) external nonReentrant {
        if (msg.sender != marketOwner) revert Unauthorized();
        if (seeded) revert AlreadySeeded();
        if (tokenAmount != curveTokenAllocation + graduationTokenAllocation || baseAmount != 0) {
            revert InvalidAmount();
        }
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenAmount);
        virtualTokenReserve = initialVirtualTokenReserve;
        virtualBaseReserve = initialVirtualBaseReserve;
        realCurveTokenReserve = curveTokenAllocation;
        seeded = true;
        emit LiquiditySeeded(msg.sender, tokenAmount, 0);
        emit CurveState(virtualTokenReserve, virtualBaseReserve, realCurveTokenReserve, 0);
    }

    function graduatedPool() public view returns (address) {
        return graduationAdapter.pool();
    }

    function positionLocker() public view returns (address) {
        return address(graduationAdapter.locker());
    }

    function basePerToken() public view returns (uint256) {
        if (graduated) return graduationAdapter.spotBasePerTokenX18();
        return (virtualBaseReserve * 1e18) / virtualTokenReserve;
    }

    function baseRaised() public view returns (uint256) {
        if (graduated) return graduationThresholdBase;
        return virtualBaseReserve > initialVirtualBaseReserve ? virtualBaseReserve - initialVirtualBaseReserve : 0;
    }

    function graduationProgressBps() public view returns (uint256) {
        if (graduated) return BPS;
        uint256 progress = (baseRaised() * BPS) / graduationThresholdBase;
        return progress > BPS ? BPS : progress;
    }

    function quoteBuy(uint256 baseInput) public returns (uint256 feeAmount, uint256 tokenOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return graduationAdapter.quoteBuy(baseInput);
        if (baseInput == 0) revert InvalidAmount();
        feeAmount = (baseInput * feeBps) / BPS;
        uint256 netInput = baseInput - feeAmount;
        uint256 newTokenReserve = Math.ceilDiv(virtualBaseReserve * virtualTokenReserve, virtualBaseReserve + netInput);
        tokenOutput = virtualTokenReserve - newTokenReserve;
        if (tokenOutput > realCurveTokenReserve) tokenOutput = realCurveTokenReserve;
    }

    function quoteSell(uint256 tokenInput) public returns (uint256 feeAmount, uint256 baseOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return graduationAdapter.quoteSell(tokenInput);
        if (tokenInput == 0 || realCurveTokenReserve + tokenInput > curveTokenAllocation) {
            revert CurveInventoryExceeded();
        }
        uint256 newBaseReserve =
            Math.ceilDiv(virtualBaseReserve * virtualTokenReserve, virtualTokenReserve + tokenInput);
        uint256 grossOutput = virtualBaseReserve - newBaseReserve;
        feeAmount = (grossOutput * feeBps) / BPS;
        baseOutput = grossOutput - feeAmount;
    }

    function buy(uint256 baseInput, uint256 minimumTokenOutput) external nonReentrant returns (uint256 tokenOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return _buyGraduated(baseInput, minimumTokenOutput);
        if (baseInput == 0) revert InvalidAmount();
        baseAsset.safeTransferFrom(msg.sender, address(this), baseInput);

        uint256 feeAmount = (baseInput * feeBps) / BPS;
        uint256 netInput = baseInput - feeAmount;
        uint256 invariant = virtualBaseReserve * virtualTokenReserve;
        uint256 newTokenReserve = Math.ceilDiv(invariant, virtualBaseReserve + netInput);
        tokenOutput = virtualTokenReserve - newTokenReserve;
        uint256 usedInput = baseInput;

        if (tokenOutput >= realCurveTokenReserve) {
            tokenOutput = realCurveTokenReserve;
            uint256 terminalVirtualToken = virtualTokenReserve - tokenOutput;
            uint256 requiredNet = Math.ceilDiv(invariant, terminalVirtualToken) - virtualBaseReserve;
            usedInput = Math.ceilDiv(requiredNet * BPS, BPS - feeBps);
            feeAmount = usedInput - requiredNet;
            netInput = requiredNet;
            if (usedInput > baseInput) revert InvalidAmount();
        }
        if (tokenOutput == 0) revert InvalidAmount();
        if (tokenOutput < minimumTokenOutput) revert Slippage(minimumTokenOutput, tokenOutput);

        virtualBaseReserve += netInput;
        virtualTokenReserve -= tokenOutput;
        realCurveTokenReserve -= tokenOutput;
        _recordFee(feeAmount);
        IERC20(address(launchToken)).safeTransfer(msg.sender, tokenOutput);
        if (usedInput < baseInput) baseAsset.safeTransfer(msg.sender, baseInput - usedInput);
        emit Bought(msg.sender, usedInput, feeAmount, tokenOutput);
        emit CurveState(virtualTokenReserve, virtualBaseReserve, realCurveTokenReserve, graduationProgressBps());
        if (realCurveTokenReserve == 0) _graduate();
    }

    function sell(uint256 tokenInput, uint256 minimumBaseOutput) external nonReentrant returns (uint256 baseOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return _sellGraduated(tokenInput, minimumBaseOutput);
        (uint256 feeAmount, uint256 quotedOutput) = quoteSell(tokenInput);
        baseOutput = quotedOutput;
        if (baseOutput == 0) revert InvalidAmount();
        if (baseOutput < minimumBaseOutput) revert Slippage(minimumBaseOutput, baseOutput);
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenInput);
        uint256 grossOutput = baseOutput + feeAmount;
        virtualTokenReserve += tokenInput;
        virtualBaseReserve -= grossOutput;
        realCurveTokenReserve += tokenInput;
        _recordFee(feeAmount);
        baseAsset.safeTransfer(msg.sender, baseOutput);
        emit Sold(msg.sender, tokenInput, feeAmount, baseOutput);
        emit CurveState(virtualTokenReserve, virtualBaseReserve, realCurveTokenReserve, graduationProgressBps());
    }

    function _graduate() private {
        uint256 finalPrice = (virtualBaseReserve * 1e18) / virtualTokenReserve;
        uint256 tokenLiquidity = IERC20(address(launchToken)).balanceOf(address(this));
        uint256 baseLiquidity = baseAsset.balanceOf(address(this));
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), tokenLiquidity);
        baseAsset.forceApprove(address(graduationAdapter), baseLiquidity);
        graduated = true;
        (address pool, uint256 tokenId) = graduationAdapter.initialize(tokenLiquidity, baseLiquidity, finalPrice);
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), 0);
        baseAsset.forceApprove(address(graduationAdapter), 0);
        emit Graduated(
            pool,
            address(graduationAdapter.locker()),
            tokenId,
            graduationAdapter.tokenLiquidityUsed(),
            graduationAdapter.baseLiquidityUsed(),
            finalPrice
        );
    }

    function _buyGraduated(uint256 baseInput, uint256 minimumTokenOutput) private returns (uint256 tokenOutput) {
        baseAsset.safeTransferFrom(msg.sender, address(this), baseInput);
        baseAsset.forceApprove(address(graduationAdapter), baseInput);
        (uint256 nominalFee,) = graduationAdapter.quoteBuy(baseInput);
        tokenOutput = graduationAdapter.buyFor(msg.sender, baseInput, minimumTokenOutput);
        baseAsset.forceApprove(address(graduationAdapter), 0);
        emit Bought(msg.sender, baseInput, nominalFee, tokenOutput);
    }

    function _sellGraduated(uint256 tokenInput, uint256 minimumBaseOutput) private returns (uint256 baseOutput) {
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenInput);
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), tokenInput);
        (uint256 nominalFee,) = graduationAdapter.quoteSell(tokenInput);
        baseOutput = graduationAdapter.sellFor(msg.sender, tokenInput, minimumBaseOutput);
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), 0);
        emit Sold(msg.sender, tokenInput, nominalFee, baseOutput);
    }

    function _recordFee(uint256 feeAmount) private {
        if (feeAmount == 0) revert InvalidAmount();
        if (address(feeRouter) != address(0)) {
            baseAsset.forceApprove(address(feeRouter), feeAmount);
            feeRouter.routeBaseFees(IERC20(address(launchToken)), feeAmount);
            baseAsset.forceApprove(address(feeRouter), 0);
            return;
        }
        baseAsset.forceApprove(address(feeVault), feeAmount);
        feeVault.recordFees(feeAmount);
        baseAsset.forceApprove(address(feeVault), 0);
    }
}
