// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { RobynClaimsRouter } from "../src/RobynClaimsRouter.sol";
import { IRobynMaintenanceCoordinator } from "../src/interfaces/IRobynMaintenanceCoordinator.sol";
import { RobynDaoRewardDistributor } from "../src/RobynDaoRewardDistributor.sol";
import { RobynMaintenanceCoordinator } from "../src/RobynMaintenanceCoordinator.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynTradeRouter } from "../src/RobynTradeRouter.sol";
import { RobynDaoTokenV3 } from "../src/dao/RobynDaoTokenV3.sol";
import { RobynNativeLaunchFactoryV4 } from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4LaunchCoordinatorV7 } from "../src/uniswap/RobynV4LaunchCoordinatorV7.sol";
import { Schema19MaintenanceFallbackTest } from "./Schema19MaintenanceFallback.t.sol";
import { RejectNative, V4TestAsset } from "./RobynV4NativeProtocol.t.sol";

contract Schema19CoverageBranchesTest is Schema19MaintenanceFallbackTest {
    function testSchema19TradeRouterRejectsEveryInvalidAdmissionShape() public {
        RobynTradeRouter trades = new RobynTradeRouter();
        RobynV4BondingCurveMarket zeroMarket = RobynV4BondingCurveMarket(payable(address(0)));
        RobynV4BondingCurveMarket eoaMarket = RobynV4BondingCurveMarket(payable(address(0x123456)));

        vm.expectRevert(RobynTradeRouter.InvalidConfiguration.selector);
        trades.buy{ value: 1 }(zeroMarket, 1);
        vm.expectRevert(RobynTradeRouter.InvalidConfiguration.selector);
        trades.buy{ value: 1 }(eoaMarket, 1);

        (,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema19-trade-zero-value")));
        vm.expectRevert(RobynTradeRouter.InvalidConfiguration.selector);
        trades.buy(market, 1);

        vm.expectRevert(RobynTradeRouter.InvalidConfiguration.selector);
        trades.sell(zeroMarket, 1, 1);
        vm.expectRevert(RobynTradeRouter.InvalidConfiguration.selector);
        trades.sell(eoaMarket, 1, 1);
        vm.expectRevert(RobynTradeRouter.InvalidConfiguration.selector);
        trades.sell(market, 0, 1);

        (bool accepted,) = payable(address(trades)).call{ value: 1 }("");
        assertFalse(accepted, "router rejects unsolicited native value");
    }

    function testSchema19MaintenanceRejectsInvalidEnvelopeAndUnknownLaunches() public {
        vm.expectRevert(RobynMaintenanceCoordinator.InvalidConfiguration.selector);
        new RobynMaintenanceCoordinator(feeRouter, assetRouter, 99_999);
        vm.expectRevert(RobynMaintenanceCoordinator.InvalidConfiguration.selector);
        new RobynMaintenanceCoordinator(feeRouter, assetRouter, 2_000_001);

        RobynMaintenanceCoordinator maintenance =
            new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        assertFalse(maintenance.processRewards(address(0xBADD)));

        vm.expectRevert(RobynMaintenanceCoordinator.Unauthorized.selector);
        maintenance.executeTask(address(0xBADD), RobynMaintenanceCoordinator.Task.CollectLockerFees);
        vm.prank(address(maintenance));
        vm.expectRevert(RobynMaintenanceCoordinator.UnknownLaunch.selector);
        maintenance.executeTask(address(0xBADD), RobynMaintenanceCoordinator.Task.CollectLockerFees);
    }

    function testSchema19DaoDistributorRejectsInvalidConfigurationAndAdmissions() public {
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        new RobynDaoRewardDistributor(IVotes(address(0)), 1 hours);
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        new RobynDaoRewardDistributor(IVotes(address(0x123456)), 1 hours);
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        new RobynDaoRewardDistributor(IVotes(address(daoToken)), 0);

        RobynDaoRewardDistributor rewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        vm.prank(address(0xBADD));
        vm.expectRevert(RobynDaoRewardDistributor.Unauthorized.selector);
        rewards.bindRewardDepositor(address(this));
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.bindRewardDepositor(address(0));
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.bindRewardDepositor(address(0x123456));
        rewards.bindRewardDepositor(address(this));
        vm.expectRevert(RobynDaoRewardDistributor.AlreadyBound.selector);
        rewards.bindRewardDepositor(address(this));

        vm.prank(address(0xBADD));
        vm.deal(address(0xBADD), 1);
        vm.expectRevert(RobynDaoRewardDistributor.Unauthorized.selector);
        rewards.depositRewards{ value: 1 }(address(basketAsset));
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.depositRewards{ value: 1 }(address(0));
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.depositRewards(address(basketAsset));
        RobynDaoRewardDistributor zeroClock =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        zeroClock.bindRewardDepositor(address(this));
        vm.warp(0);
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        zeroClock.depositRewards{ value: 1 }(address(basketAsset));
        vm.warp(1);

        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.epoch(0);
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.claimFor(address(0), 1);
        vm.expectRevert(RobynDaoRewardDistributor.InvalidConfiguration.selector);
        rewards.claim(0);
        vm.expectRevert(RobynDaoRewardDistributor.NothingToClaim.selector);
        rewards.claim(1);
        (uint256 amount, uint256 nextEpoch) = rewards.claimable(address(0), 1);
        assertEq(amount, 0);
        assertEq(nextEpoch, 0);
        (amount, nextEpoch) = rewards.claimable(address(this), 0);
        assertEq(amount, 0);
        assertEq(nextEpoch, 0);
    }

    function testSchema19DaoDistributorStreamsAcrossBoundedEpochPages() public {
        daoToken.delegate(address(this));
        vm.warp(block.timestamp + 1);
        RobynDaoRewardDistributor rewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        rewards.bindRewardDepositor(address(this));
        rewards.depositRewards{ value: 1 ether }(address(basketAsset));
        vm.warp(block.timestamp + 30 minutes);
        rewards.depositRewards{ value: 2 ether }(address(basketAsset));

        (uint256 partialClaimable, uint256 nextEpoch) = rewards.claimable(address(this), 1);
        assertGt(partialClaimable, 0);
        assertEq(nextEpoch, 0, "active epoch remains current");
        uint256 firstClaim = rewards.claim(1);
        assertEq(firstClaim, partialClaimable);
        assertEq(rewards.nextClaimEpoch(address(this)), 0);

        vm.warp(block.timestamp + 31 minutes);
        uint256 completedFirst = rewards.claim(1);
        assertGt(completedFirst, 0);
        assertEq(rewards.nextClaimEpoch(address(this)), 1);

        vm.warp(block.timestamp + 30 minutes);
        uint256 completedSecond = rewards.claimFor(address(this), 2);
        assertGt(completedSecond, 0);
        assertEq(rewards.nextClaimEpoch(address(this)), 2);
        assertEq(rewards.totalRewardsClaimed(), rewards.totalRewardsDeposited());
        assertEq(rewards.outstandingLiability(), 0);
    }

    function testSchema19DaoDistributorFailsClosedOnDeficitAndRejectingRecipient() public {
        daoToken.delegate(address(this));
        vm.warp(block.timestamp + 1);
        RobynDaoRewardDistributor rewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        rewards.bindRewardDepositor(address(this));
        rewards.depositRewards{ value: 1 ether }(address(basketAsset));
        vm.warp(block.timestamp + 1 hours);
        vm.deal(address(rewards), 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynDaoRewardDistributor.RewardAccountingInsolvent.selector, 1 ether, 0
            )
        );
        rewards.claim(1);

        setUp();
        RejectNative reject = new RejectNative();
        daoToken.transfer(address(reject), daoToken.totalSupply());
        vm.prank(address(reject));
        daoToken.delegate(address(reject));
        vm.warp(block.timestamp + 1);
        rewards = new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        rewards.bindRewardDepositor(address(this));
        rewards.depositRewards{ value: 1 ether }(address(basketAsset));
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(RobynDaoRewardDistributor.NativeTransferFailed.selector);
        rewards.claimFor(address(reject), 1);
    }

    function testSchema19VaultRejectsInvalidBasketAndFallbackConfiguration() public {
        address[] memory emptyAssets = new address[](0);
        uint16[] memory emptyWeights = new uint16[](0);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAssetCount.selector);
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), emptyAssets, emptyWeights, 1, 1 hours
        );

        address[] memory oneAsset = new address[](1);
        oneAsset[0] = address(basketAsset);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAssetCount.selector);
        new RobynNativeBasketVaultV2(assetRouter, address(this), oneAsset, emptyWeights, 1, 1 hours);

        uint16[] memory oneWeight = new uint16[](1);
        oneWeight[0] = 10_000;
        oneAsset[0] = address(0);
        vm.expectRevert(abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidAsset.selector, 0));
        new RobynNativeBasketVaultV2(assetRouter, address(this), oneAsset, oneWeight, 1, 1 hours);

        V4TestAsset unavailable = new V4TestAsset();
        oneAsset[0] = address(unavailable);
        vm.expectRevert(abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidAsset.selector, 0));
        new RobynNativeBasketVaultV2(assetRouter, address(this), oneAsset, oneWeight, 1, 1 hours);

        oneAsset[0] = address(basketAsset);
        oneWeight[0] = 9_999;
        vm.expectRevert(
            abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidWeightTotal.selector, 9_999)
        );
        new RobynNativeBasketVaultV2(assetRouter, address(this), oneAsset, oneWeight, 1, 1 hours);

        address[] memory duplicateAssets = new address[](2);
        duplicateAssets[0] = address(basketAsset);
        duplicateAssets[1] = address(basketAsset);
        uint16[] memory duplicateWeights = new uint16[](2);
        duplicateWeights[0] = 5_000;
        duplicateWeights[1] = 5_000;
        vm.expectRevert(
            abi.encodeWithSelector(RobynNativeBasketVaultV2.DuplicateAsset.selector, 0, 1)
        );
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), duplicateAssets, duplicateWeights, 1, 1 hours
        );

        oneWeight[0] = 10_000;
        RobynNativeBasketVaultV2 vault = new RobynNativeBasketVaultV2(
            assetRouter, address(this), oneAsset, oneWeight, 1, 1 hours
        );
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidRewardConfiguration.selector);
        vault.configureFallbackPolicy(0, 72 hours);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidRewardConfiguration.selector);
        vault.configureFallbackPolicy(24 hours, 71 hours);
        vault.configureFallbackPolicy(1 hours, 3 hours);
    }

    function testSchema19VaultRequiresCanonicalFallbackRewardAndImmutableBinding() public {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        RobynNativeBasketVaultV2 vault =
            new RobynNativeBasketVaultV2(assetRouter, address(this), assets, weights, 1, 1 hours);

        RobynLaunchToken noFallback = new RobynLaunchToken(
            "No fallback", "NOFB", address(this), 1_000 ether, address(vault), assets, METADATA_URI
        );
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidRewardConfiguration.selector);
        vault.bindLaunchToken(noFallback);

        address[] memory rewardAssets = new address[](2);
        rewardAssets[0] = address(basketAsset);
        rewardAssets[1] = address(testWrappedNative);
        RobynLaunchToken valid = new RobynLaunchToken(
            "Valid", "VALID", address(this), 1_000 ether, address(vault), rewardAssets, METADATA_URI
        );
        vault.bindLaunchToken(valid);
        assertEq(vault.fallbackRewardIndex(), 1);
        vm.expectRevert(RobynNativeBasketVaultV2.AlreadyBound.selector);
        vault.bindLaunchToken(valid);
        vm.expectRevert(RobynNativeBasketVaultV2.AlreadyBound.selector);
        vault.configureFallbackPolicy(1 hours, 3 hours);
    }

    function testSchema19PublicCoordinatorModeControlsAreFailClosed() public {
        RobynMaintenanceCoordinator maintenance =
            new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        feeRouter.bindMaintenanceCoordinator(address(maintenance));
        RobynDaoRewardDistributor rewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        rewards.bindRewardDepositor(address(feeRouter));
        feeRouter.bindDaoRewardReceiver(address(rewards));
        RobynV4LaunchCoordinatorV7 publicCoordinator = new RobynV4LaunchCoordinatorV7(
            launchFactory, marketFactory, feeRouter, new RobynTradeRouter(), TREASURY, GUARDIAN
        );

        vm.expectRevert(RobynV4LaunchCoordinatorV7.Unauthorized.selector);
        publicCoordinator.pauseLaunches();
        vm.expectRevert(RobynV4LaunchCoordinatorV7.Unauthorized.selector);
        publicCoordinator.setCanaryMode(address(this));
        vm.expectRevert(RobynV4LaunchCoordinatorV7.Unauthorized.selector);
        publicCoordinator.setPublicMode();

        vm.prank(TREASURY);
        vm.expectRevert(RobynV4LaunchCoordinatorV7.InvalidConfiguration.selector);
        publicCoordinator.setCanaryMode(address(0));
        vm.prank(TREASURY);
        publicCoordinator.setCanaryMode(address(this));
        assertEq(
            uint256(publicCoordinator.launchMode()),
            uint256(RobynV4LaunchCoordinatorV7.LaunchMode.Canary)
        );
        vm.prank(GUARDIAN);
        publicCoordinator.pauseLaunches();
        assertEq(
            uint256(publicCoordinator.launchMode()),
            uint256(RobynV4LaunchCoordinatorV7.LaunchMode.Paused)
        );
        vm.prank(TREASURY);
        publicCoordinator.setPublicMode();
        assertEq(
            uint256(publicCoordinator.launchMode()),
            uint256(RobynV4LaunchCoordinatorV7.LaunchMode.Public)
        );
    }

    function testSchema19ReusedRdaoBootstrapBranchesRemainQualified() public {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        RobynDaoTokenV3 token = new RobynDaoTokenV3(recipients, allocations, 1 hours, address(this));

        assertEq(token.bootstrapOwner(), address(this));
        vm.expectRevert(RobynDaoTokenV3.BootstrapControllerNotBound.selector);
        token.transfer(address(0xBADD), 1);
    }

    function testSchema19FeeRouterBindingPauseAndSettlementAdmissions() public {
        RobynNativeProtocolFeeRouterV4 fresh = new RobynNativeProtocolFeeRouterV4(
            daoToken, assetRouter, TREASURY, GUARDIAN, 1 hours
        );
        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindCoordinator(address(0));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindCoordinator(address(0x123456));
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.AlreadyBound.selector);
        fresh.bindCoordinator(address(this));

        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.bindMaintenanceCoordinator(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindMaintenanceCoordinator(address(0));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindMaintenanceCoordinator(address(0x123456));
        fresh.bindMaintenanceCoordinator(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.AlreadyBound.selector);
        fresh.bindMaintenanceCoordinator(address(this));

        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.bindDaoRewardReceiver(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindDaoRewardReceiver(address(0));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindDaoRewardReceiver(address(0x123456));
        fresh.bindDaoRewardReceiver(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.AlreadyBound.selector);
        fresh.bindDaoRewardReceiver(address(this));

        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.setPaused(true);
        vm.prank(GUARDIAN);
        fresh.setPaused(true);
        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.setPaused(false);
        vm.prank(TREASURY);
        fresh.setPaused(false);

        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(keccak256("schema19-settlement-admission")));
        market.buy{ value: 0.1 ether }(1);
        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(address(token));

        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.settleBasketFees(address(0xBADD), 1);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleBasketFees(address(token), 0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleBasketFees(address(token), account.pendingBasketNative + 1);

        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleDaoFees(address(token), 1);
        RobynDaoRewardDistributor rewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        rewards.bindRewardDepositor(address(feeRouter));
        feeRouter.bindDaoRewardReceiver(address(rewards));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleDaoFees(address(token), 0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleDaoFees(address(token), account.pendingDaoNative + 1);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleTreasuryFees(address(token), 0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleTreasuryFees(address(token), account.pendingTreasuryNative + 1);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleDaoFees(1);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleTreasuryFees(1);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        feeRouter.claimTreasuryFees();
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.NothingPending.selector);
        vm.prank(TREASURY);
        feeRouter.claimTreasuryFees();
    }

    function testSchema19VaultConversionAdmissionsRemainAttributed() public {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        RobynNativeBasketVaultV2 vault = new RobynNativeBasketVaultV2(
            assetRouter, address(this), assets, weights, 1 ether, 1 hours
        );
        vm.expectRevert(RobynNativeBasketVaultV2.NotBound.selector);
        vault.recordFees{ value: 1 }();
        vm.expectRevert(RobynNativeBasketVaultV2.NotBound.selector);
        vault.processNextLeg();

        address[] memory rewardAssets = new address[](2);
        rewardAssets[0] = address(basketAsset);
        rewardAssets[1] = address(testWrappedNative);
        RobynLaunchToken token = new RobynLaunchToken(
            "Conversion admissions",
            "CADM",
            address(this),
            1_000 ether,
            address(vault),
            rewardAssets,
            METADATA_URI
        );
        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.configureFallbackPolicy(1 hours, 3 hours);
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.bindLaunchToken(RobynLaunchToken(address(0)));
        RobynLaunchToken wrongController = new RobynLaunchToken(
            "Wrong controller",
            "WRONG",
            address(this),
            1_000 ether,
            address(this),
            rewardAssets,
            METADATA_URI
        );
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.bindLaunchToken(wrongController);
        vm.prank(address(0xBADD));
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.bindLaunchToken(token);
        vault.bindLaunchToken(token);

        vm.expectRevert(abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidLeg.selector, 1));
        vault.convertLeg(1, 1, 1, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.convertLeg(0, 0, 1, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.convertLeg(0, uint256(type(uint128).max) + 1, 1, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.convertLeg(0, 1, 0, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidDeadline.selector);
        vault.convertLeg(0, 1, 1, block.timestamp - 1);

        vault.recordFees{ value: 0.5 ether }();
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynNativeBasketVaultV2.InsufficientPending.selector, 0.5 ether, 0.5 ether + 1
            )
        );
        vault.convertLeg(0, 0.5 ether + 1, 1, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynNativeBasketVaultV2.BelowThreshold.selector,
                0.5 ether,
                1 ether,
                block.timestamp + 1 hours
            )
        );
        vault.convertLeg(0, 0.5 ether, 1, block.timestamp);
        (bool converted,, bool usedFallback) = vault.processNextLeg();
        assertFalse(converted);
        assertFalse(usedFallback);
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.executePrimaryConversion(0, 1, 1, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.executeFallbackConversion(0, 1, 1, block.timestamp);
        vm.prank(address(vault));
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.executeFallbackConversion(0, 0, 1, block.timestamp);
        vm.prank(address(vault));
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.executeFallbackConversion(0, 0.5 ether + 1, 1, block.timestamp);
        vm.prank(address(vault));
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.executeFallbackConversion(0, 1, 0, block.timestamp);
        assertEq(vault.totalPendingNative(), 0.5 ether);
        assertEq(vault.totalNativeConsumed(), 0);
    }

    function testSchema19ClaimsAndCoordinatorRejectRemainingInvalidModes() public {
        RobynMaintenanceCoordinator maintenance =
            new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        feeRouter.bindMaintenanceCoordinator(address(maintenance));
        RobynDaoRewardDistributor rewards =
            new RobynDaoRewardDistributor(IVotes(address(daoToken)), 1 hours);
        rewards.bindRewardDepositor(address(feeRouter));
        feeRouter.bindDaoRewardReceiver(address(rewards));
        RobynClaimsRouter claims =
            new RobynClaimsRouter(IRobynMaintenanceCoordinator(address(maintenance)), 1_550_000);
        vm.expectRevert(RobynClaimsRouter.InvalidConfiguration.selector);
        claims.claimAll(RobynLaunchToken(address(0)));
        vm.expectRevert(RobynClaimsRouter.InvalidConfiguration.selector);
        claims.claimAll(RobynLaunchToken(address(0x123456)));

        RobynTradeRouter coordinatorTradeRouter = new RobynTradeRouter();
        vm.expectRevert(RobynV4LaunchCoordinatorV7.InvalidConfiguration.selector);
        new RobynV4LaunchCoordinatorV7(
            launchFactory, marketFactory, feeRouter, coordinatorTradeRouter, TREASURY, TREASURY
        );
        RobynV4LaunchCoordinatorV7 publicCoordinator = new RobynV4LaunchCoordinatorV7(
            launchFactory, marketFactory, feeRouter, coordinatorTradeRouter, TREASURY, GUARDIAN
        );
        vm.prank(GUARDIAN);
        publicCoordinator.pauseLaunches();
        vm.expectRevert(RobynV4LaunchCoordinatorV7.LaunchesPaused.selector);
        publicCoordinator.createLaunch(_request(keccak256("schema19-paused-create")));
        vm.prank(TREASURY);
        publicCoordinator.setCanaryMode(address(this));
        vm.prank(address(0xBADD));
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynV4LaunchCoordinatorV7.CanaryLauncherOnly.selector,
                address(this),
                address(0xBADD)
            )
        );
        publicCoordinator.createLaunch(_request(keccak256("schema19-wrong-canary")));
        vm.expectRevert(RobynNativeLaunchFactoryV4.Unauthorized.selector);
        publicCoordinator.createLaunch(_request(keccak256("schema19-authorized-canary")));
    }
}
