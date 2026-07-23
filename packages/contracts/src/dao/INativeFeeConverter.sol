// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface INativeFeeConverter {
    function convertBaseToNative(
        IERC20 baseAsset,
        uint256 amount,
        uint256 minimumNativeOut,
        uint256 deadline,
        address payable recipient
    ) external returns (uint256 nativeOut);

    function convertLaunchToBase(
        IERC20 launchToken,
        IERC20 baseAsset,
        uint256 amount,
        uint256 minimumBaseOut,
        uint256 deadline,
        address recipient
    ) external returns (uint256 baseOut);
}
