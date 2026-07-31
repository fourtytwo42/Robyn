// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynNativeLaunchFactoryV4 } from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import { RobynNativeLaunchDeployerV4 } from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynNativeVaultDeployerV4 } from "../src/uniswap/RobynNativeVaultDeployerV4.sol";
import { RobynV4AssetRouter } from "../src/uniswap/RobynV4AssetRouter.sol";
import { IWrappedNative } from "../src/uniswap/RobynV4AssetRouter.sol";
import { RobynV4AdapterDeployer } from "../src/uniswap/RobynV4AdapterDeployer.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4FeeAndPhaseHook } from "../src/uniswap/RobynV4FeeAndPhaseHook.sol";
import {
    IPositionManagerPermit2,
    RobynV4FeePositionLocker
} from "../src/uniswap/RobynV4FeePositionLocker.sol";
import { RobynV4GraduationAdapter } from "../src/uniswap/RobynV4GraduationAdapter.sol";
import { RobynV4LaunchCoordinatorV6 } from "../src/uniswap/RobynV4LaunchCoordinatorV6.sol";
import { RobynV4LockerDeployer } from "../src/uniswap/RobynV4LockerDeployer.sol";
import { RobynV4MarketDeployer } from "../src/uniswap/RobynV4MarketDeployer.sol";
import { RobynV4MarketFactory } from "../src/uniswap/RobynV4MarketFactory.sol";
import {
    ForceNative,
    RejectNative,
    RobynV4NativeProtocolTest,
    V4TestAsset
} from "./RobynV4NativeProtocol.t.sol";

contract Schema16CoverageMatrixTest is RobynV4NativeProtocolTest {
    function testAssetRouterConstructorAndAdministrativeGuards() public {
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        new RobynV4AssetRouter(
            IPoolManager(address(0)),
            quoter,
            stateView,
            TREASURY,
            GUARDIAN,
            IWrappedNative(address(testWrappedNative))
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        new RobynV4AssetRouter(
            poolManager,
            IV4Quoter(address(0)),
            stateView,
            TREASURY,
            GUARDIAN,
            IWrappedNative(address(testWrappedNative))
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        new RobynV4AssetRouter(
            poolManager,
            quoter,
            IStateView(address(0)),
            TREASURY,
            GUARDIAN,
            IWrappedNative(address(testWrappedNative))
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        new RobynV4AssetRouter(
            poolManager,
            quoter,
            stateView,
            address(0),
            GUARDIAN,
            IWrappedNative(address(testWrappedNative))
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        new RobynV4AssetRouter(
            poolManager,
            quoter,
            stateView,
            TREASURY,
            address(0),
            IWrappedNative(address(testWrappedNative))
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        new RobynV4AssetRouter(
            poolManager, quoter, stateView, TREASURY, GUARDIAN, IWrappedNative(address(0))
        );

        RobynV4AssetRouter fresh = _freshAssetRouter();
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        fresh.bindLaunchRegistrar(address(this));
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.bindLaunchRegistrar(address(0));
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.bindLaunchRegistrar(address(0xB0B));
        fresh.bindLaunchRegistrar(address(this));
        vm.expectRevert(RobynV4AssetRouter.AlreadyBound.selector);
        fresh.bindLaunchRegistrar(address(this));

        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        fresh.configureRoute(address(basketAsset), _validRoute());
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        fresh.configureLaunchRoute(address(basketAsset), _validRoute());
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        fresh.pauseConversions();
        vm.prank(GUARDIAN);
        fresh.pauseConversions();
        vm.prank(GUARDIAN);
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        fresh.resumeConversions();
        vm.prank(TREASURY);
        fresh.resumeConversions();
    }

    function testAssetRouterRouteConfigurationAndWrappedExecutionGuards() public {
        RobynV4AssetRouter fresh = _freshAssetRouter();
        RobynV4AssetRouter.Route memory route = _validRoute();
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(0), route);
        route.fee = 0;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);
        route = _validRoute();
        route.tickSpacing = 0;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);
        route = _validRoute();
        route.minimumLiquidity = 0;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);
        route = _validRoute();
        route.maximumNativeInput = 0;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);
        route = _validRoute();
        route.fee = 1_000_000;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);
        route = _validRoute();
        route.maximumReferenceTickDeviation = 0;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);
        route = _validRoute();
        route.enforceReferencePrice = false;
        route.referenceTick = 1;
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureRoute(address(basketAsset), route);

        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.configureWrappedNativeRoute(0, true);
        fresh.configureWrappedNativeRoute(1 ether, true);
        (uint256 wrappedQuote,) = fresh.quoteNativeToAsset(address(testWrappedNative), 1);
        assertEq(wrappedQuote, 1);
        (wrappedQuote,) = fresh.quoteAssetToNative(address(testWrappedNative), 1);
        assertEq(wrappedQuote, 1);
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactNativeForAsset{ value: 1 }(
            address(testWrappedNative), 2, address(this), block.timestamp
        );
        uint256 wrapped = fresh.swapExactNativeForAsset{ value: 1 ether }(
            address(testWrappedNative), 1 ether, address(this), block.timestamp
        );
        assertEq(wrapped, 1 ether);
        testWrappedNative.approve(address(fresh), 1 ether);
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactAssetForNative(
            address(testWrappedNative), 1 ether, 1 ether + 1, payable(address(this)), block.timestamp
        );
        uint256 native = fresh.swapExactAssetForNative(
            address(testWrappedNative), 1 ether, 1 ether, payable(address(this)), block.timestamp
        );
        assertEq(native, 1 ether);

        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        fresh.disableRoute(address(testWrappedNative), keccak256("disabled"));
        vm.prank(GUARDIAN);
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.disableRoute(address(testWrappedNative), bytes32(0));
        vm.prank(GUARDIAN);
        fresh.disableRoute(address(testWrappedNative), keccak256("disabled"));
        assertFalse(fresh.executionRouteStatus(address(testWrappedNative)).ready);
        vm.expectPartialRevert(RobynV4AssetRouter.RouteUnavailable.selector);
        fresh.quoteNativeToAsset(address(testWrappedNative), 1);
        vm.expectPartialRevert(RobynV4AssetRouter.RouteUnavailable.selector);
        fresh.poolKey(address(0xBAD));
        vm.expectRevert(RobynV4AssetRouter.DeadlineExpired.selector);
        fresh.swapExactNativeForAsset{ value: 1 }(
            address(testWrappedNative), 1, address(this), block.timestamp - 1
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.protectedQuoteFloor(1, 1_000_000);
    }

    function testFeeRouterConstructorBindingPauseAndRegistrationGuards() public {
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        new RobynNativeProtocolFeeRouterV4(
            RobynDaoToken(address(0)), assetRouter, TREASURY, GUARDIAN, 1 hours
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        new RobynNativeProtocolFeeRouterV4(
            daoToken, RobynV4AssetRouter(payable(address(0))), TREASURY, GUARDIAN, 1 hours
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        new RobynNativeProtocolFeeRouterV4(
            daoToken, assetRouter, payable(address(0)), GUARDIAN, 1 hours
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        new RobynNativeProtocolFeeRouterV4(
            daoToken, assetRouter, TREASURY, address(0), 1 hours
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        new RobynNativeProtocolFeeRouterV4(daoToken, assetRouter, TREASURY, GUARDIAN, 0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        new RobynNativeProtocolFeeRouterV4(daoToken, assetRouter, TREASURY, GUARDIAN, 7 days + 1);

        RobynNativeProtocolFeeRouterV4 fresh =
            new RobynNativeProtocolFeeRouterV4(daoToken, assetRouter, TREASURY, GUARDIAN, 1 hours);
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindCoordinator(address(0));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.bindCoordinator(address(0xB0B));
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.AlreadyBound.selector);
        fresh.bindCoordinator(address(this));

        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.setPaused(true);
        vm.prank(GUARDIAN);
        fresh.setPaused(true);
        vm.prank(GUARDIAN);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        fresh.setPaused(false);
        vm.prank(TREASURY);
        fresh.setPaused(false);

        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(906))));
        address locker = address(market.graduationAdapter().locker());
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.registerLaunch(IERC20(address(0)), address(this), vault, address(market), locker, address(hook));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.registerLaunch(IERC20(address(token)), address(0), vault, address(market), locker, address(hook));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.registerLaunch(
            IERC20(address(token)),
            address(this),
            RobynNativeBasketVaultV2(payable(address(0))),
            address(market),
            locker,
            address(hook)
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.registerLaunch(IERC20(address(token)), address(this), vault, address(0), locker, address(hook));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.registerLaunch(
            IERC20(address(token)), address(this), vault, address(market), address(0), address(hook)
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        fresh.registerLaunch(
            IERC20(address(token)), address(this), vault, address(market), locker, address(0)
        );
        fresh.registerLaunch(
            IERC20(address(token)), address(this), vault, address(market), locker, address(hook)
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.LaunchAlreadyRegistered.selector);
        fresh.registerLaunch(
            IERC20(address(token)), address(this), vault, address(market), locker, address(hook)
        );
    }

    function testFeeRouterUnknownEmptyAndSettlementGuards() public {
        address unknown = address(0xBAD);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.creatorFeeSplit(unknown);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.claimableCreatorNativeByRecipient(unknown, address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.creatorRewardStream(unknown, address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.checkpointCreatorRewards(unknown, address(this));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.claimCreatorFees(unknown);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.claimCreatorFeesTo(unknown, payable(address(0)));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.claimCreatorFeesBatch(new address[](0));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.claimCreatorFeesBatchTo(new address[](0), payable(address(0)));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.settleBasketFees(unknown, 1);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleDaoFees(0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleTreasuryFees(0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.NothingPending.selector);
        feeRouter.sweepUnattributedNative();
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.routeNativeFees{ value: 1 }(IERC20(unknown));
    }

    function testFeeRouterRegisteredSourceBatchAndPauseGuards() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(911))));
        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(address(token));

        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidSource.selector);
        feeRouter.routeNativeFees{ value: 1 }(IERC20(address(token)));
        (bool sent, bytes memory revertData) = address(feeRouter).call{ value: 1 }("");
        assertFalse(sent);
        assertEq(bytes4(revertData), RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Unauthorized.selector);
        feeRouter.registerLaunch(
            IERC20(address(token)),
            address(this),
            account.vault,
            account.market,
            account.locker,
            account.hook
        );
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.UnknownLaunch.selector);
        feeRouter.setCreatorFeeSplit(address(0xBAD), new address[](0), new uint16[](0), false);

        vm.prank(account.market);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidSource.selector);
        feeRouter.convertAndRouteLaunchFees(
            IERC20(address(token)), 1, 1, block.timestamp
        );
        vm.prank(GUARDIAN);
        feeRouter.setPaused(true);
        vm.prank(account.locker);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.ConversionPaused.selector);
        feeRouter.convertAndRouteLaunchFees(
            IERC20(address(token)), 1, 1, block.timestamp
        );
        vm.prank(TREASURY);
        feeRouter.setPaused(false);
        vm.prank(account.locker);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.convertAndRouteLaunchFees(
            IERC20(address(token)), 0, 1, block.timestamp
        );
        vm.prank(address(market));
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.routeNativeFees(IERC20(address(token)));
        vm.deal(account.market, 1 ether);
        vm.prank(account.market);
        feeRouter.routeNativeFees{ value: 100 }(IERC20(address(token)));
        vm.deal(account.locker, 1 ether);
        vm.prank(account.locker);
        feeRouter.routeNativeFees{ value: 100 }(IERC20(address(token)));
        vm.deal(account.hook, 1 ether);
        vm.prank(account.hook);
        feeRouter.routeNativeFees{ value: 100 }(IERC20(address(token)));
        vm.deal(address(feeRouter), 0);
        vm.deal(account.market, 1 ether);
        vm.prank(account.market);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.Insolvent.selector);
        feeRouter.routeNativeFees{ value: 100 }(IERC20(address(token)));

        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleBasketFees(address(token), 0);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.NothingPending.selector);
        feeRouter.claimCreatorFees(address(token));
        address[] memory duplicate = new address[](2);
        duplicate[0] = address(token);
        duplicate[1] = address(token);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.claimCreatorFeesBatch(duplicate);
        address[] memory single = new address[](1);
        single[0] = address(token);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.NothingPending.selector);
        feeRouter.claimCreatorFeesBatch(single);
    }

    function testAssetRouterStatusSweepAndInvalidAmountGuards() public {
        RobynV4AssetRouter fresh = _freshAssetRouter();
        assertFalse(fresh.routeStatus(address(0xCAFE)).ready);
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.sweepUnattributedToken(address(0));
        vm.expectRevert(RobynV4AssetRouter.InvalidConfiguration.selector);
        fresh.sweepUnattributedToken(address(0xB0B));
        vm.expectRevert(RobynV4AssetRouter.NothingPending.selector);
        fresh.sweepUnattributedToken(address(basketAsset));

        fresh.configureRoute(address(basketAsset), _validRoute());
        vm.prank(GUARDIAN);
        fresh.pauseConversions();
        assertFalse(fresh.routeStatus(address(basketAsset)).ready);
        vm.prank(TREASURY);
        fresh.resumeConversions();
        RobynV4AssetRouter.Route memory disabled = _validRoute();
        disabled.enabled = false;
        fresh.configureRoute(address(basketAsset), disabled);
        assertFalse(fresh.routeStatus(address(basketAsset)).ready);

        V4TestAsset uninitializedAsset = new V4TestAsset();
        fresh.configureRoute(address(uninitializedAsset), _validRoute());
        assertFalse(fresh.routeStatus(address(uninitializedAsset)).ready);
        vm.prank(GUARDIAN);
        fresh.disableRoute(address(uninitializedAsset), keccak256("coverage-v4-disabled"));
        assertFalse(fresh.routeStatus(address(uninitializedAsset)).ready);

        fresh.configureWrappedNativeRoute(1 ether, true);
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactNativeForAsset(
            address(testWrappedNative), 1, address(this), block.timestamp
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactNativeForAsset{ value: 1 }(
            address(testWrappedNative), 0, address(this), block.timestamp
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactNativeForAsset{ value: 1 }(
            address(testWrappedNative), 1, address(0), block.timestamp
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactAssetForNative(
            address(testWrappedNative), 0, 1, payable(address(this)), block.timestamp
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactAssetForNative(
            address(testWrappedNative), 1, 0, payable(address(this)), block.timestamp
        );
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        fresh.swapExactAssetForNative(
            address(testWrappedNative), 1, 1, payable(address(0)), block.timestamp
        );

        fresh.swapExactNativeForAsset{ value: 1 ether }(
            address(testWrappedNative), 1 ether, address(this), block.timestamp
        );
        testWrappedNative.approve(address(fresh), 1 ether);
        RejectNative reject = new RejectNative();
        vm.expectRevert(RobynV4AssetRouter.NativeTransferFailed.selector);
        fresh.swapExactAssetForNative(
            address(testWrappedNative), 1 ether, 1 ether, payable(address(reject)), block.timestamp
        );

        RobynV4AssetRouter rejectingGovernor = new RobynV4AssetRouter(
            poolManager,
            quoter,
            stateView,
            address(reject),
            GUARDIAN,
            IWrappedNative(address(testWrappedNative))
        );
        ForceNative forced = new ForceNative{ value: 1 }();
        forced.force(payable(address(rejectingGovernor)));
        vm.expectRevert(RobynV4AssetRouter.NativeTransferFailed.selector);
        rejectingGovernor.sweepUnattributedNative();
        assertEq(testWrappedNative.balanceOf(address(this)), 1 ether);
    }

    function testVaultConversionBoundaryGuards() public {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        RobynNativeBasketVaultV2 unbound =
            new RobynNativeBasketVaultV2(assetRouter, address(this), assets, weights, 1, 1 hours);
        vm.expectRevert(RobynNativeBasketVaultV2.NotBound.selector);
        unbound.recordFees{ value: 1 }();
        vm.expectRevert(RobynNativeBasketVaultV2.NotBound.selector);
        unbound.convertLeg(0, 1, 1, block.timestamp);

        (, RobynNativeBasketVaultV2 vault,) =
            coordinator.createLaunch(_request(bytes32(uint256(912))));
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.convertLeg(0, 0, 1, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.convertLeg(0, uint256(type(uint128).max) + 1, 1, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.convertLeg(0, 1, 0, block.timestamp);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidDeadline.selector);
        vault.convertLeg(0, 1, 1, block.timestamp - 1);
        vm.expectPartialRevert(RobynNativeBasketVaultV2.InsufficientPending.selector);
        vault.convertLeg(0, 1, 1, block.timestamp);
    }

    function testLaunchRewardAuthorizationQueueAndZeroSupplyTransitions() public {
        (RobynLaunchToken launched,,) =
            coordinator.createLaunch(_request(bytes32(uint256(913))));
        vm.expectRevert(RobynLaunchToken.Unauthorized.selector);
        launched.distributeReward(0, 1);
        vm.expectRevert(RobynLaunchToken.NoEligibleRewardSupply.selector);
        launched.activateQueuedRewards(0);
        assertEq(launched.accumulativeRewardOf(address(marketFactory), 0), 0);

        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        RobynLaunchToken token = new RobynLaunchToken(
            "Stream", "STR", address(this), 100, address(this), assets, METADATA_URI
        );
        token.configureRewardStreamDuration(1 hours);
        address excluded = address(0xBEEF);
        address[] memory exclusions = new address[](1);
        exclusions[0] = excluded;
        token.sealExclusions(exclusions);
        vm.expectRevert(RobynLaunchToken.NoRewardAvailable.selector);
        token.activateQueuedRewards(0);
        vm.expectRevert(RobynLaunchToken.InvalidAmount.selector);
        token.distributeReward(0, 0);
        basketAsset.approve(address(token), 1 ether);
        token.distributeReward(0, 1 ether);
        token.transfer(excluded, 100);
        assertEq(token.eligibleSupply(), 0);
        assertGt(token.pendingWithoutSupply(0), 0);
        vm.expectRevert(RobynLaunchToken.NoEligibleRewardSupply.selector);
        token.activateQueuedRewards(0);
    }

    function testBondingMarketUnseededBindingAndTradeGuards() public {
        (
            RobynLaunchToken token,
            RobynNativeBasketVaultV2 vault,
            RobynV4BondingCurveMarket canonicalMarket
        ) = coordinator.createLaunch(_request(bytes32(uint256(907))));
        RobynV4BondingCurveMarket unseeded = new RobynV4BondingCurveMarket(
            token,
            vault,
            address(this),
            address(this),
            _curve(),
            canonicalMarket.graduationAdapter()
        );
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        unseeded.sweepUnattributedNative();
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4BondingCurveMarket.Unauthorized.selector);
        unseeded.bindFeeRouter(feeRouter);
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        unseeded.bindFeeRouter(RobynNativeProtocolFeeRouterV4(payable(address(0))));
        unseeded.bindFeeRouter(feeRouter);
        vm.expectRevert(RobynV4BondingCurveMarket.FeeRouterAlreadyBound.selector);
        unseeded.bindFeeRouter(feeRouter);
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4BondingCurveMarket.Unauthorized.selector);
        unseeded.seed(1_000_000_000 ether);
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidAmount.selector);
        unseeded.seed(1);
        vm.expectRevert(RobynV4BondingCurveMarket.NotSeeded.selector);
        unseeded.quoteBuy(1);
        vm.expectRevert(RobynV4BondingCurveMarket.NotSeeded.selector);
        unseeded.quoteSell(1);
        vm.expectRevert(RobynV4BondingCurveMarket.NotSeeded.selector);
        unseeded.buy{ value: 1 }(1);
        vm.expectRevert(RobynV4BondingCurveMarket.NotSeeded.selector);
        unseeded.sell(1, 1);
        (bool sent, bytes memory revertData) = address(unseeded).call{ value: 1 }("");
        assertFalse(sent);
        assertEq(bytes4(revertData), RobynV4BondingCurveMarket.Unauthorized.selector);
    }

    function testBondingMarketBoundaryAndRollbackGuards() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(908))));
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidAmount.selector);
        market.quoteBuy(0);
        uint256 cap = market.maximumCurvePurchase();
        vm.expectPartialRevert(
            RobynV4BondingCurveMarket.MaximumCurvePurchaseExceeded.selector
        );
        market.quoteBuy(cap + 1);
        vm.expectRevert(RobynV4BondingCurveMarket.CurveInventoryExceeded.selector);
        market.quoteSell(0);
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidAmount.selector);
        market.buy{ value: 0 }(1);
        vm.expectPartialRevert(RobynV4BondingCurveMarket.MaximumCurvePurchaseExceeded.selector);
        market.buy{ value: cap + 1 }(1);
        vm.expectPartialRevert(RobynV4BondingCurveMarket.Slippage.selector);
        market.buy{ value: 1 }(type(uint256).max);
        uint256 curveAllocation = market.curveTokenAllocation();
        vm.expectRevert(RobynV4BondingCurveMarket.CurveInventoryExceeded.selector);
        market.sell(curveAllocation + 1, 1);

        market.buy{ value: 0.1 ether }(1);
        uint256 tokenBalance = token.balanceOf(address(this));
        token.approve(address(market), tokenBalance);
        vm.expectPartialRevert(RobynV4BondingCurveMarket.Slippage.selector);
        market.sell(tokenBalance, type(uint256).max);
        assertEq(token.allowance(address(this), address(market)), tokenBalance);
    }

    function testHookRegistrationPhaseObservationAndFeeGuards() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(909))));
        PoolKey memory key = market.graduationAdapter().poolKey();
        bytes32 poolId = market.graduationAdapter().poolId();

        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4FeeAndPhaseHook.Unauthorized.selector);
        hook.bindRegistrar(address(this));
        vm.expectRevert(RobynV4FeeAndPhaseHook.AlreadyBound.selector);
        hook.bindRegistrar(address(this));
        vm.expectRevert(RobynV4FeeAndPhaseHook.Unauthorized.selector);
        hook.registerPool(key, address(this));
        vm.expectRevert(RobynV4FeeAndPhaseHook.PoolNotRegistered.selector);
        hook.beginGraduation(address(0xBAD));
        vm.expectRevert(RobynV4FeeAndPhaseHook.PoolNotRegistered.selector);
        hook.activateTrading(address(0xBAD));
        vm.expectRevert(RobynV4FeeAndPhaseHook.Unauthorized.selector);
        hook.beginGraduation(address(token));
        vm.expectRevert(RobynV4FeeAndPhaseHook.Unauthorized.selector);
        hook.activateTrading(address(token));

        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidAmount.selector);
        hook.settleNativeFees(IERC20(address(token)), 0);
        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidAmount.selector);
        hook.convertTokenFees(IERC20(address(token)), 0, 1, block.timestamp);
        vm.expectRevert(RobynV4FeeAndPhaseHook.PoolNotRegistered.selector);
        hook.poolKey(address(0xBAD));
        vm.expectRevert(RobynV4FeeAndPhaseHook.InsufficientHistory.selector);
        hook.latestObservation(bytes32(uint256(1)));
        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidConfiguration.selector);
        hook.observation(poolId, 64);
        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidConfiguration.selector);
        hook.consult(poolId, 0);
        vm.expectRevert(RobynV4FeeAndPhaseHook.InsufficientHistory.selector);
        hook.consult(poolId, 1);
        (bool sent, bytes memory revertData) = address(hook).call{ value: 1 }("");
        assertFalse(sent);
        assertEq(bytes4(revertData), RobynV4FeeAndPhaseHook.Unauthorized.selector);
    }

    function testLockerInitializationCollectionAndSweepGuards() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(910))));
        RobynV4GraduationAdapter adapter = market.graduationAdapter();
        RobynV4FeePositionLocker locker = adapter.locker();

        vm.expectRevert(RobynV4FeePositionLocker.Unauthorized.selector);
        locker.bindFeeRouter(feeRouter);
        vm.prank(address(adapter));
        vm.expectRevert(RobynV4FeePositionLocker.AlreadyInitialized.selector);
        locker.bindFeeRouter(feeRouter);
        vm.expectRevert(RobynV4FeePositionLocker.Unauthorized.selector);
        locker.mintAndLock{ value: 1 }(1, 1);
        vm.expectRevert(RobynV4FeePositionLocker.NotInitialized.selector);
        locker.collectFees(0, 0);
        vm.expectRevert(RobynV4FeePositionLocker.InvalidConfiguration.selector);
        locker.routeCollectedNative(0);
        vm.expectRevert(RobynV4FeePositionLocker.InvalidConfiguration.selector);
        locker.convertCollectedToken(0, 1, block.timestamp);
        vm.expectRevert(RobynV4FeePositionLocker.NothingPending.selector);
        locker.sweepUnattributedNative();
        vm.expectRevert(RobynV4FeePositionLocker.NothingPending.selector);
        locker.sweepUnattributedLaunchTokens();
        vm.expectRevert(RobynV4FeePositionLocker.Unauthorized.selector);
        locker.onERC721Received(address(this), address(this), 1, bytes(""));
        assertEq(locker.unattributedLaunchTokens(), 0);
        assertEq(token.balanceOf(address(locker)), 0);
    }

    function testGraduatedMarketAdapterAndLockedPositionGuards() public {
        vm.prank(TREASURY);
        uint64 version = marketFactory.setGraduationProfile(0.01 ether, 0.001 ether);
        RobynNativeLaunchFactoryV4.LaunchRequest memory request =
            _request(bytes32(uint256(914)));
        request.expectedGraduationProfileVersion = version;
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(request);
        for (uint256 index; index < 20 && !market.graduated(); ++index) {
            market.buy{ value: 0.001 ether }(1);
        }
        assertTrue(market.graduated());
        assertGt(market.nativePerToken(), 0);
        assertEq(market.nativeRaised(), market.graduationThresholdNative());
        assertEq(market.graduationProgressBps(), 10_000);
        market.quoteBuy(0.0001 ether);
        market.quoteSell(1_000_000 ether);

        vm.prank(address(coordinator));
        vm.expectRevert(RobynV4BondingCurveMarket.AlreadySeeded.selector);
        market.seed(1_000_000_000 ether);
        vm.expectRevert(RobynV4BondingCurveMarket.NothingPending.selector);
        market.sweepUnattributedNative();
        vm.prank(address(coordinator));
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        market.buyFor(address(this), 1);
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidAmount.selector);
        market.sell(0, 1);

        RobynV4GraduationAdapter adapter = market.graduationAdapter();
        RobynV4FeePositionLocker locker = adapter.locker();
        vm.expectRevert(RobynV4GraduationAdapter.Unauthorized.selector);
        adapter.bindLocker(locker);
        vm.expectRevert(RobynV4GraduationAdapter.Unauthorized.selector);
        adapter.bindFeeRouter(feeRouter);
        vm.expectRevert(RobynV4GraduationAdapter.Unauthorized.selector);
        adapter.graduate(1);
        vm.expectRevert(RobynV4GraduationAdapter.Unauthorized.selector);
        adapter.buyFor(address(this), 1);
        vm.expectRevert(RobynV4GraduationAdapter.Unauthorized.selector);
        adapter.sellFor(payable(address(this)), 1, 1);

        vm.prank(address(adapter));
        vm.expectRevert(RobynV4FeePositionLocker.AlreadyInitialized.selector);
        locker.mintAndLock(1, 1);
        vm.prank(address(positionManager));
        assertEq(
            locker.onERC721Received(address(this), address(this), 1, bytes("")),
            RobynV4FeePositionLocker.onERC721Received.selector
        );
        token.transfer(address(locker), 1);
        assertEq(locker.sweepUnattributedLaunchTokens(), 1);
    }

    function testHookDuplicateRegistrationPhaseAndCallbackGuards() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(915))));
        RobynV4GraduationAdapter adapter = market.graduationAdapter();
        PoolKey memory key = adapter.poolKey();
        vm.prank(address(marketFactory));
        vm.expectRevert(RobynV4FeeAndPhaseHook.PoolAlreadyRegistered.selector);
        hook.registerPool(key, address(adapter));

        PoolKey memory invalidKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 10_000,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
        vm.prank(address(marketFactory));
        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidConfiguration.selector);
        hook.registerPool(invalidKey, address(adapter));

        vm.prank(address(adapter));
        hook.beginGraduation(address(token));
        vm.prank(address(adapter));
        vm.expectPartialRevert(RobynV4FeeAndPhaseHook.InvalidPhase.selector);
        hook.beginGraduation(address(token));
        vm.prank(address(adapter));
        hook.activateTrading(address(token));
        vm.prank(address(adapter));
        vm.expectPartialRevert(RobynV4FeeAndPhaseHook.InvalidPhase.selector);
        hook.activateTrading(address(token));

        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1), sqrtPriceLimitX96: 1 });
        vm.expectRevert(RobynV4FeeAndPhaseHook.Unauthorized.selector);
        hook.beforeSwap(address(this), key, params, bytes(""));
        vm.prank(address(poolManager));
        vm.expectRevert(RobynV4FeeAndPhaseHook.PoolNotRegistered.selector);
        hook.beforeSwap(address(this), invalidKey, params, bytes(""));
    }

    function testMarketFactoryCreationValidationBranches() public {
        (RobynLaunchToken token,,) =
            coordinator.createLaunch(_request(bytes32(uint256(916))));
        uint64 version = marketFactory.graduationProfileVersion();
        vm.prank(address(coordinator));
        vm.expectRevert(RobynV4MarketFactory.InvalidConfiguration.selector);
        marketFactory.createMarketFor(token, address(0), address(coordinator), version);
        vm.prank(address(coordinator));
        vm.expectRevert(RobynV4MarketFactory.InvalidConfiguration.selector);
        marketFactory.createMarketFor(token, address(this), address(this), version);
        vm.prank(address(coordinator));
        vm.expectRevert(RobynV4MarketFactory.Unauthorized.selector);
        marketFactory.createMarketFor(token, address(0xB0B), address(coordinator), version);
        vm.prank(address(coordinator));
        vm.expectRevert(RobynV4MarketFactory.MarketAlreadyExists.selector);
        marketFactory.createMarketFor(token, address(this), address(coordinator), version);
    }

    function testLaunchTokenConstructorConfigurationAndExclusionGuards() public {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        vm.expectRevert(RobynLaunchToken.InvalidAccount.selector);
        new RobynLaunchToken("N", "N", address(0), 1, address(this), assets, METADATA_URI);
        vm.expectRevert(RobynLaunchToken.InvalidAccount.selector);
        new RobynLaunchToken("N", "N", address(this), 1, address(0), assets, METADATA_URI);
        vm.expectRevert(RobynLaunchToken.InvalidAmount.selector);
        new RobynLaunchToken("N", "N", address(this), 0, address(this), assets, METADATA_URI);
        vm.expectRevert(RobynLaunchToken.InvalidAssetCount.selector);
        new RobynLaunchToken(
            "N", "N", address(this), 1, address(this), new address[](0), METADATA_URI
        );
        address[] memory tooMany = new address[](25);
        vm.expectRevert(RobynLaunchToken.InvalidAssetCount.selector);
        new RobynLaunchToken("N", "N", address(this), 1, address(this), tooMany, METADATA_URI);
        assets[0] = address(0);
        vm.expectRevert(abi.encodeWithSelector(RobynLaunchToken.InvalidAsset.selector, 0));
        new RobynLaunchToken("N", "N", address(this), 1, address(this), assets, METADATA_URI);
        assets = new address[](2);
        assets[0] = address(basketAsset);
        assets[1] = address(basketAsset);
        vm.expectRevert(abi.encodeWithSelector(RobynLaunchToken.DuplicateAsset.selector, 0, 1));
        new RobynLaunchToken("N", "N", address(this), 1, address(this), assets, METADATA_URI);

        assets = new address[](1);
        assets[0] = address(basketAsset);
        vm.expectRevert(RobynLaunchToken.InvalidTokenUri.selector);
        new RobynLaunchToken("N", "N", address(this), 1, address(this), assets, "short");
        vm.expectRevert(RobynLaunchToken.InvalidTokenUri.selector);
        new RobynLaunchToken(
            "N",
            "N",
            address(this),
            1,
            address(this),
            assets,
            "xpfs://bafkreif2akiscaildcwr6zeux4w6i2s5"
        );
        vm.expectRevert(RobynLaunchToken.InvalidTokenUri.selector);
        new RobynLaunchToken(
            "N",
            "N",
            address(this),
            1,
            address(this),
            assets,
            "ipfs://bafkreiF2akiscaildcwr6zeux4w6i2s5"
        );

        RobynLaunchToken token =
            new RobynLaunchToken("N", "N", address(this), 100, address(this), assets, METADATA_URI);
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynLaunchToken.Unauthorized.selector);
        token.configureRewardStreamDuration(1 hours);
        vm.expectRevert(RobynLaunchToken.InvalidAmount.selector);
        token.configureRewardStreamDuration(0);
        vm.expectRevert(RobynLaunchToken.InvalidAmount.selector);
        token.configureRewardStreamDuration(7 days + 1);
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(0);
        vm.expectRevert(RobynLaunchToken.InvalidAccount.selector);
        token.sealExclusions(exclusions);
        exclusions[0] = address(this);
        token.sealExclusions(exclusions);
        basketAsset.approve(address(token), 1);
        token.distributeReward(0, 1);
        assertEq(token.totalRewardsVested(0), 0);
        assertEq(token.accumulativeRewardOf(address(this), 0), 0);
        assertEq(token.withdrawableRewardOf(address(this), 0), 0);
        vm.expectRevert(RobynLaunchToken.ExclusionsAlreadySealed.selector);
        token.sealExclusions(exclusions);
        vm.expectRevert(RobynLaunchToken.Unauthorized.selector);
        token.configureRewardStreamDuration(1 hours);
        vm.expectRevert(abi.encodeWithSelector(RobynLaunchToken.InvalidAssetIndex.selector, 1));
        token.rewardAsset(1);
        vm.expectRevert(RobynLaunchToken.NoRewardAvailable.selector);
        token.claimAll();

        RobynLaunchToken duplicateExclusion =
            new RobynLaunchToken("N", "N", address(this), 100, address(this), assets, METADATA_URI);
        address[] memory duplicates = new address[](2);
        duplicates[0] = address(this);
        duplicates[1] = address(this);
        vm.expectRevert(
            abi.encodeWithSelector(RobynLaunchToken.DuplicateExcludedAccount.selector, address(this))
        );
        duplicateExclusion.sealExclusions(duplicates);
    }

    function testDaoTokenConstructorBindingExclusionAndEmptyClaimGuards() public {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_000_000 ether;
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(recipients, amounts, 0);
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(recipients, amounts, 7 days + 1);
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(new address[](0), new uint256[](0), 1 hours);
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(recipients, new uint256[](0), 1 hours);
        recipients[0] = address(0);
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(recipients, amounts, 1 hours);
        recipients[0] = address(this);
        amounts[0] = 0;
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(recipients, amounts, 1 hours);
        amounts[0] = 1;
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        new RobynDaoToken(recipients, amounts, 1 hours);
        amounts[0] = 1_000_000_000 ether;

        RobynDaoToken token = new RobynDaoToken(recipients, amounts, 1 hours);
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynDaoToken.Unauthorized.selector);
        token.sealRewardExclusions(recipients);
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        token.sealRewardExclusions(new address[](0));
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(0);
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        token.sealRewardExclusions(exclusions);
        exclusions[0] = address(0xBEEF);
        token.sealRewardExclusions(exclusions);
        vm.expectRevert(RobynDaoToken.ExclusionsAlreadySealed.selector);
        token.sealRewardExclusions(exclusions);

        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynDaoToken.Unauthorized.selector);
        token.bindRewardDepositor(address(this));
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        token.bindRewardDepositor(address(0));
        token.bindRewardDepositor(address(this));
        vm.expectRevert(RobynDaoToken.AlreadyBound.selector);
        token.bindRewardDepositor(address(this));
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        token.depositRewards{ value: 0 }();
        vm.expectRevert(RobynDaoToken.NothingToClaim.selector);
        token.activateQueuedRewards();
        vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
        token.claimRewardsTo(payable(address(0)));
        vm.expectRevert(RobynDaoToken.NothingToClaim.selector);
        token.claimRewards();
        vm.prank(address(0xBEEF));
        vm.expectRevert(RobynDaoToken.RewardAccountExcluded.selector);
        token.claimRewards();
        assertEq(token.accumulativeRewardOf(address(0xBEEF)), 0);
        assertEq(token.claimableRewardOf(address(0xBEEF)), 0);
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynDaoToken.Unauthorized.selector);
        token.depositRewards();

        RobynDaoToken zeroSupply = new RobynDaoToken(recipients, amounts, 1 hours);
        address[] memory holderExclusion = new address[](1);
        holderExclusion[0] = address(this);
        zeroSupply.sealRewardExclusions(holderExclusion);
        zeroSupply.bindRewardDepositor(address(this));
        zeroSupply.depositRewards{ value: 1 }();
        vm.expectRevert(RobynDaoToken.NoEligibleRewardSupply.selector);
        zeroSupply.activateQueuedRewards();
    }

    function testAllDeploymentHelpersFailClosedBeforeAndAfterBinding() public {
        vm.expectRevert(RobynNativeLaunchDeployerV4.InvalidController.selector);
        new RobynNativeLaunchDeployerV4(0);
        vm.expectRevert(RobynNativeLaunchDeployerV4.InvalidController.selector);
        new RobynNativeLaunchDeployerV4(7 days + 1);

        RobynNativeLaunchDeployerV4 tokenDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        RobynNativeVaultDeployerV4 vaultDeployer = new RobynNativeVaultDeployerV4();
        RobynV4AdapterDeployer adapterDeployer = new RobynV4AdapterDeployer();
        RobynV4LockerDeployer lockerDeployer = new RobynV4LockerDeployer();
        RobynV4MarketDeployer marketDeployer = new RobynV4MarketDeployer();

        _exerciseControllerBinding(address(tokenDeployer));
        _exerciseControllerBinding(address(vaultDeployer));
        _exerciseControllerBinding(address(adapterDeployer));
        _exerciseControllerBinding(address(lockerDeployer));
        _exerciseControllerBinding(address(marketDeployer));
    }

    function testLaunchAndVaultDeployersRejectUnboundCallers() public {
        RobynNativeLaunchDeployerV4 tokenDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        RobynNativeLaunchDeployerV4.TokenRequest memory tokenRequest =
            RobynNativeLaunchDeployerV4.TokenRequest({
                name: "Unauthorized",
                symbol: "NOPE",
                supplyRecipient: address(this),
                initialSupply: 1,
                vault: address(this),
                assets: assets,
                tokenUri: METADATA_URI
            });
        vm.expectRevert(RobynNativeLaunchDeployerV4.Unauthorized.selector);
        tokenDeployer.deployToken(bytes32(uint256(1)), tokenRequest);
        vm.expectRevert(RobynNativeLaunchDeployerV4.Unauthorized.selector);
        tokenDeployer.sealExclusions(RobynLaunchToken(address(0x1234)), new address[](0));

        RobynNativeVaultDeployerV4 vaultDeployer = new RobynNativeVaultDeployerV4();
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        vm.expectRevert(RobynNativeVaultDeployerV4.Unauthorized.selector);
        vaultDeployer.deployVault(
            bytes32(uint256(1)), assetRouter, assets, weights, 1, 1 hours
        );
    }

    function testBasketVaultConstructorAndRuntimeGuards() public {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;

        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        new RobynNativeBasketVaultV2(
            RobynV4AssetRouter(payable(address(0))), address(this), assets, weights, 1, 1 hours
        );
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        new RobynNativeBasketVaultV2(assetRouter, address(0), assets, weights, 1, 1 hours);

        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAssetCount.selector);
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), new address[](0), new uint16[](0), 1, 1 hours
        );
        address[] memory tooMany = new address[](4);
        uint16[] memory tooManyWeights = new uint16[](4);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAssetCount.selector);
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), tooMany, tooManyWeights, 1, 1 hours
        );
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAssetCount.selector);
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), assets, new uint16[](0), 1, 1 hours
        );

        address[] memory invalidAssets = new address[](1);
        invalidAssets[0] = address(0);
        vm.expectRevert(abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidAsset.selector, 0));
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), invalidAssets, weights, 1, 1 hours
        );
        invalidAssets[0] = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidAsset.selector, 0));
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), invalidAssets, weights, 1, 1 hours
        );

        address[] memory duplicates = new address[](2);
        duplicates[0] = address(basketAsset);
        duplicates[1] = address(basketAsset);
        uint16[] memory duplicateWeights = new uint16[](2);
        duplicateWeights[0] = 5_000;
        duplicateWeights[1] = 5_000;
        vm.expectRevert(
            abi.encodeWithSelector(RobynNativeBasketVaultV2.DuplicateAsset.selector, 0, 1)
        );
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), duplicates, duplicateWeights, 1, 1 hours
        );
        weights[0] = 9_999;
        vm.expectRevert(
            abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidWeightTotal.selector, 9_999)
        );
        new RobynNativeBasketVaultV2(
            assetRouter, address(this), assets, weights, 1, 1 hours
        );

        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault,) =
            coordinator.createLaunch(_request(bytes32(uint256(904))));
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynNativeBasketVaultV2.Unauthorized.selector);
        vault.bindLaunchToken(token);
        vm.prank(address(launchFactory));
        vm.expectRevert(RobynNativeBasketVaultV2.AlreadyBound.selector);
        vault.bindLaunchToken(token);
        vm.expectRevert(RobynNativeBasketVaultV2.InvalidAmount.selector);
        vault.recordFees{ value: 0 }();
        vm.expectRevert(abi.encodeWithSelector(RobynNativeBasketVaultV2.InvalidLeg.selector, 1));
        vault.leg(1);
        (bool sent, bytes memory revertData) = address(vault).call{ value: 1 }("");
        assertFalse(sent);
        assertEq(bytes4(revertData), RobynNativeBasketVaultV2.Unauthorized.selector);
    }

    function testGraduationAdapterUninitializedAndBindingGuards() public {
        (RobynLaunchToken token,,) = coordinator.createLaunch(_request(bytes32(uint256(905))));
        RobynV4GraduationAdapter adapter = new RobynV4GraduationAdapter(
            token,
            poolManager,
            IPositionManager(address(positionManager)),
            permit2,
            stateView,
            assetRouter,
            IHooks(address(hook)),
            address(this),
            marketFactory.terminalSqrtPriceX96(),
            9_900,
            0.25 ether
        );
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4GraduationAdapter.Unauthorized.selector);
        adapter.bindMarket(address(this));
        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        adapter.bindMarket(address(0));
        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        adapter.bindMarket(address(0xB0B));
        adapter.bindMarket(address(this));
        vm.expectRevert(RobynV4GraduationAdapter.AlreadyBound.selector);
        adapter.bindMarket(address(this));

        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        adapter.bindLocker(RobynV4FeePositionLocker(payable(address(0))));
        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        adapter.bindFeeRouter(feeRouter);
        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        adapter.sweepUnattributedNative();
        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        adapter.graduate(0);
        vm.expectRevert(RobynV4GraduationAdapter.NotInitialized.selector);
        adapter.buyFor(address(this), 1);
        vm.expectRevert(RobynV4GraduationAdapter.NotInitialized.selector);
        adapter.sellFor(payable(address(this)), 1, 1);
        vm.expectRevert(RobynV4GraduationAdapter.NotInitialized.selector);
        adapter.quoteBuy(1);
        vm.expectRevert(RobynV4GraduationAdapter.NotInitialized.selector);
        adapter.quoteSell(1);

        (bool sent, bytes memory revertData) = address(adapter).call{ value: 1 }("");
        assertFalse(sent);
        assertEq(bytes4(revertData), RobynV4GraduationAdapter.DirectNativeTransferRejected.selector);
    }

    function testLaunchFactoryBindingAndCoordinatorGuards() public {
        (
            RobynNativeLaunchFactoryV4 fresh,
            RobynNativeLaunchDeployerV4 tokenDeployer,
            RobynNativeVaultDeployerV4 vaultDeployer
        ) = _freshLaunchFactory();
        RobynNativeLaunchFactoryV4.LaunchRequest memory request = _request(bytes32(uint256(901)));

        vm.expectRevert(RobynNativeLaunchFactoryV4.CoordinatorNotBound.selector);
        fresh.createLaunchFor(address(this), address(this), 1_000_000_000 ether, request);

        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynNativeLaunchFactoryV4.Unauthorized.selector);
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        fresh.bindCoordinator(address(0));
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        fresh.bindCoordinator(address(0xB0B));

        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynNativeLaunchFactoryV4.CoordinatorAlreadyBound.selector);
        fresh.bindCoordinator(address(this));

        vm.expectRevert(RobynNativeLaunchFactoryV4.Unauthorized.selector);
        fresh.createLaunchFor(address(this), address(this), 1_000_000_000 ether, request);

        tokenDeployer.bindController(address(fresh));
        vaultDeployer.bindController(address(fresh));
    }

    function testLaunchFactoryValidationAndDuplicateRollback() public {
        (
            RobynNativeLaunchFactoryV4 fresh,
            RobynNativeLaunchDeployerV4 tokenDeployer,
            RobynNativeVaultDeployerV4 vaultDeployer
        ) = _freshLaunchFactory();
        fresh.bindCoordinator(address(this));
        tokenDeployer.bindController(address(fresh));
        vaultDeployer.bindController(address(fresh));

        RobynNativeLaunchFactoryV4.LaunchRequest memory request = _request(bytes32(uint256(902)));
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        fresh.createLaunchFor(address(0), address(this), 1_000_000_000 ether, request);
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        fresh.createLaunchFor(address(this), address(0), 1_000_000_000 ether, request);

        request.userSalt = bytes32(0);
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidSalt.selector);
        fresh.createLaunchFor(address(this), address(this), 1_000_000_000 ether, request);
        request.userSalt = bytes32(uint256(902));

        RobynNativeLaunchFactoryV4.CreatedLaunch memory created =
            fresh.createLaunchFor(address(this), address(this), 1_000_000_000 ether, request);
        assertEq(fresh.launchCount(), 1);
        assertTrue(fresh.usedLaunchSalt(created.launchSaltHash));
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynNativeLaunchFactoryV4.LaunchSaltAlreadyUsed.selector, created.launchSaltHash
            )
        );
        fresh.createLaunchFor(address(this), address(this), 1_000_000_000 ether, request);
        assertEq(fresh.launchCount(), 1);
    }

    function testLaunchFactoryRouteAndExclusionGuards() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        launchFactory.requireBasketRoutes(empty);

        address[] memory tooMany = new address[](4);
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        launchFactory.requireBasketRoutes(tooMany);

        address unavailable = address(0xBAD);
        address[] memory one = new address[](1);
        one[0] = unavailable;
        bytes32 reason = assetRouter.routeStatus(unavailable).reason;
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynNativeLaunchFactoryV4.AssetRouteUnavailable.selector, 0, unavailable, reason
            )
        );
        launchFactory.requireBasketRoutes(one);

        address[] memory exclusions = new address[](0);
        vm.prank(address(coordinator));
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        launchFactory.sealLaunchExclusionsFor(RobynLaunchToken(address(0x1234)), exclusions);
    }

    function testCoordinatorAuthorizationAndInitialPurchaseRollback() public {
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4LaunchCoordinatorV6.Unauthorized.selector);
        coordinator.pauseLaunches();
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4LaunchCoordinatorV6.Unauthorized.selector);
        coordinator.setCanaryMode(address(this));
        vm.prank(TREASURY);
        vm.expectRevert(RobynV4LaunchCoordinatorV6.InvalidConfiguration.selector);
        coordinator.setCanaryMode(address(0));
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4LaunchCoordinatorV6.Unauthorized.selector);
        coordinator.setPublicMode();

        RobynNativeLaunchFactoryV4.LaunchRequest memory request = _request(bytes32(uint256(903)));
        uint256 countBefore = launchFactory.launchCount();
        uint256 threshold = marketFactory.actualGraduationThresholdNative();
        vm.expectRevert(RobynV4LaunchCoordinatorV6.InvalidConfiguration.selector);
        coordinator.createLaunch{ value: threshold }(request);
        assertEq(launchFactory.launchCount(), countBefore);
    }

    function testMarketFactoryBindingAndCoordinatorGuards() public {
        RobynV4MarketFactory fresh =
            _deployMarketFactory(_dependencies(), _curve(), 9_900, 0.25 ether, 1 gwei, 1);
        uint64 version = fresh.graduationProfileVersion();
        vm.expectRevert(RobynV4MarketFactory.CoordinatorNotBound.selector);
        fresh.createMarketFor(
            RobynLaunchToken(address(0x1)), address(this), address(this), version
        );
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynV4MarketFactory.Unauthorized.selector);
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynV4MarketFactory.InvalidConfiguration.selector);
        fresh.bindCoordinator(address(0));
        vm.expectRevert(RobynV4MarketFactory.InvalidConfiguration.selector);
        fresh.bindCoordinator(address(0xB0B));
        fresh.bindCoordinator(address(this));
        vm.expectRevert(RobynV4MarketFactory.CoordinatorAlreadyBound.selector);
        fresh.bindCoordinator(address(this));
    }

    function testMarketFactoryRejectsEachDependencyStage() public {
        RobynV4MarketFactory.Dependencies memory dependencies = _dependencies();
        RobynV4BondingCurveMarket.CurveConfig memory curve = _curve();

        dependencies.launchFactory = RobynNativeLaunchFactoryV4(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.feeRouter = RobynNativeProtocolFeeRouterV4(payable(address(0)));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.assetRouter = RobynV4AssetRouter(payable(address(0)));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.oracleHook = RobynV4FeeAndPhaseHook(payable(address(0)));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.poolManager = IPoolManager(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.positionManager = IPositionManager(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.permit2 = IAllowanceTransfer(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.stateView = IStateView(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.adapterDeployer = RobynV4AdapterDeployer(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.lockerDeployer = RobynV4LockerDeployer(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.marketDeployer = RobynV4MarketDeployer(address(0));
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.tokenSink = address(0);
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        dependencies = _dependencies();
        dependencies.assetRouter = _freshAssetRouter();
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
    }

    function testLaunchFactoryConstructorAndMarketConstructorBranches() public {
        RobynNativeLaunchDeployerV4 tokenDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        RobynNativeVaultDeployerV4 vaultDeployer = new RobynNativeVaultDeployerV4();
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        new RobynNativeLaunchFactoryV4(
            RobynV4AssetRouter(payable(address(0))), tokenDeployer, vaultDeployer, 1, 1 hours
        );
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        new RobynNativeLaunchFactoryV4(
            RobynV4AssetRouter(payable(address(0xB0B))), tokenDeployer, vaultDeployer, 1, 1 hours
        );
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        new RobynNativeLaunchFactoryV4(
            assetRouter,
            RobynNativeLaunchDeployerV4(address(0xB0B)),
            vaultDeployer,
            1,
            1 hours
        );
        vm.expectRevert(RobynNativeLaunchFactoryV4.InvalidAddress.selector);
        new RobynNativeLaunchFactoryV4(
            assetRouter,
            tokenDeployer,
            RobynNativeVaultDeployerV4(address(0xB0B)),
            1,
            1 hours
        );

        (
            RobynLaunchToken token,
            RobynNativeBasketVaultV2 vault,
            RobynV4BondingCurveMarket canonicalMarket
        ) = coordinator.createLaunch(_request(bytes32(uint256(917))));
        RobynV4BondingCurveMarket.CurveConfig memory curve = _curve();
        RobynV4GraduationAdapter adapter = canonicalMarket.graduationAdapter();
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        new RobynV4BondingCurveMarket(
            RobynLaunchToken(address(0)), vault, address(this), address(this), curve, adapter
        );
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        new RobynV4BondingCurveMarket(
            token,
            RobynNativeBasketVaultV2(payable(address(0))),
            address(this),
            address(this),
            curve,
            adapter
        );
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        new RobynV4BondingCurveMarket(token, vault, address(0), address(this), curve, adapter);
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        new RobynV4BondingCurveMarket(token, vault, address(this), address(0), curve, adapter);
        vm.expectRevert(RobynV4BondingCurveMarket.InvalidConfiguration.selector);
        new RobynV4BondingCurveMarket(
            token,
            vault,
            address(this),
            address(this),
            curve,
            RobynV4GraduationAdapter(payable(address(0)))
        );
    }

    function testAdapterAndLockerConstructorLimitBranches() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(918))));
        uint160 sqrtPrice = marketFactory.terminalSqrtPriceX96();
        _expectInvalidAdapter(token, 0, 9_900, 0.25 ether);
        _expectInvalidAdapter(token, sqrtPrice, 0, 0.25 ether);
        _expectInvalidAdapter(token, sqrtPrice, 10_001, 0.25 ether);
        _expectInvalidAdapter(token, sqrtPrice, 9_900, 0);

        PoolKey memory key = market.graduationAdapter().poolKey();
        _expectInvalidLocker(token, key, 0, payable(TREASURY), marketFactory.tokenSink());
        _expectInvalidLocker(token, key, 1, payable(address(0)), marketFactory.tokenSink());
        _expectInvalidLocker(token, key, 1, payable(TREASURY), address(0));
        _expectInvalidLocker(token, key, 1, payable(TREASURY), address(0xB0B));
    }

    function testMarketFactoryRejectsEachCurveAndLimitBoundary() public {
        RobynV4MarketFactory.Dependencies memory dependencies = _dependencies();
        RobynV4BondingCurveMarket.CurveConfig memory curve = _curve();
        curve.curveTokenAllocation = 0;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.graduationTokenAllocation = 0;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.initialVirtualTokenReserve = curve.curveTokenAllocation;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.graduationThresholdNative = 0.01 ether - 1;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.graduationThresholdNative = 100 ether + 1;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.maximumCurvePurchase = 0;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.maximumCurvePurchase = curve.graduationThresholdNative / 2 + 1;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.curveFeeBps = 0;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);
        curve = _curve();
        curve.curveFeeBps = 1_001;
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 1);

        curve = _curve();
        _expectInvalidFactory(dependencies, curve, 0, 1, 1, 1);
        _expectInvalidFactory(dependencies, curve, 10_001, 1, 1, 1);
        _expectInvalidFactory(dependencies, curve, 9_900, 0, 1, 1);
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 0, 1);
        _expectInvalidFactory(dependencies, curve, 9_900, 1, 1, 0);
    }

    function _freshLaunchFactory()
        private
        returns (
            RobynNativeLaunchFactoryV4 fresh,
            RobynNativeLaunchDeployerV4 tokenDeployer,
            RobynNativeVaultDeployerV4 vaultDeployer
        )
    {
        tokenDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        vaultDeployer = new RobynNativeVaultDeployerV4();
        fresh = new RobynNativeLaunchFactoryV4(assetRouter, tokenDeployer, vaultDeployer, 1, 1 hours);
    }

    function _expectInvalidAdapter(
        RobynLaunchToken token,
        uint160 sqrtPrice,
        uint16 minimumUseBps,
        uint128 maximumNativeSwap
    ) private {
        vm.expectRevert(RobynV4GraduationAdapter.InvalidConfiguration.selector);
        new RobynV4GraduationAdapter(
            token,
            poolManager,
            IPositionManager(address(positionManager)),
            permit2,
            stateView,
            assetRouter,
            IHooks(address(hook)),
            address(this),
            sqrtPrice,
            minimumUseBps,
            maximumNativeSwap
        );
    }

    function _expectInvalidLocker(
        RobynLaunchToken token,
        PoolKey memory key,
        uint128 maximumNativeSaleOutput,
        address payable treasury,
        address sink
    ) private {
        vm.expectRevert(RobynV4FeePositionLocker.InvalidConfiguration.selector);
        new RobynV4FeePositionLocker(
            IPositionManagerPermit2(address(positionManager)),
            permit2,
            poolManager,
            token,
            key,
            address(this),
            maximumNativeSaleOutput,
            treasury,
            sink,
            1,
            1
        );
    }

    function _freshAssetRouter() private returns (RobynV4AssetRouter) {
        return new RobynV4AssetRouter(
            poolManager,
            quoter,
            stateView,
            TREASURY,
            GUARDIAN,
            IWrappedNative(address(testWrappedNative))
        );
    }

    function _validRoute() private view returns (RobynV4AssetRouter.Route memory route) {
        route = RobynV4AssetRouter.Route({
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0)),
            minimumLiquidity: 1,
            maximumNativeInput: 0.25 ether,
            referenceTick: 0,
            maximumReferenceTickDeviation: 198,
            enforceReferencePrice: true,
            verificationClass: keccak256("SCHEMA16_COVERAGE"),
            enabled: true
        });
    }

    function _exerciseControllerBinding(address deployer) private {
        IControllerBinder binder = IControllerBinder(deployer);
        vm.prank(address(0xA11CE));
        vm.expectRevert(RobynNativeLaunchDeployerV4.Unauthorized.selector);
        binder.bindController(address(this));
        vm.expectRevert(RobynNativeLaunchDeployerV4.InvalidController.selector);
        binder.bindController(address(0));
        vm.expectRevert(RobynNativeLaunchDeployerV4.InvalidController.selector);
        binder.bindController(address(0xB0B));
        binder.bindController(address(this));
        vm.expectRevert(RobynNativeLaunchDeployerV4.AlreadyBound.selector);
        binder.bindController(address(this));
    }

    function _dependencies()
        private
        view
        returns (RobynV4MarketFactory.Dependencies memory dependencies)
    {
        dependencies = RobynV4MarketFactory.Dependencies({
            launchFactory: marketFactory.launchFactory(),
            feeRouter: marketFactory.feeRouter(),
            assetRouter: marketFactory.assetRouter(),
            oracleHook: marketFactory.oracleHook(),
            poolManager: marketFactory.poolManager(),
            positionManager: marketFactory.positionManager(),
            permit2: marketFactory.permit2(),
            stateView: marketFactory.stateView(),
            adapterDeployer: marketFactory.adapterDeployer(),
            lockerDeployer: marketFactory.lockerDeployer(),
            marketDeployer: marketFactory.marketDeployer(),
            tokenSink: marketFactory.tokenSink()
        });
    }

    function _curve() private view returns (RobynV4BondingCurveMarket.CurveConfig memory curve) {
        curve = RobynV4BondingCurveMarket.CurveConfig({
            curveTokenAllocation: marketFactory.curveTokenAllocation(),
            graduationTokenAllocation: marketFactory.graduationTokenAllocation(),
            initialVirtualTokenReserve: marketFactory.initialVirtualTokenReserve(),
            initialVirtualNativeReserve: marketFactory.initialVirtualNativeReserve(),
            graduationThresholdNative: marketFactory.graduationThresholdNative(),
            maximumCurvePurchase: marketFactory.maximumCurvePurchase(),
            curveFeeBps: marketFactory.curveFeeBps()
        });
    }

    function _deployMarketFactory(
        RobynV4MarketFactory.Dependencies memory dependencies,
        RobynV4BondingCurveMarket.CurveConfig memory curve,
        uint16 minimumUseBps,
        uint128 maximumNativeSwap,
        uint256 maximumNativeResidual,
        uint256 maximumTokenResidual
    ) private returns (RobynV4MarketFactory) {
        return new RobynV4MarketFactory(
            dependencies,
            curve,
            minimumUseBps,
            maximumNativeSwap,
            maximumNativeResidual,
            maximumTokenResidual
        );
    }

    function _expectInvalidFactory(
        RobynV4MarketFactory.Dependencies memory dependencies,
        RobynV4BondingCurveMarket.CurveConfig memory curve,
        uint16 minimumUseBps,
        uint128 maximumNativeSwap,
        uint256 maximumNativeResidual,
        uint256 maximumTokenResidual
    ) private {
        vm.expectRevert(RobynV4MarketFactory.InvalidConfiguration.selector);
        _deployMarketFactory(
            dependencies,
            curve,
            minimumUseBps,
            maximumNativeSwap,
            maximumNativeResidual,
            maximumTokenResidual
        );
    }
}

interface IControllerBinder {
    function bindController(address controller) external;
}
