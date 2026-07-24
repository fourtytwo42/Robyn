// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RobynLaunchToken} from "../RobynLaunchToken.sol";
import {RobynNativeBasketVaultV2} from "./RobynNativeBasketVaultV2.sol";
import {RobynV4AssetRouter} from "./RobynV4AssetRouter.sol";

/// @notice CREATE2 helper controlled by one native-ETH launch factory.
contract RobynNativeLaunchDeployerV4 {
    error Unauthorized();
    error AlreadyBound();
    error InvalidController();

    struct TokenRequest {
        string name;
        string symbol;
        address supplyRecipient;
        uint256 initialSupply;
        address vault;
        address[] assets;
        string tokenUri;
    }

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
        vault = new RobynNativeBasketVaultV2{salt: salt}(
            assetRouter, controller, assets, weights, minimumConversionNative, maximumPendingDelay
        );
    }

    function deployToken(bytes32 salt, TokenRequest calldata request) external returns (RobynLaunchToken token) {
        if (msg.sender != controller) revert Unauthorized();
        token = new RobynLaunchToken{salt: salt}(
            request.name,
            request.symbol,
            request.supplyRecipient,
            request.initialSupply,
            request.vault,
            request.assets,
            request.tokenUri
        );
    }

    function sealExclusions(RobynLaunchToken token, address[] calldata accounts) external {
        if (msg.sender != controller) revert Unauthorized();
        token.sealExclusions(accounts);
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
                abi.encode(assetRouter, controller, assets, weights, minimumConversionNative, maximumPendingDelay)
            )
        );
        return _create2Address(salt, initCodeHash);
    }

    function predictToken(bytes32 salt, TokenRequest calldata request) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(RobynLaunchToken).creationCode,
                abi.encode(
                    request.name,
                    request.symbol,
                    request.supplyRecipient,
                    request.initialSupply,
                    request.vault,
                    request.assets,
                    request.tokenUri
                )
            )
        );
        return _create2Address(salt, initCodeHash);
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
