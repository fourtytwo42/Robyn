// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../src/RobynRdaoStaking.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynNativeProtocolFeeRouterV5 } from "../src/uniswap/RobynNativeProtocolFeeRouterV5.sol";
import { RobynV4NativeProtocolTest } from "./RobynV4NativeProtocol.t.sol";

contract Schema20FeeRouterStakingTest is RobynV4NativeProtocolTest {
    function testSchema20FeeRouterIdentityUsesInheritedImmutableEconomics() external {
        RobynNativeProtocolFeeRouterV5 schema20 = new RobynNativeProtocolFeeRouterV5(
            daoToken, assetRouter, TREASURY, GUARDIAN, 1 hours
        );
        assertEq(schema20.SCHEMA20_CONTRACT_VERSION(), "10.0.0-schema20");
        assertEq(schema20.schema20RuntimeIdentity(), keccak256("ROBYN_SCHEMA20_FEE_ROUTER_V5"));
        assertEq(address(schema20.daoToken()), address(daoToken));
        assertEq(address(schema20.assetRouter()), address(assetRouter));
        assertEq(schema20.treasury(), TREASURY);
    }

    function testTwentyPercentDaoAllocationStreamsOnlyToEligibleStakers() external {
        RobynRdaoStaking staking = new RobynRdaoStaking(
            IERC20(address(daoToken)),
            IRobynWrappedNative(address(testWrappedNative)),
            TREASURY,
            GUARDIAN,
            24 hours,
            1 hours,
            7 days
        );
        staking.configureRewardSource(address(feeRouter), true);
        staking.sealRewardSources();
        feeRouter.bindDaoRewardReceiver(address(staking));

        daoToken.approve(address(staking), 800_000_000 ether);
        staking.stake(800_000_000 ether, address(this));
        vm.warp(block.timestamp + 24 hours);
        staking.activateFor(address(this));

        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema20-staking-dao-share")));
        market.buy{ value: 0.1 ether }(1);
        uint256 assigned = feeRouter.launchAccount(address(token)).pendingDaoNative;
        assertGt(assigned, 0);
        feeRouter.settleDaoFees(address(token), assigned);
        assertEq(staking.rewardDepositCount(), 1);
        assertEq(staking.totalRewardsDeposited(), assigned);
        assertEq(feeRouter.totalDaoNativeLiability(), 0);

        vm.warp(block.timestamp + 1 hours);
        uint256 claimed = staking.claim();
        assertApproxEqAbs(claimed, assigned, 1);
        assertEq(testWrappedNative.balanceOf(address(this)), claimed);
        assertLe(staking.outstandingLiability(), 1);
    }
}
