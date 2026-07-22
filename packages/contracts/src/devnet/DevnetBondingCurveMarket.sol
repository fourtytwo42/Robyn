// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { DevnetLockedLiquidityPool } from "./DevnetLockedLiquidityPool.sol";

/// @notice Constant-product launch curve with automatic locked-pool graduation for controlled devnet.
contract DevnetBondingCurveMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    string public constant DEVNET_ONLY = "robyn-devnet-bonding-curve";

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAmount();
    error AlreadySeeded();
    error NotSeeded();
    error Slippage(uint256 minimum, uint256 actual);
    error CurveInventoryExceeded();

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
    DevnetLockedLiquidityPool public immutable graduatedPool;

    uint256 public virtualTokenReserve;
    uint256 public virtualBaseReserve;
    uint256 public realCurveTokenReserve;
    bool public seeded;
    bool public graduated;

    event LiquiditySeeded(address indexed provider, uint256 tokenAmount, uint256 baseAmount);
    event Bought(address indexed buyer, uint256 baseInput, uint256 feeAmount, uint256 tokenOutput);
    event Sold(address indexed seller, uint256 tokenInput, uint256 feeAmount, uint256 baseOutput);
    event CurveState(
        uint256 virtualTokenReserve,
        uint256 virtualBaseReserve,
        uint256 realCurveTokenReserve,
        uint256 progressBps
    );
    event Graduated(
        address indexed pool, uint256 tokenLiquidity, uint256 baseLiquidity, uint256 finalCurvePrice
    );

    constructor(
        IERC20 baseAsset_,
        RobynLaunchToken launchToken_,
        FeeBasketVault feeVault_,
        address marketOwner_,
        uint256 curveTokenAllocation_,
        uint256 graduationTokenAllocation_,
        uint256 initialVirtualTokenReserve_,
        uint256 initialVirtualBaseReserve_,
        uint256 graduationThresholdBase_,
        uint16 feeBps_
    ) {
        if (
            address(baseAsset_) == address(0) || address(launchToken_) == address(0)
                || address(feeVault_) == address(0) || marketOwner_ == address(0)
                || curveTokenAllocation_ == 0 || graduationTokenAllocation_ == 0
                || initialVirtualTokenReserve_ <= curveTokenAllocation_
                || initialVirtualBaseReserve_ == 0 || graduationThresholdBase_ == 0 || feeBps_ == 0
                || feeBps_ > 1_000 || address(feeVault_.baseAsset()) != address(baseAsset_)
                || address(feeVault_.launchToken()) != address(launchToken_)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchToken = launchToken_;
        feeVault = feeVault_;
        marketOwner = marketOwner_;
        curveTokenAllocation = curveTokenAllocation_;
        graduationTokenAllocation = graduationTokenAllocation_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        initialVirtualBaseReserve = initialVirtualBaseReserve_;
        graduationThresholdBase = graduationThresholdBase_;
        feeBps = feeBps_;
        graduatedPool = new DevnetLockedLiquidityPool(
            baseAsset_, IERC20(address(launchToken_)), feeVault_, address(this), feeBps_
        );
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

    function basePerToken() public view returns (uint256) {
        if (graduated) {
            return (graduatedPool.baseReserve() * 1e18) / graduatedPool.tokenReserve();
        }
        return (virtualBaseReserve * 1e18) / virtualTokenReserve;
    }

    function baseRaised() public view returns (uint256) {
        if (graduated) return graduationThresholdBase;
        return virtualBaseReserve > initialVirtualBaseReserve
            ? virtualBaseReserve - initialVirtualBaseReserve
            : 0;
    }

    function graduationProgressBps() public view returns (uint256) {
        if (graduated) return BPS;
        uint256 progress = (baseRaised() * BPS) / graduationThresholdBase;
        return progress > BPS ? BPS : progress;
    }

    function quoteBuy(uint256 baseInput)
        public
        view
        returns (uint256 feeAmount, uint256 tokenOutput)
    {
        if (!seeded) revert NotSeeded();
        if (graduated) return graduatedPool.quoteBuy(baseInput);
        if (baseInput == 0) revert InvalidAmount();
        feeAmount = (baseInput * feeBps) / BPS;
        uint256 netInput = baseInput - feeAmount;
        uint256 newTokenReserve =
            Math.ceilDiv(virtualBaseReserve * virtualTokenReserve, virtualBaseReserve + netInput);
        tokenOutput = virtualTokenReserve - newTokenReserve;
        if (tokenOutput > realCurveTokenReserve) tokenOutput = realCurveTokenReserve;
    }

    function quoteSell(uint256 tokenInput)
        public
        view
        returns (uint256 feeAmount, uint256 baseOutput)
    {
        if (!seeded) revert NotSeeded();
        if (graduated) return graduatedPool.quoteSell(tokenInput);
        if (tokenInput == 0 || realCurveTokenReserve + tokenInput > curveTokenAllocation) {
            revert CurveInventoryExceeded();
        }
        uint256 newBaseReserve = Math.ceilDiv(
            virtualBaseReserve * virtualTokenReserve, virtualTokenReserve + tokenInput
        );
        uint256 grossOutput = virtualBaseReserve - newBaseReserve;
        feeAmount = (grossOutput * feeBps) / BPS;
        baseOutput = grossOutput - feeAmount;
    }

    function buy(uint256 baseInput, uint256 minimumTokenOutput)
        external
        nonReentrant
        returns (uint256 tokenOutput)
    {
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
        emit CurveState(
            virtualTokenReserve, virtualBaseReserve, realCurveTokenReserve, graduationProgressBps()
        );
        if (realCurveTokenReserve == 0) _graduate();
    }

    function sell(uint256 tokenInput, uint256 minimumBaseOutput)
        external
        nonReentrant
        returns (uint256 baseOutput)
    {
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
        emit CurveState(
            virtualTokenReserve, virtualBaseReserve, realCurveTokenReserve, graduationProgressBps()
        );
    }

    function _graduate() private {
        uint256 finalPrice = basePerToken();
        uint256 tokenLiquidity = IERC20(address(launchToken)).balanceOf(address(this));
        uint256 baseLiquidity = baseAsset.balanceOf(address(this));
        IERC20(address(launchToken)).safeTransfer(address(graduatedPool), tokenLiquidity);
        baseAsset.safeTransfer(address(graduatedPool), baseLiquidity);
        graduated = true;
        graduatedPool.initialize();
        emit Graduated(address(graduatedPool), tokenLiquidity, baseLiquidity, finalPrice);
    }

    function _buyGraduated(uint256 baseInput, uint256 minimumTokenOutput)
        private
        returns (uint256 tokenOutput)
    {
        baseAsset.safeTransferFrom(msg.sender, address(this), baseInput);
        baseAsset.forceApprove(address(graduatedPool), baseInput);
        (uint256 feeAmount,) = graduatedPool.quoteBuy(baseInput);
        tokenOutput = graduatedPool.buyFor(msg.sender, baseInput, minimumTokenOutput);
        baseAsset.forceApprove(address(graduatedPool), 0);
        emit Bought(msg.sender, baseInput, feeAmount, tokenOutput);
    }

    function _sellGraduated(uint256 tokenInput, uint256 minimumBaseOutput)
        private
        returns (uint256 baseOutput)
    {
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenInput);
        IERC20(address(launchToken)).forceApprove(address(graduatedPool), tokenInput);
        (uint256 feeAmount,) = graduatedPool.quoteSell(tokenInput);
        baseOutput = graduatedPool.sellFor(msg.sender, tokenInput, minimumBaseOutput);
        IERC20(address(launchToken)).forceApprove(address(graduatedPool), 0);
        emit Sold(msg.sender, tokenInput, feeAmount, baseOutput);
    }

    function _recordFee(uint256 feeAmount) private {
        if (feeAmount == 0) revert InvalidAmount();
        baseAsset.forceApprove(address(feeVault), feeAmount);
        feeVault.recordFees(feeAmount);
        baseAsset.forceApprove(address(feeVault), 0);
    }
}

