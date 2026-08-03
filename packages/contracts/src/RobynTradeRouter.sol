// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynV4BondingCurveMarket } from "./uniswap/RobynV4BondingCurveMarket.sol";

/// @notice Canonical dapp trade wrapper. The market performs exactly one best-effort maintenance attempt.
contract RobynTradeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    string public constant CONTRACT_VERSION = "1.0.0-schema19";

    error InvalidConfiguration();
    error UnauthorizedNativeSender();
    error NativeTransferFailed();

    address private activeNativeSender;

    event RoutedBuy(
        address indexed account,
        address indexed market,
        address indexed token,
        uint256 nativeInput,
        uint256 tokenOutput
    );
    event RoutedSell(
        address indexed account,
        address indexed market,
        address indexed token,
        uint256 tokenInput,
        uint256 nativeOutput
    );

    receive() external payable {
        if (msg.sender != activeNativeSender) revert UnauthorizedNativeSender();
    }

    function buy(RobynV4BondingCurveMarket market, uint256 minimumTokenOutput)
        external
        payable
        nonReentrant
        returns (uint256 tokenOutput)
    {
        if (address(market) == address(0) || address(market).code.length == 0 || msg.value == 0) {
            revert InvalidConfiguration();
        }
        IERC20 token = IERC20(address(market.launchToken()));
        uint256 tokenBefore = token.balanceOf(address(this));
        uint256 nativeBefore = address(this).balance - msg.value;
        activeNativeSender = _nativeSender(market);
        tokenOutput = market.buy{ value: msg.value }(minimumTokenOutput);
        activeNativeSender = address(0);
        uint256 received = token.balanceOf(address(this)) - tokenBefore;
        if (received != tokenOutput) revert InvalidConfiguration();
        token.safeTransfer(msg.sender, received);
        uint256 refund = address(this).balance - nativeBefore;
        if (refund != 0) _sendNative(payable(msg.sender), refund);
        emit RoutedBuy(msg.sender, address(market), address(token), msg.value - refund, received);
    }

    function sell(RobynV4BondingCurveMarket market, uint256 tokenInput, uint256 minimumNativeOutput)
        external
        nonReentrant
        returns (uint256 nativeOutput)
    {
        if (address(market) == address(0) || address(market).code.length == 0 || tokenInput == 0) {
            revert InvalidConfiguration();
        }
        IERC20 token = IERC20(address(market.launchToken()));
        token.safeTransferFrom(msg.sender, address(this), tokenInput);
        token.forceApprove(address(market), tokenInput);
        activeNativeSender = _nativeSender(market);
        nativeOutput = market.sell(tokenInput, minimumNativeOutput);
        activeNativeSender = address(0);
        token.forceApprove(address(market), 0);
        _sendNative(payable(msg.sender), nativeOutput);
        emit RoutedSell(msg.sender, address(market), address(token), tokenInput, nativeOutput);
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
    }

    function _nativeSender(RobynV4BondingCurveMarket market) private view returns (address) {
        if (!market.graduated()) return address(market);
        return address(market.graduationAdapter().assetRouter().poolManager());
    }
}
