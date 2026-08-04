// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynRdaoStaking } from "./RobynRdaoStaking.sol";

interface IRobynRdaoGraduationFinalizer {
    function finalizeRdaoLiquidity(
        IERC20 rdao,
        uint256 tokenAmount,
        uint256 terminalVirtualTokenReserve,
        uint256 terminalVirtualNativeReserve,
        address staking
    ) external payable returns (bytes32 poolId, uint256 positionId);
}

/// @notice Fixed-inventory RDAO sale with price-continuous, atomic graduation.
contract RobynRdaoBondingSale is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "1.0.0-schema20";
    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 100;

    error Unauthorized();
    error InvalidConfiguration();
    error AllocationNotFunded(uint256 expected, uint256 actual);
    error DeadlineExpired();
    error SlippageExceeded(uint256 minimum, uint256 actual);
    error NothingToBuy();
    error InsufficientOutstanding();
    error NativeTransferFailed();
    error GraduationNotReady();
    error AlreadyFinalized();

    struct SaleConfiguration {
        address payable deployerPayoutRecipient;
        address governance;
        address guardian;
        uint256 saleInventory;
        uint256 liquidityInventory;
        uint256 virtualTokenReserve;
        uint256 virtualNativeReserve;
        uint256 curvePrincipalTarget;
        uint256 deployerPayout;
        uint256 liquidityNative;
        uint256 maintenanceGasLimit;
    }

    IERC20 public immutable rdao;
    RobynRdaoStaking public immutable staking;
    IRobynRdaoGraduationFinalizer public immutable graduationFinalizer;
    address payable public immutable deployerPayoutRecipient;
    address public immutable governance;
    address public immutable guardian;
    uint256 public immutable saleInventory;
    uint256 public immutable liquidityInventory;
    uint256 public immutable virtualTokenReserve;
    uint256 public immutable virtualNativeReserve;
    uint256 public immutable curvePrincipalTarget;
    uint256 public immutable deployerPayout;
    uint256 public immutable liquidityNative;
    uint256 public immutable graduationDustToStaking;
    uint256 public immutable invariantK;
    uint256 public immutable maintenanceGasLimit;

    bool public allocationFunded;
    bool public buysPaused;
    bool public finalized;
    uint256 public sold;
    uint256 public curvePrincipal;
    uint256 public totalBondingFees;
    uint256 public totalFeesSettled;
    bytes32 public graduatedPoolId;
    uint256 public graduatedPositionId;

    event AllocationFunded(uint256 saleInventory, uint256 liquidityInventory);
    event BuyPauseChanged(bool paused, address indexed caller);
    event Bought(
        address indexed buyer,
        address indexed recipient,
        uint256 principal,
        uint256 fee,
        uint256 tokensOut,
        uint256 refund,
        uint256 cumulativeSold
    );
    event Sold(
        address indexed seller,
        address indexed recipient,
        uint256 tokensIn,
        uint256 principalOut,
        uint256 fee,
        uint256 nativeOut,
        uint256 cumulativeSold
    );
    event FeeSettlementAttempt(uint256 amount, bool success, bytes4 failureSelector);
    event Graduated(
        bytes32 indexed poolId,
        uint256 indexed positionId,
        uint256 deployerPayout,
        uint256 liquidityNative,
        uint256 liquidityTokens
    );
    event SurplusRdaoRecovered(address indexed recipient, uint256 amount);

    constructor(
        IERC20 rdao_,
        RobynRdaoStaking staking_,
        IRobynRdaoGraduationFinalizer graduationFinalizer_,
        SaleConfiguration memory config
    ) {
        if (
            address(rdao_) == address(0) || address(rdao_).code.length == 0
                || address(staking_) == address(0) || address(staking_).code.length == 0
                || address(graduationFinalizer_) == address(0)
                || address(graduationFinalizer_).code.length == 0
                || config.deployerPayoutRecipient == address(0) || config.governance == address(0)
                || config.guardian == address(0) || config.saleInventory == 0
                || config.liquidityInventory == 0
                || config.virtualTokenReserve <= config.saleInventory
                || config.virtualNativeReserve == 0 || config.curvePrincipalTarget == 0
                || config.deployerPayout == 0 || config.liquidityNative == 0
                || config.deployerPayout + config.liquidityNative > config.curvePrincipalTarget
                || config.maintenanceGasLimit < 100_000 || config.maintenanceGasLimit > 2_000_000
        ) revert InvalidConfiguration();
        rdao = rdao_;
        staking = staking_;
        graduationFinalizer = graduationFinalizer_;
        deployerPayoutRecipient = config.deployerPayoutRecipient;
        governance = config.governance;
        guardian = config.guardian;
        saleInventory = config.saleInventory;
        liquidityInventory = config.liquidityInventory;
        virtualTokenReserve = config.virtualTokenReserve;
        virtualNativeReserve = config.virtualNativeReserve;
        curvePrincipalTarget = config.curvePrincipalTarget;
        deployerPayout = config.deployerPayout;
        liquidityNative = config.liquidityNative;
        graduationDustToStaking =
            config.curvePrincipalTarget - config.deployerPayout - config.liquidityNative;
        maintenanceGasLimit = config.maintenanceGasLimit;
        invariantK = config.virtualTokenReserve * config.virtualNativeReserve;
        uint256 calculatedTarget = _principalForSold(config.saleInventory);
        if (calculatedTarget != config.curvePrincipalTarget) revert InvalidConfiguration();
        uint256 terminalNativeReserve = config.virtualNativeReserve + config.curvePrincipalTarget;
        uint256 terminalTokenReserve = config.virtualTokenReserve - config.saleInventory;
        if (
            Math.mulDiv(config.liquidityInventory, terminalNativeReserve, terminalTokenReserve)
                != config.liquidityNative
        ) revert InvalidConfiguration();
    }

    receive() external payable { }

    function fundAllocation() external nonReentrant {
        if (allocationFunded) revert InvalidConfiguration();
        uint256 expected = saleInventory + liquidityInventory;
        uint256 beforeBalance = rdao.balanceOf(address(this));
        rdao.safeTransferFrom(msg.sender, address(this), expected);
        uint256 received = rdao.balanceOf(address(this)) - beforeBalance;
        if (received != expected) revert AllocationNotFunded(expected, received);
        allocationFunded = true;
        emit AllocationFunded(saleInventory, liquidityInventory);
    }

    function setBuysPaused(bool paused_) external {
        if (paused_) {
            if (msg.sender != guardian && msg.sender != governance) revert Unauthorized();
        } else if (msg.sender != governance) revert Unauthorized();
        buysPaused = paused_;
        emit BuyPauseChanged(paused_, msg.sender);
    }

    function quoteBuy(uint256 grossNative)
        public
        view
        returns (uint256 tokensOut, uint256 principal, uint256 fee, uint256 refund)
    {
        if (grossNative == 0 || sold == saleInventory) return (0, 0, 0, grossNative);
        uint256 availablePrincipal = Math.mulDiv(grossNative, BPS, BPS + FEE_BPS);
        while (availablePrincipal + _feeOn(availablePrincipal) > grossNative) {
            unchecked { --availablePrincipal; }
        }
        uint256 targetSold = _soldForPrincipal(curvePrincipal + availablePrincipal);
        if (targetSold > saleInventory) targetSold = saleInventory;
        if (targetSold <= sold) return (0, 0, 0, grossNative);
        principal = _principalForSold(targetSold) - curvePrincipal;
        fee = _feeOn(principal);
        if (principal + fee > grossNative) return (0, 0, 0, grossNative);
        tokensOut = targetSold - sold;
        refund = grossNative - principal - fee;
    }

    function quoteSell(uint256 tokensIn)
        public
        view
        returns (uint256 principalOut, uint256 fee, uint256 nativeOut)
    {
        if (tokensIn == 0 || tokensIn > sold) return (0, 0, 0);
        uint256 targetPrincipal = _principalForSold(sold - tokensIn);
        principalOut = curvePrincipal - targetPrincipal;
        fee = _feeOn(principalOut);
        nativeOut = principalOut - fee;
    }

    function buy(uint256 minimumTokensOut, uint256 deadline, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (!allocationFunded || finalized || buysPaused || recipient == address(0)) {
            revert InvalidConfiguration();
        }
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256 principal;
        uint256 fee;
        uint256 refund;
        (tokensOut, principal, fee, refund) = quoteBuy(msg.value);
        if (tokensOut == 0) revert NothingToBuy();
        if (tokensOut < minimumTokensOut) revert SlippageExceeded(minimumTokensOut, tokensOut);
        sold += tokensOut;
        curvePrincipal += principal;
        totalBondingFees += fee;
        rdao.safeTransfer(recipient, tokensOut);
        if (refund != 0) _sendNative(payable(msg.sender), refund);
        _trySettleFees();
        emit Bought(msg.sender, recipient, principal, fee, tokensOut, refund, sold);
    }

    function sell(uint256 tokensIn, uint256 minimumNativeOut, uint256 deadline, address payable recipient)
        external
        nonReentrant
        returns (uint256 nativeOut)
    {
        if (!allocationFunded || finalized || recipient == address(0) || tokensIn == 0) {
            revert InvalidConfiguration();
        }
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (tokensIn > sold) revert InsufficientOutstanding();
        (uint256 principalOut, uint256 fee, uint256 quotedNativeOut) = quoteSell(tokensIn);
        nativeOut = quotedNativeOut;
        if (nativeOut < minimumNativeOut) revert SlippageExceeded(minimumNativeOut, nativeOut);
        rdao.safeTransferFrom(msg.sender, address(this), tokensIn);
        sold -= tokensIn;
        curvePrincipal -= principalOut;
        totalBondingFees += fee;
        _sendNative(recipient, nativeOut);
        _trySettleFees();
        emit Sold(msg.sender, recipient, tokensIn, principalOut, fee, nativeOut, sold);
    }

    function processFees() external nonReentrant returns (uint256 amount, bool success) {
        return _trySettleFees();
    }

    function finalizeGraduation() external nonReentrant returns (bytes32 poolId, uint256 positionId) {
        if (finalized) revert AlreadyFinalized();
        if (!allocationFunded || buysPaused || sold != saleInventory
            || curvePrincipal != curvePrincipalTarget) revert GraduationNotReady();
        finalized = true;
        curvePrincipal = 0;
        rdao.safeTransfer(address(graduationFinalizer), liquidityInventory);
        (poolId, positionId) = graduationFinalizer.finalizeRdaoLiquidity{
            value: liquidityNative
        }(
            rdao,
            liquidityInventory,
            virtualTokenReserve - saleInventory,
            virtualNativeReserve + curvePrincipalTarget,
            address(staking)
        );
        _sendNative(deployerPayoutRecipient, deployerPayout);
        graduatedPoolId = poolId;
        graduatedPositionId = positionId;
        _trySettleFees();
        emit Graduated(poolId, positionId, deployerPayout, liquidityNative, liquidityInventory);
    }

    function recoverSurplusRdao(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != governance || recipient == address(0)) revert Unauthorized();
        uint256 requiredBalance = finalized ? 0 : saleInventory - sold + liquidityInventory;
        uint256 balance = rdao.balanceOf(address(this));
        if (balance <= requiredBalance) revert InvalidConfiguration();
        amount = balance - requiredBalance;
        rdao.safeTransfer(recipient, amount);
        emit SurplusRdaoRecovered(recipient, amount);
    }

    function pendingStakingFees() public view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > curvePrincipal ? balance - curvePrincipal : 0;
    }

    function graduationReady() external view returns (bool) {
        return allocationFunded && !buysPaused && !finalized && sold == saleInventory
            && curvePrincipal == curvePrincipalTarget;
    }

    function currentVirtualReserves()
        external
        view
        returns (uint256 tokenReserve, uint256 nativeReserve)
    {
        tokenReserve = virtualTokenReserve - sold;
        nativeReserve = virtualNativeReserve + curvePrincipal;
    }

    function currentPriceE18() external view returns (uint256 nativePerRdaoE18) {
        return Math.mulDiv(virtualNativeReserve + curvePrincipal, 1e18, virtualTokenReserve - sold);
    }

    function terminalPriceE18() external view returns (uint256 nativePerRdaoE18) {
        return Math.mulDiv(
            virtualNativeReserve + curvePrincipalTarget,
            1e18,
            virtualTokenReserve - saleInventory
        );
    }

    function _trySettleFees() private returns (uint256 amount, bool success) {
        amount = pendingStakingFees();
        if (amount == 0) return (0, true);
        bytes memory result;
        (success, result) = address(staking).call{ value: amount, gas: maintenanceGasLimit }(
            abi.encodeCall(RobynRdaoStaking.depositRewards, (address(rdao)))
        );
        bytes4 failureSelector;
        if (success) totalFeesSettled += amount;
        else if (result.length >= 4) {
            assembly ("memory-safe") { failureSelector := mload(add(result, 0x20)) }
        }
        emit FeeSettlementAttempt(amount, success, failureSelector);
    }

    function _principalForSold(uint256 cumulativeSold) private view returns (uint256) {
        uint256 remainingVirtual = virtualTokenReserve - cumulativeSold;
        uint256 requiredVirtualNative =
            Math.mulDiv(invariantK, 1, remainingVirtual, Math.Rounding.Ceil);
        return requiredVirtualNative - virtualNativeReserve;
    }

    function _soldForPrincipal(uint256 cumulativePrincipal) private view returns (uint256) {
        uint256 virtualNative = virtualNativeReserve + cumulativePrincipal;
        uint256 remainingVirtual =
            Math.mulDiv(invariantK, 1, virtualNative, Math.Rounding.Ceil);
        return virtualTokenReserve - remainingVirtual;
    }

    function _feeOn(uint256 amount) private pure returns (uint256) {
        return Math.mulDiv(amount, FEE_BPS, BPS, Math.Rounding.Ceil);
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
    }
}
