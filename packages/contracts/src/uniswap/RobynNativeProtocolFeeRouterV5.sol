// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynDaoToken } from "../dao/RobynDaoToken.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";
import { RobynNativeProtocolFeeRouterV4 } from "./RobynNativeProtocolFeeRouterV4.sol";

/// @notice Schema-20 deployment identity for the immutable 50/25/20/5 native fee router.
/// @dev The accounting implementation is intentionally inherited unchanged; Schema-20 binds its
///      one-time DAO receiver to RobynRdaoStaking instead of the Schema-19 vote-snapshot receiver.
contract RobynNativeProtocolFeeRouterV5 is RobynNativeProtocolFeeRouterV4 {
    string public constant SCHEMA20_CONTRACT_VERSION = "10.0.0-schema20";

    constructor(
        RobynDaoToken daoToken_,
        RobynV4AssetRouter assetRouter_,
        address payable treasury_,
        address guardian_,
        uint256 creatorRewardStreamDuration_
    ) RobynNativeProtocolFeeRouterV4(
        daoToken_, assetRouter_, treasury_, guardian_, creatorRewardStreamDuration_
    ) { }
}
