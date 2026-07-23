// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynDaoToken } from "./RobynDaoToken.sol";
import { RobynProtocolFeeRouter } from "./RobynProtocolFeeRouter.sol";

/// @notice Explicit deployment identity for token-attributed creator rewards.
contract RobynProtocolFeeRouterV2 is RobynProtocolFeeRouter {
    constructor(
        IERC20 baseAsset_,
        RobynDaoToken daoToken_,
        address payable treasury_,
        address guardian_
    ) RobynProtocolFeeRouter(baseAsset_, daoToken_, treasury_, guardian_) { }
}
