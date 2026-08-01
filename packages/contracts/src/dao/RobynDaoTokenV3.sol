// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynDaoToken } from "./RobynDaoToken.sol";

interface IRobynSchema18BootstrapFinalizer {
    function finalizeBootstrapFromToken() external;

    function bootstrapToken() external view returns (address);

    function bootstrapOwner() external view returns (address);
}

/// @notice Schema-18 RDAO with corrected reward accounting and irreversible bootstrap cutoff.
contract RobynDaoTokenV3 is RobynDaoToken {
    address public immutable bootstrapOwner;
    address public immutable bootstrapBindingAuthority;
    IRobynSchema18BootstrapFinalizer public bootstrapController;

    error BootstrapControllerAlreadyBound();
    error BootstrapControllerNotBound();

    event BootstrapControllerBound(address indexed controller);

    constructor(
        address[] memory recipients,
        uint256[] memory amounts,
        uint256 rewardStreamDuration,
        address bootstrapOwner_
    ) RobynDaoToken(recipients, amounts, rewardStreamDuration) {
        if (
            recipients.length != 1 || recipients[0] != bootstrapOwner_ || amounts[0] != FIXED_SUPPLY
                || bootstrapOwner_ == address(0)
        ) revert InvalidConfiguration();
        bootstrapOwner = bootstrapOwner_;
        bootstrapBindingAuthority = msg.sender;
    }

    function bindBootstrapController(address controller) external {
        if (msg.sender != bootstrapBindingAuthority) revert Unauthorized();
        if (address(bootstrapController) != address(0)) revert BootstrapControllerAlreadyBound();
        if (controller == address(0) || controller.code.length == 0) {
            revert InvalidConfiguration();
        }
        IRobynSchema18BootstrapFinalizer candidate =
            IRobynSchema18BootstrapFinalizer(controller);
        if (
            candidate.bootstrapToken() != address(this)
                || candidate.bootstrapOwner() != bootstrapOwner
        ) revert InvalidConfiguration();
        bootstrapController = candidate;
        emit BootstrapControllerBound(controller);
    }

    function _update(address from, address to, uint256 value) internal override {
        bool distributed = from != address(0) && from == bootstrapOwner && to != bootstrapOwner
            && to != address(0) && value != 0;
        if (distributed && address(bootstrapController) == address(0)) {
            revert BootstrapControllerNotBound();
        }
        super._update(from, to, value);
        if (distributed) bootstrapController.finalizeBootstrapFromToken();
    }
}
