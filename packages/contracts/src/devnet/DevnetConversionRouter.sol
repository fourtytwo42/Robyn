// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IRobynConversionRouter } from "../FeeBasketVault.sol";

/// @notice Deterministic fixed-rate conversion fixture for the controlled devnet only.
contract DevnetConversionRouter is IRobynConversionRouter, Ownable {
    using SafeERC20 for IERC20;

    string public constant DEVNET_ONLY = "robyn-devnet";

    error InvalidRate();
    error RouteUnavailable();
    error Expired();
    error InsufficientOutput(uint256 minimum, uint256 actual);

    mapping(address => mapping(address => uint256)) public rate;
    mapping(address => mapping(address => bool)) public routePaused;

    event RateSet(address indexed inputToken, address indexed outputToken, uint256 rate);
    event RoutePauseSet(address indexed inputToken, address indexed outputToken, bool paused);
    event MockSwap(
        address indexed inputToken,
        address indexed outputToken,
        address indexed recipient,
        uint256 inputAmount,
        uint256 outputAmount
    );

    constructor(address owner_) Ownable(owner_) { }

    function setRate(address inputToken, address outputToken, uint256 rate_) external onlyOwner {
        if (inputToken == address(0) || outputToken == address(0) || rate_ == 0) {
            revert InvalidRate();
        }
        rate[inputToken][outputToken] = rate_;
        emit RateSet(inputToken, outputToken, rate_);
    }

    function setRoutePaused(address inputToken, address outputToken, bool paused)
        external
        onlyOwner
    {
        routePaused[inputToken][outputToken] = paused;
        emit RoutePauseSet(inputToken, outputToken, paused);
    }

    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 outputAmount) {
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert Expired();
        uint256 configuredRate = rate[inputToken][outputToken];
        if (configuredRate == 0 || routePaused[inputToken][outputToken]) revert RouteUnavailable();
        outputAmount = (amountIn * configuredRate) / 1e18;
        if (outputAmount < minimumAmountOut) {
            revert InsufficientOutput(minimumAmountOut, outputAmount);
        }
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(outputToken).safeTransfer(recipient, outputAmount);
        emit MockSwap(inputToken, outputToken, recipient, amountIn, outputAmount);
    }
}
