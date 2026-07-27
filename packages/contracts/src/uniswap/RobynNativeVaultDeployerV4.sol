// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynNativeBasketVaultV2 } from "./RobynNativeBasketVaultV2.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";

/// @notice CREATE2 basket-vault helper controlled by one native-ETH launch factory.
contract RobynNativeVaultDeployerV4 {
    error Unauthorized();
    error AlreadyBound();
    error InvalidController();

    address public immutable initializer;
    address public controller;

    constructor() {
        initializer = msg.sender;
    }

    function bindController(address controller_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (controller != address(0)) revert AlreadyBound();
        if (controller_ == address(0) || controller_.code.length == 0) {
            revert InvalidController();
        }
        controller = controller_;
    }

    function deployVault(
        bytes32 salt,
        RobynV4AssetRouter assetRouter,
        address[] calldata assets,
        uint16[] calldata weights,
        uint256 minimumConversionNative,
        uint256 maximumPendingDelay
    ) external returns (RobynNativeBasketVaultV2 vault) {
        if (msg.sender != controller) revert Unauthorized();
        vault = new RobynNativeBasketVaultV2{ salt: salt }(
            assetRouter, controller, assets, weights, minimumConversionNative, maximumPendingDelay
        );
    }

    function predictVault(
        bytes32 salt,
        RobynV4AssetRouter assetRouter,
        address[] calldata assets,
        uint16[] calldata weights,
        uint256 minimumConversionNative,
        uint256 maximumPendingDelay
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(RobynNativeBasketVaultV2).creationCode,
                abi.encode(
                    assetRouter,
                    controller,
                    assets,
                    weights,
                    minimumConversionNative,
                    maximumPendingDelay
                )
            )
        );
        return _create2Address(salt, initCodeHash);
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }
}
