// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynLaunchToken } from "../RobynLaunchToken.sol";

/// @notice CREATE2 launch-token helper controlled by one native-ETH launch factory.
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
    uint256 public immutable rewardStreamDuration;
    address public controller;

    constructor(uint256 rewardStreamDuration_) {
        if (rewardStreamDuration_ == 0 || rewardStreamDuration_ > 7 days) {
            revert InvalidController();
        }
        initializer = msg.sender;
        rewardStreamDuration = rewardStreamDuration_;
    }

    function bindController(address controller_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (controller != address(0)) revert AlreadyBound();
        if (controller_ == address(0) || controller_.code.length == 0) {
            revert InvalidController();
        }
        controller = controller_;
    }

    function deployToken(bytes32 salt, TokenRequest calldata request)
        external
        returns (RobynLaunchToken token)
    {
        if (msg.sender != controller) revert Unauthorized();
        token = new RobynLaunchToken{ salt: salt }(
            request.name,
            request.symbol,
            request.supplyRecipient,
            request.initialSupply,
            request.vault,
            request.assets,
            request.tokenUri
        );
        token.configureRewardStreamDuration(rewardStreamDuration);
    }

    function sealExclusions(RobynLaunchToken token, address[] calldata accounts) external {
        if (msg.sender != controller) revert Unauthorized();
        token.sealExclusions(accounts);
    }

    function predictToken(bytes32 salt, TokenRequest calldata request)
        external
        view
        returns (address)
    {
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
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }
}
