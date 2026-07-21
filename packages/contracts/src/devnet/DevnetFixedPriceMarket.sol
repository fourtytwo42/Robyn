// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";

/// @notice Fixed-price trading and fee-generation fixture for the controlled devnet only.
contract DevnetFixedPriceMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    string public constant DEVNET_ONLY = "robyn-devnet";

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAmount();
    error Slippage(uint256 minimum, uint256 actual);

    IERC20 public immutable baseAsset;
    RobynLaunchToken public immutable launchToken;
    FeeBasketVault public immutable feeVault;
    address public immutable marketOwner;
    uint256 public immutable basePerToken;
    uint16 public immutable feeBps;

    event LiquiditySeeded(address indexed provider, uint256 tokenAmount, uint256 baseAmount);
    event Bought(address indexed buyer, uint256 baseInput, uint256 feeAmount, uint256 tokenOutput);
    event Sold(address indexed seller, uint256 tokenInput, uint256 feeAmount, uint256 baseOutput);

    constructor(
        IERC20 baseAsset_,
        RobynLaunchToken launchToken_,
        FeeBasketVault feeVault_,
        address marketOwner_,
        uint256 basePerToken_,
        uint16 feeBps_
    ) {
        if (
            address(baseAsset_) == address(0) || address(launchToken_) == address(0)
                || address(feeVault_) == address(0) || marketOwner_ == address(0)
                || basePerToken_ == 0 || feeBps_ == 0 || feeBps_ > 1_000
                || address(feeVault_.baseAsset()) != address(baseAsset_)
                || address(feeVault_.launchToken()) != address(launchToken_)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchToken = launchToken_;
        feeVault = feeVault_;
        marketOwner = marketOwner_;
        basePerToken = basePerToken_;
        feeBps = feeBps_;
    }

    function seed(uint256 tokenAmount, uint256 baseAmount) external nonReentrant {
        if (msg.sender != marketOwner) revert Unauthorized();
        if (tokenAmount == 0 || baseAmount == 0) revert InvalidAmount();
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenAmount);
        baseAsset.safeTransferFrom(msg.sender, address(this), baseAmount);
        emit LiquiditySeeded(msg.sender, tokenAmount, baseAmount);
    }

    function buy(uint256 baseInput, uint256 minimumTokenOutput)
        external
        nonReentrant
        returns (uint256 tokenOutput)
    {
        if (baseInput == 0) revert InvalidAmount();
        baseAsset.safeTransferFrom(msg.sender, address(this), baseInput);
        uint256 feeAmount = (baseInput * feeBps) / BPS;
        uint256 tradedBase = baseInput - feeAmount;
        tokenOutput = (tradedBase * 1e18) / basePerToken;
        if (tokenOutput < minimumTokenOutput) {
            revert Slippage(minimumTokenOutput, tokenOutput);
        }
        _recordFee(feeAmount);
        IERC20(address(launchToken)).safeTransfer(msg.sender, tokenOutput);
        emit Bought(msg.sender, baseInput, feeAmount, tokenOutput);
    }

    function sell(uint256 tokenInput, uint256 minimumBaseOutput)
        external
        nonReentrant
        returns (uint256 baseOutput)
    {
        if (tokenInput == 0) revert InvalidAmount();
        IERC20(address(launchToken)).safeTransferFrom(msg.sender, address(this), tokenInput);
        uint256 grossBase = (tokenInput * basePerToken) / 1e18;
        uint256 feeAmount = (grossBase * feeBps) / BPS;
        baseOutput = grossBase - feeAmount;
        if (baseOutput < minimumBaseOutput) {
            revert Slippage(minimumBaseOutput, baseOutput);
        }
        _recordFee(feeAmount);
        baseAsset.safeTransfer(msg.sender, baseOutput);
        emit Sold(msg.sender, tokenInput, feeAmount, baseOutput);
    }

    function quoteBuy(uint256 baseInput)
        external
        view
        returns (uint256 feeAmount, uint256 tokenOutput)
    {
        feeAmount = (baseInput * feeBps) / BPS;
        tokenOutput = ((baseInput - feeAmount) * 1e18) / basePerToken;
    }

    function quoteSell(uint256 tokenInput)
        external
        view
        returns (uint256 feeAmount, uint256 baseOutput)
    {
        uint256 grossBase = (tokenInput * basePerToken) / 1e18;
        feeAmount = (grossBase * feeBps) / BPS;
        baseOutput = grossBase - feeAmount;
    }

    function _recordFee(uint256 feeAmount) private {
        if (feeAmount == 0) revert InvalidAmount();
        baseAsset.forceApprove(address(feeVault), feeAmount);
        feeVault.recordFees(feeAmount);
        baseAsset.forceApprove(address(feeVault), 0);
    }
}
