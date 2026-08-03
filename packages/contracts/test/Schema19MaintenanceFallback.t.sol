// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { RobynDaoRewardDistributor } from "../src/RobynDaoRewardDistributor.sol";
import { RobynMaintenanceCoordinator } from "../src/RobynMaintenanceCoordinator.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynTradeRouter } from "../src/RobynTradeRouter.sol";
import { IRobynMaintenanceCoordinator } from "../src/interfaces/IRobynMaintenanceCoordinator.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynV4AssetRouter } from "../src/uniswap/RobynV4AssetRouter.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4LaunchCoordinatorV7 } from "../src/uniswap/RobynV4LaunchCoordinatorV7.sol";
import { RobynV4NativeProtocolTest } from "./RobynV4NativeProtocol.t.sol";

contract Schema19GasExhaustingMaintenance is IRobynMaintenanceCoordinator {
    uint256 public constant taskGasLimit = 100_000;

    function processRewards(address) external pure returns (bool) {
        while (true) { }
        return false;
    }
}

contract Schema19MaintenanceFallbackTest is RobynV4NativeProtocolTest {
    function testSchema19CoordinatorStartsPublicOnlyWithBoundMaintenance() public {
        RobynMaintenanceCoordinator maintenance =
            new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        feeRouter.bindMaintenanceCoordinator(address(maintenance));
        RobynDaoRewardDistributor daoRewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        daoRewards.bindRewardDepositor(address(feeRouter));
        feeRouter.bindDaoRewardReceiver(address(daoRewards));
        RobynTradeRouter trades = new RobynTradeRouter();
        RobynV4LaunchCoordinatorV7 publicCoordinator = new RobynV4LaunchCoordinatorV7(
            launchFactory, marketFactory, feeRouter, trades, TREASURY, GUARDIAN
        );

        assertEq(
            uint256(publicCoordinator.launchMode()),
            uint256(RobynV4LaunchCoordinatorV7.LaunchMode.Public),
            "Schema-19 must be Public at construction"
        );
        assertEq(feeRouter.maintenanceCoordinator(), address(maintenance));
    }

    function testReusedRdaoReceivesSchema19CheckpointedRewards() public {
        daoToken.delegate(address(this));
        RobynDaoRewardDistributor daoRewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        daoRewards.bindRewardDepositor(address(feeRouter));
        feeRouter.bindDaoRewardReceiver(address(daoRewards));
        vm.warp(block.timestamp + 1);
        assertEq(daoToken.getPastVotes(address(this), block.timestamp - 1), daoToken.totalSupply());
        assertEq(daoToken.getPastTotalSupply(block.timestamp - 1), daoToken.totalSupply());
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema19-dao-rewards")));
        market.buy{ value: 0.1 ether }(1);
        uint256 assigned = feeRouter.totalDaoNativeLiability();
        assertGt(assigned, 0);

        feeRouter.settleDaoFees(address(token), assigned);
        assertEq(feeRouter.totalDaoNativeLiability(), 0);
        assertEq(daoRewards.totalRewardsDeposited(), assigned);
        vm.warp(block.timestamp + 1 hours);
        uint256 nativeBefore = address(this).balance;
        uint256 claimed = daoRewards.claimFor(address(this), 1);
        assertEq(claimed, assigned);
        assertEq(address(this).balance, nativeBefore + assigned);
        assertEq(daoRewards.outstandingLiability(), 0);
    }

    function testSchedulerVisitsEveryTaskAndSettlesAssignedLiabilities() public {
        RobynMaintenanceCoordinator maintenance =
            new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        feeRouter.bindMaintenanceCoordinator(address(maintenance));
        RobynDaoRewardDistributor daoRewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        daoRewards.bindRewardDepositor(address(feeRouter));
        feeRouter.bindDaoRewardReceiver(address(daoRewards));
        vm.warp(block.timestamp + 1);

        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema19-all-tasks")));
        market.buy{ value: 0.1 ether }(1);
        uint256 initialTask = maintenance.nextTask(address(token));
        uint256 initialAttempts = maintenance.attemptCount(address(token));
        assertGt(feeRouter.totalBasketNativeLiability(), 0);
        assertGt(feeRouter.totalDaoNativeLiability(), 0);
        assertGt(feeRouter.totalTreasuryNativeLiability(), 0);

        for (uint256 task; task < maintenance.TASK_COUNT(); ++task) {
            maintenance.processRewards(address(token));
        }

        assertEq(maintenance.nextTask(address(token)), initialTask, "scheduler wrapped");
        assertEq(
            maintenance.attemptCount(address(token)), initialAttempts + maintenance.TASK_COUNT()
        );
        assertTrue(maintenance.successCount(address(token)) >= 4, "assigned liabilities converted");
        assertEq(feeRouter.totalBasketNativeLiability(), 0, "basket settled");
        assertEq(feeRouter.totalDaoNativeLiability(), 0, "DAO settled");
        uint256 treasuryClaimable = feeRouter.claimableTreasuryNative();
        assertGt(treasuryClaimable, 0, "treasury settlement becomes pull claimable");
        assertEq(
            feeRouter.totalTreasuryNativeLiability(),
            treasuryClaimable,
            "settlement preserves treasury liability until claim"
        );
        vm.prank(TREASURY);
        assertEq(feeRouter.claimTreasuryFees(), treasuryClaimable, "treasury pulls assigned fees");
        assertEq(feeRouter.totalTreasuryNativeLiability(), 0, "treasury claim clears liability");
        for (uint256 task; task < maintenance.TASK_COUNT(); ++task) {
            maintenance.processRewards(address(token));
        }
        assertGt(feeRouter.totalCreatorNativeLiability(), 0, "creator remains pull based");
        assertEq(
            vault.totalPendingNative() + vault.totalNativeConsumed(),
            vault.totalFeesReceived(),
            "vault conservation"
        );
        assertEq(
            daoRewards.totalRewardsDeposited(),
            feeRouter.launchAccount(address(token)).cumulativeDaoNativeSettled
        );
    }

    function testTradeRouterReturnsAssetsAndNativeWithoutRetainingAllowance() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema19-trade-router")));
        feeRouter.bindMaintenanceCoordinator(address(new Schema19GasExhaustingMaintenance()));
        RobynTradeRouter trades = new RobynTradeRouter();

        uint256 bought = trades.buy{ value: 0.1 ether }(market, 1);
        assertEq(token.balanceOf(address(trades)), 0);
        assertEq(token.balanceOf(address(this)), bought);
        token.approve(address(trades), bought / 2);
        uint256 nativeBefore = address(this).balance;
        uint256 sold = trades.sell(market, bought / 2, 1);
        assertEq(address(this).balance, nativeBefore + sold);
        assertEq(token.allowance(address(trades), address(market)), 0);
        assertEq(token.balanceOf(address(trades)), 0);
        assertEq(address(trades).balance, 0);
    }

    function testBondingBuyAndSellSurviveExhaustedMaintenanceGas() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema19-gas-isolation")));
        feeRouter.bindMaintenanceCoordinator(address(new Schema19GasExhaustingMaintenance()));

        uint256 bought = market.buy{ value: 0.1 ether }(1);
        assertGt(bought, 0, "buy must survive maintenance failure");
        token.approve(address(market), bought / 2);
        uint256 sold = market.sell(bought / 2, 1);
        assertGt(sold, 0, "sell must survive maintenance failure");
    }

    function testObjectiveFailuresFallbackOnlyPendingLegThenRetryPrimary() public {
        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault,) =
            coordinator.createLaunch(_request(keccak256("schema19-fallback")));
        assertEq(token.rewardAssetCount(), 2, "primary plus canonical WETH reward");
        vault.recordFees{ value: 0.01 ether }();
        assetRouter.configureWrappedNativeRoute(0.25 ether, true);
        _configureBasketRoute(type(uint128).max);

        vault.processNextLeg();
        vm.warp(block.timestamp + 24 hours);
        vault.processNextLeg();
        vm.warp(block.timestamp + 24 hours);
        vault.processNextLeg();
        vm.warp(block.timestamp + 24 hours);
        (bool converted,, bool usedFallback) = vault.processNextLeg();

        assertTrue(converted, "eligible current failure must convert fallback");
        assertTrue(usedFallback, "conversion must use canonical WETH");
        RobynNativeBasketVaultV2.BasketLeg memory afterFallback = vault.leg(0);
        assertEq(afterFallback.pendingNative, 0, "only pending allocation consumed");
        assertEq(afterFallback.failureObservations, 0, "fallback resets observations");
        assertGt(afterFallback.fallbackRewardsDeposited, 0, "WETH reward deposited");
        assertEq(
            vault.totalPendingNative() + vault.totalNativeConsumed(), vault.totalFeesReceived()
        );

        vault.recordFees{ value: 0.01 ether }();
        _configureBasketRoute(1);
        (converted,, usedFallback) = vault.processNextLeg();
        assertTrue(converted, "future batch must retry recovered primary");
        assertFalse(usedFallback, "future batch must not remain on fallback");
        RobynNativeBasketVaultV2.BasketLeg memory afterRecovery = vault.leg(0);
        assertGt(afterRecovery.rewardsDeposited, 0, "primary reward deposited after recovery");
        assertEq(
            vault.totalPendingNative() + vault.totalNativeConsumed(), vault.totalFeesReceived()
        );
    }

    function testSuccessfulPrimaryQuoteResetsFailureHistoryBeforeFallback() public {
        (, RobynNativeBasketVaultV2 vault,) =
            coordinator.createLaunch(_request(keccak256("schema19-recovery-reset")));
        vault.recordFees{ value: 0.01 ether }();
        _configureBasketRoute(type(uint128).max);
        vault.processNextLeg();
        vm.warp(block.timestamp + 24 hours);
        vault.processNextLeg();
        assertEq(vault.leg(0).failureObservations, 2);

        _configureBasketRoute(1);
        (bool converted,, bool usedFallback) = vault.processNextLeg();
        assertTrue(converted);
        assertFalse(usedFallback);
        assertEq(vault.leg(0).failureObservations, 0);
    }

    function testGlobalConversionPauseNeverCountsAsLegFailure() public {
        (, RobynNativeBasketVaultV2 vault,) =
            coordinator.createLaunch(_request(keccak256("schema19-global-pause")));
        vault.recordFees{ value: 0.01 ether }();

        vm.prank(GUARDIAN);
        assetRouter.pauseConversions();
        (bool converted,, bool usedFallback) = vault.processNextLeg();

        assertFalse(converted);
        assertFalse(usedFallback);
        RobynNativeBasketVaultV2.BasketLeg memory pausedLeg = vault.leg(0);
        assertEq(pausedLeg.failureObservations, 0, "global pause is not a route failure");
        assertEq(pausedLeg.pendingNative, 0.01 ether, "pending allocation remains attributed");
    }

    function testGuardianReasonCannotManufactureObjectiveFallbackObservation() public {
        (, RobynNativeBasketVaultV2 vault,) =
            coordinator.createLaunch(_request(keccak256("schema19-stale-oracle")));
        vault.recordFees{ value: 0.01 ether }();
        bytes32 staleOracle = keccak256("STALE_REFERENCE_PRICE");

        vm.prank(GUARDIAN);
        assetRouter.disableRoute(address(basketAsset), staleOracle);
        RobynV4AssetRouter.RouteStatus memory status = assetRouter.routeStatus(address(basketAsset));
        assertFalse(status.ready);
        assertEq(status.reason, staleOracle);

        vault.processNextLeg();
        RobynNativeBasketVaultV2.BasketLeg memory failedLeg = vault.leg(0);
        assertEq(failedLeg.failureObservations, 0);
        assertEq(failedLeg.lastFailureReason, bytes32(0));
        assertEq(failedLeg.pendingNative, 0.01 ether);
    }

    function _configureBasketRoute(uint128 minimumLiquidity) private {
        assetRouter.configureRoute(
            address(basketAsset),
            RobynV4AssetRouter.Route({
                fee: 3_000,
                tickSpacing: 60,
                hooks: IHooks(address(0)),
                minimumLiquidity: minimumLiquidity,
                maximumNativeInput: 0.25 ether,
                referenceTick: 0,
                maximumReferenceTickDeviation: 198,
                enforceReferencePrice: true,
                verificationClass: keccak256("TEST_BASKET_ASSET"),
                enabled: true
            })
        );
    }
}
