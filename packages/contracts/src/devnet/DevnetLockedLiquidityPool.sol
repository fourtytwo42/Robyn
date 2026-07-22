// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";

/// @notice No-withdrawal AMM used only to rehearse graduated liquidity on controlled devnet.
contract DevnetLockedLiquidityPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    string public constant DEVNET_ONLY = "robyn-devnet-graduated-pool";

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAmount();
    error AlreadyInitialized();
    error NotInitialized();
    error Slippage(uint256 minimum, uint256 actual);

    IERC20 public immutable baseAsset;
    IERC20 public immutable launchToken;
    FeeBasketVault public immutable feeVault;
    address public immutable bondingMarket;
    uint16 public immutable feeBps;
    uint256 public baseReserve;
    uint256 public tokenReserve;
    bool public initialized;

    event LiquidityLocked(uint256 tokenAmount, uint256 baseAmount);

    constructor(
        IERC20 baseAsset_,
        IERC20 launchToken_,
        FeeBasketVault feeVault_,
        address bondingMarket_,
        uint16 feeBps_
    ) {
        if (
            address(baseAsset_) == address(0) || address(launchToken_) == address(0)
                || address(feeVault_) == address(0) || bondingMarket_ == address(0) || feeBps_ == 0
                || feeBps_ > 1_000
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchToken = launchToken_;
        feeVault = feeVault_;
        bondingMarket = bondingMarket_;
        feeBps = feeBps_;
    }

    function initialize() external {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        tokenReserve = launchToken.balanceOf(address(this));
        baseReserve = baseAsset.balanceOf(address(this));
        if (tokenReserve == 0 || baseReserve == 0) revert InvalidAmount();
        initialized = true;
        emit LiquidityLocked(tokenReserve, baseReserve);
    }

    function quoteBuy(uint256 baseInput)
        public
        view
        returns (uint256 feeAmount, uint256 tokenOutput)
    {
        if (!initialized) revert NotInitialized();
        if (baseInput == 0) revert InvalidAmount();
        feeAmount = (baseInput * feeBps) / BPS;
        uint256 netInput = baseInput - feeAmount;
        uint256 newTokenReserve = Math.ceilDiv(baseReserve * tokenReserve, baseReserve + netInput);
        tokenOutput = tokenReserve - newTokenReserve;
    }

    function quoteSell(uint256 tokenInput)
        public
        view
        returns (uint256 feeAmount, uint256 baseOutput)
    {
        if (!initialized) revert NotInitialized();
        if (tokenInput == 0) revert InvalidAmount();
        uint256 newBaseReserve = Math.ceilDiv(baseReserve * tokenReserve, tokenReserve + tokenInput);
        uint256 grossOutput = baseReserve - newBaseReserve;
        feeAmount = (grossOutput * feeBps) / BPS;
        baseOutput = grossOutput - feeAmount;
    }

    function buyFor(address recipient, uint256 baseInput, uint256 minimumTokenOutput)
        external
        nonReentrant
        returns (uint256 tokenOutput)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        (uint256 feeAmount, uint256 quotedOutput) = quoteBuy(baseInput);
        tokenOutput = quotedOutput;
        if (tokenOutput == 0) revert InvalidAmount();
        if (tokenOutput < minimumTokenOutput) revert Slippage(minimumTokenOutput, tokenOutput);
        baseAsset.safeTransferFrom(msg.sender, address(this), baseInput);
        baseReserve += baseInput - feeAmount;
        tokenReserve -= tokenOutput;
        _recordFee(feeAmount);
        launchToken.safeTransfer(recipient, tokenOutput);
    }

    function sellFor(address recipient, uint256 tokenInput, uint256 minimumBaseOutput)
        external
        nonReentrant
        returns (uint256 baseOutput)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        (uint256 feeAmount, uint256 quotedOutput) = quoteSell(tokenInput);
        baseOutput = quotedOutput;
        if (baseOutput == 0) revert InvalidAmount();
        if (baseOutput < minimumBaseOutput) revert Slippage(minimumBaseOutput, baseOutput);
        launchToken.safeTransferFrom(msg.sender, address(this), tokenInput);
        tokenReserve += tokenInput;
        baseReserve -= baseOutput + feeAmount;
        _recordFee(feeAmount);
        baseAsset.safeTransfer(recipient, baseOutput);
    }

    function _recordFee(uint256 feeAmount) private {
        if (feeAmount == 0) revert InvalidAmount();
        baseAsset.forceApprove(address(feeVault), feeAmount);
        feeVault.recordFees(feeAmount);
        baseAsset.forceApprove(address(feeVault), 0);
    }
}

