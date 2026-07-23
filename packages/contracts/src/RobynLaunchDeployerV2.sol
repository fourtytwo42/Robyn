// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FeeBasketVault, IRobynConversionRouter } from "./FeeBasketVault.sol";
import { RobynLaunchToken } from "./RobynLaunchToken.sol";

/// @notice Size-bounded CREATE2 helper controlled by one v2 launch factory.
contract RobynLaunchDeployerV2 {
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
        IERC20 baseAsset,
        IRobynConversionRouter conversionRouter,
        address[] calldata assets,
        uint16[] calldata weights,
        uint256 minimumConversionBase,
        uint256 maximumPendingDelay
    ) external returns (FeeBasketVault vault) {
        if (msg.sender != controller) revert Unauthorized();
        vault = new FeeBasketVault{ salt: salt }(
            baseAsset,
            conversionRouter,
            controller,
            assets,
            weights,
            minimumConversionBase,
            maximumPendingDelay
        );
    }

    function deployToken(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        address supplyRecipient,
        uint256 initialSupply,
        address vault,
        address[] calldata assets
    ) external returns (RobynLaunchToken token) {
        if (msg.sender != controller) revert Unauthorized();
        token = new RobynLaunchToken{ salt: salt }(
            name, symbol, supplyRecipient, initialSupply, vault, assets
        );
    }

    function sealExclusions(RobynLaunchToken token, address[] calldata accounts) external {
        if (msg.sender != controller) revert Unauthorized();
        token.sealExclusions(accounts);
    }

    function predictVault(
        bytes32 salt,
        IERC20 baseAsset,
        IRobynConversionRouter conversionRouter,
        address[] calldata assets,
        uint16[] calldata weights,
        uint256 minimumConversionBase,
        uint256 maximumPendingDelay
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(FeeBasketVault).creationCode,
                abi.encode(
                    baseAsset,
                    conversionRouter,
                    controller,
                    assets,
                    weights,
                    minimumConversionBase,
                    maximumPendingDelay
                )
            )
        );
        return _create2Address(salt, initCodeHash);
    }

    function predictToken(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        address supplyRecipient,
        uint256 initialSupply,
        address vault,
        address[] calldata assets
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(RobynLaunchToken).creationCode,
                abi.encode(name, symbol, supplyRecipient, initialSupply, vault, assets)
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
