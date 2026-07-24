// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RobynLaunchToken} from "../RobynLaunchToken.sol";
import {RobynNativeBasketVaultV2} from "./RobynNativeBasketVaultV2.sol";
import {RobynNativeProtocolFeeRouterV3} from "./RobynNativeProtocolFeeRouterV3.sol";
import {RobynV4GraduationAdapter} from "./RobynV4GraduationAdapter.sol";

/// @notice Native-ETH bonding curve that atomically graduates into locked v4 liquidity.
contract RobynV4BondingCurveMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    string public constant CONTRACT_VERSION = "1.0.0";

    struct CurveConfig {
        uint256 curveTokenAllocation;
        uint256 graduationTokenAllocation;
        uint256 initialVirtualTokenReserve;
        uint256 initialVirtualNativeReserve;
        uint256 graduationThresholdNative;
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
    error NativeTransferFailed();

    RobynLaunchToken public immutable launchToken;
    RobynNativeBasketVaultV2 public immutable feeVault;
    address public immutable creator;
    address public immutable seedAuthority;
    uint256 public immutable curveTokenAllocation;
    uint256 public immutable graduationTokenAllocation;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualNativeReserve;
    uint256 public immutable graduationThresholdNative;
    uint16 public immutable feeBps;
    RobynV4GraduationAdapter public immutable graduationAdapter;
    RobynNativeProtocolFeeRouterV3 public feeRouter;

    uint256 public virtualTokenReserve;
    uint256 public virtualNativeReserve;
    uint256 public realCurveTokenReserve;
    bool public seeded;
    bool public graduated;

    event LiquiditySeeded(address indexed provider, uint256 tokenAmount);
    event Bought(address indexed buyer, uint256 nativeInput, uint256 feeAmount, uint256 tokenOutput);
    event Sold(address indexed seller, uint256 tokenInput, uint256 feeAmount, uint256 nativeOutput);
    event CurveState(
        uint256 virtualTokenReserve, uint256 virtualNativeReserve, uint256 realCurveTokenReserve, uint256 progressBps
    );
    event Graduated(
        bytes32 indexed poolId,
        address indexed locker,
        uint256 indexed positionTokenId,
        uint256 tokenLiquidity,
        uint256 nativeLiquidity,
        uint256 finalCurvePrice
    );
    event GraduationSurplusRouted(uint256 nativeAmount);
    event FeeRouterBound(address indexed feeRouter);

    constructor(
        RobynLaunchToken launchToken_,
        RobynNativeBasketVaultV2 feeVault_,
        address creator_,
        address seedAuthority_,
        CurveConfig memory curve_,
        RobynV4GraduationAdapter graduationAdapter_
    ) {
        if (
            address(launchToken_) == address(0) || address(feeVault_) == address(0) || creator_ == address(0)
                || seedAuthority_ == address(0) || curve_.curveTokenAllocation == 0
                || curve_.graduationTokenAllocation == 0
                || curve_.initialVirtualTokenReserve <= curve_.curveTokenAllocation
                || curve_.initialVirtualNativeReserve == 0 || curve_.graduationThresholdNative == 0
                || curve_.curveFeeBps == 0 || curve_.curveFeeBps > 1_000
                || address(feeVault_.launchToken()) != address(launchToken_)
                || address(graduationAdapter_) == address(0)
                || address(graduationAdapter_.launchToken()) != address(launchToken_)
        ) revert InvalidConfiguration();
        launchToken = launchToken_;
        feeVault = feeVault_;
        creator = creator_;
        seedAuthority = seedAuthority_;
        curveTokenAllocation = curve_.curveTokenAllocation;
        graduationTokenAllocation = curve_.graduationTokenAllocation;
        initialVirtualTokenReserve = curve_.initialVirtualTokenReserve;
        initialVirtualNativeReserve = curve_.initialVirtualNativeReserve;
        graduationThresholdNative = curve_.graduationThresholdNative;
        feeBps = curve_.curveFeeBps;
        graduationAdapter = graduationAdapter_;
    }

    receive() external payable {
        if (msg.sender != address(graduationAdapter)) revert Unauthorized();
    }

    function bindFeeRouter(RobynNativeProtocolFeeRouterV3 feeRouter_) external {
        if (msg.sender != seedAuthority && msg.sender != graduationAdapter.marketBindingAuthority()) {
            revert Unauthorized();
        }
        if (address(feeRouter) != address(0)) revert FeeRouterAlreadyBound();
        if (seeded || address(feeRouter_) == address(0) || address(feeRouter_).code.length == 0) {
            revert InvalidConfiguration();
        }
        feeRouter = feeRouter_;
        emit FeeRouterBound(address(feeRouter_));
    }

    function seed(uint256 tokenAmount) external nonReentrant {
        if (msg.sender != seedAuthority) revert Unauthorized();
        if (seeded) revert AlreadySeeded();
        if (tokenAmount != curveTokenAllocation + graduationTokenAllocation) revert InvalidAmount();
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenAmount);
        virtualTokenReserve = initialVirtualTokenReserve;
        virtualNativeReserve = initialVirtualNativeReserve;
        realCurveTokenReserve = curveTokenAllocation;
        seeded = true;
        emit LiquiditySeeded(msg.sender, tokenAmount);
        emit CurveState(virtualTokenReserve, virtualNativeReserve, realCurveTokenReserve, 0);
    }

    function poolId() external view returns (bytes32) {
        return graduationAdapter.poolId();
    }

    function positionLocker() external view returns (address) {
        return address(graduationAdapter.locker());
    }

    function nativePerToken() public view returns (uint256) {
        if (graduated) return graduationAdapter.spotNativePerTokenX18();
        return Math.mulDiv(virtualNativeReserve, 1e18, virtualTokenReserve);
    }

    function nativeRaised() public view returns (uint256) {
        if (graduated) return graduationThresholdNative;
        return
            virtualNativeReserve > initialVirtualNativeReserve ? virtualNativeReserve - initialVirtualNativeReserve : 0;
    }

    function graduationProgressBps() public view returns (uint256) {
        if (graduated) return BPS;
        uint256 progress = Math.mulDiv(nativeRaised(), BPS, graduationThresholdNative);
        return progress > BPS ? BPS : progress;
    }

    function quoteBuy(uint256 nativeInput) public returns (uint256 feeAmount, uint256 tokenOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return graduationAdapter.quoteBuy(uint128(nativeInput));
        if (nativeInput == 0) revert InvalidAmount();
        feeAmount = Math.mulDiv(nativeInput, feeBps, BPS);
        uint256 netInput = nativeInput - feeAmount;
        uint256 newTokenReserve =
            Math.ceilDiv(virtualNativeReserve * virtualTokenReserve, virtualNativeReserve + netInput);
        tokenOutput = virtualTokenReserve - newTokenReserve;
        if (tokenOutput > realCurveTokenReserve) tokenOutput = realCurveTokenReserve;
    }

    function quoteSell(uint256 tokenInput) public returns (uint256 feeAmount, uint256 nativeOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return graduationAdapter.quoteSell(uint128(tokenInput));
        if (tokenInput == 0 || realCurveTokenReserve + tokenInput > curveTokenAllocation) {
            revert CurveInventoryExceeded();
        }
        uint256 newNativeReserve =
            Math.ceilDiv(virtualNativeReserve * virtualTokenReserve, virtualTokenReserve + tokenInput);
        uint256 grossOutput = virtualNativeReserve - newNativeReserve;
        feeAmount = Math.mulDiv(grossOutput, feeBps, BPS);
        nativeOutput = grossOutput - feeAmount;
    }

    // All external value paths execute under this non-reentrant entry point;
    // state and fee liabilities are committed before refunds or graduation.
    // slither-disable-next-line reentrancy-eth
    function buy(uint256 minimumTokenOutput) external payable nonReentrant returns (uint256 tokenOutput) {
        if (!seeded) revert NotSeeded();
        if (graduated) return _buyGraduated(minimumTokenOutput);
        if (msg.value == 0) revert InvalidAmount();

        uint256 nativeInput = msg.value;
        uint256 feeAmount = Math.mulDiv(nativeInput, feeBps, BPS);
        uint256 netInput = nativeInput - feeAmount;
        uint256 invariant = virtualNativeReserve * virtualTokenReserve;
        uint256 newTokenReserve = Math.ceilDiv(invariant, virtualNativeReserve + netInput);
        tokenOutput = virtualTokenReserve - newTokenReserve;
        uint256 usedInput = nativeInput;

        if (tokenOutput >= realCurveTokenReserve) {
            tokenOutput = realCurveTokenReserve;
            uint256 terminalVirtualToken = virtualTokenReserve - tokenOutput;
            uint256 requiredNet = Math.ceilDiv(invariant, terminalVirtualToken) - virtualNativeReserve;
            usedInput = Math.ceilDiv(requiredNet * BPS, BPS - feeBps);
            feeAmount = usedInput - requiredNet;
            netInput = requiredNet;
            if (usedInput > nativeInput) revert InvalidAmount();
        }
        if (tokenOutput == 0 || tokenOutput < minimumTokenOutput) {
            revert Slippage(minimumTokenOutput, tokenOutput);
        }

        virtualNativeReserve += netInput;
        virtualTokenReserve -= tokenOutput;
        realCurveTokenReserve -= tokenOutput;
        _recordFee(feeAmount);
        IERC20(address(launchToken)).safeTransfer(msg.sender, tokenOutput);
        if (usedInput < nativeInput) _sendNative(payable(msg.sender), nativeInput - usedInput);
        emit Bought(msg.sender, usedInput, feeAmount, tokenOutput);
        emit CurveState(virtualTokenReserve, virtualNativeReserve, realCurveTokenReserve, graduationProgressBps());
        if (realCurveTokenReserve == 0) _graduate();
    }

    function sell(uint256 tokenInput, uint256 minimumNativeOutput)
        external
        nonReentrant
        returns (uint256 nativeOutput)
    {
        if (!seeded) revert NotSeeded();
        if (graduated) return _sellGraduated(tokenInput, minimumNativeOutput);
        (uint256 feeAmount, uint256 quotedOutput) = quoteSell(tokenInput);
        nativeOutput = quotedOutput;
        if (nativeOutput == 0 || nativeOutput < minimumNativeOutput) {
            revert Slippage(minimumNativeOutput, nativeOutput);
        }
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenInput);
        uint256 grossOutput = nativeOutput + feeAmount;
        virtualTokenReserve += tokenInput;
        virtualNativeReserve -= grossOutput;
        realCurveTokenReserve += tokenInput;
        _recordFee(feeAmount);
        _sendNative(payable(msg.sender), nativeOutput);
        emit Sold(msg.sender, tokenInput, feeAmount, nativeOutput);
        emit CurveState(virtualTokenReserve, virtualNativeReserve, realCurveTokenReserve, graduationProgressBps());
    }

    // Called only from nonReentrant buy; native value goes exclusively to the
    // immutable adapter and canonical fee router configured by the factory.
    // slither-disable-next-line arbitrary-send-eth
    function _graduate() private {
        uint256 finalPrice = Math.mulDiv(virtualNativeReserve, 1e18, virtualTokenReserve);
        uint256 tokenLiquidity = IERC20(address(launchToken)).balanceOf(address(this));
        uint256 nativeLiquidity = address(this).balance;
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), tokenLiquidity);
        graduated = true;
        (uint256 tokenId,, uint256 tokenUsed, uint256 nativeUsed) =
            graduationAdapter.graduate{value: nativeLiquidity}(tokenLiquidity);
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), 0);
        uint256 graduationSurplus = address(this).balance;
        if (graduationSurplus != 0) {
            feeRouter.routeNativeFees{value: graduationSurplus}(launchToken);
            emit GraduationSurplusRouted(graduationSurplus);
        }
        emit Graduated(
            graduationAdapter.poolId(), address(graduationAdapter.locker()), tokenId, tokenUsed, nativeUsed, finalPrice
        );
    }

    function _buyGraduated(uint256 minimumTokenOutput) private returns (uint256 tokenOutput) {
        (uint256 nominalFee,) = graduationAdapter.quoteBuy(uint128(msg.value));
        tokenOutput = graduationAdapter.buyFor{value: msg.value}(msg.sender, minimumTokenOutput);
        emit Bought(msg.sender, msg.value, nominalFee, tokenOutput);
    }

    function _sellGraduated(uint256 tokenInput, uint256 minimumNativeOutput) private returns (uint256 nativeOutput) {
        if (tokenInput == 0 || tokenInput > type(uint128).max) revert InvalidAmount();
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenInput);
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), tokenInput);
        (uint256 nominalFee,) = graduationAdapter.quoteSell(uint128(tokenInput));
        nativeOutput = graduationAdapter.sellFor(payable(msg.sender), uint128(tokenInput), minimumNativeOutput);
        IERC20(address(launchToken)).forceApprove(address(graduationAdapter), 0);
        emit Sold(msg.sender, tokenInput, nominalFee, nativeOutput);
    }

    function _recordFee(uint256 feeAmount) private {
        if (feeAmount == 0 || address(feeRouter) == address(0)) revert InvalidConfiguration();
        feeRouter.routeNativeFees{value: feeAmount}(launchToken);
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }
}
