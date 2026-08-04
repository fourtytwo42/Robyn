// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IRobynMaintenanceCoordinator} from "../src/interfaces/IRobynMaintenanceCoordinator.sol";
import {RobynClaimsRouter} from "../src/RobynClaimsRouter.sol";
import {RobynLaunchToken} from "../src/RobynLaunchToken.sol";
import {RobynMaintenanceCoordinator} from "../src/RobynMaintenanceCoordinator.sol";
import {RobynRdaoBondingSale} from "../src/RobynRdaoBondingSale.sol";
import {IRobynWrappedNative, RobynRdaoStaking} from "../src/RobynRdaoStaking.sol";
import {RobynTokenSink} from "../src/RobynTokenSink.sol";
import {RobynTradeRouter} from "../src/RobynTradeRouter.sol";
import {RobynNativeLaunchDeployerV4} from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import {RobynNativeLaunchFactoryV4} from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import {RobynNativeProtocolFeeRouterV5} from "../src/uniswap/RobynNativeProtocolFeeRouterV5.sol";
import {RobynNativeVaultDeployerV4} from "../src/uniswap/RobynNativeVaultDeployerV4.sol";
import {RobynRdaoV4LiquidityLocker} from "../src/uniswap/RobynRdaoV4LiquidityLocker.sol";
import {RobynV4AdapterDeployer} from "../src/uniswap/RobynV4AdapterDeployer.sol";
import {RobynV4AssetRouter, IWrappedNative} from "../src/uniswap/RobynV4AssetRouter.sol";
import {RobynV4BondingCurveMarket} from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import {RobynV4LaunchCoordinatorV7} from "../src/uniswap/RobynV4LaunchCoordinatorV7.sol";
import {RobynV4LockerDeployer} from "../src/uniswap/RobynV4LockerDeployer.sol";
import {RobynV4MarketDeployer} from "../src/uniswap/RobynV4MarketDeployer.sol";
import {RobynV4MarketFactory} from "../src/uniswap/RobynV4MarketFactory.sol";
import {RobynV4NativeProtocolTest} from "./RobynV4NativeProtocol.t.sol";

contract Schema20FullStackTest is RobynV4NativeProtocolTest {
    function testFreshFullStackBindsRdaoSaleStakingAndProtocolDaoShare() external {
        assetRouter = new RobynV4AssetRouter(
            poolManager, quoter, stateView, address(this), GUARDIAN, IWrappedNative(address(testWrappedNative))
        );
        assetRouter.configureRoute(
            address(basketAsset),
            RobynV4AssetRouter.Route({
                fee: 3_000,
                tickSpacing: 60,
                hooks: IHooks(address(0)),
                minimumLiquidity: 1,
                maximumNativeInput: 0.25 ether,
                referenceTick: 0,
                maximumReferenceTickDeviation: 198,
                enforceReferencePrice: true,
                verificationClass: keccak256("TEST_BASKET_ASSET"),
                enabled: true
            })
        );

        RobynNativeLaunchDeployerV4 launchDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        RobynNativeVaultDeployerV4 vaultDeployer = new RobynNativeVaultDeployerV4();
        launchFactory = new RobynNativeLaunchFactoryV4(assetRouter, launchDeployer, vaultDeployer, 1 wei, 1 hours);
        RobynNativeProtocolFeeRouterV5 schema20FeeRouter =
            new RobynNativeProtocolFeeRouterV5(daoToken, assetRouter, TREASURY, GUARDIAN, 1 hours);
        feeRouter = schema20FeeRouter;
        RobynRdaoStaking staking = new RobynRdaoStaking(
            IERC20(address(daoToken)),
            IRobynWrappedNative(address(testWrappedNative)),
            address(this),
            GUARDIAN,
            1 hours,
            1 hours,
            7 days
        );
        RobynRdaoV4LiquidityLocker rdaoLocker = new RobynRdaoV4LiquidityLocker(
            poolManager,
            IERC20(address(daoToken)),
            IRobynWrappedNative(address(testWrappedNative)),
            staking,
            10_000,
            100
        );
        RobynRdaoBondingSale rdaoSale = new RobynRdaoBondingSale(
            IERC20(address(daoToken)),
            staking,
            rdaoLocker,
            RobynRdaoBondingSale.SaleConfiguration({
                deployerPayoutRecipient: payable(address(this)),
                governance: address(this),
                guardian: GUARDIAN,
                saleInventory: 150_000_000 ether,
                liquidityInventory: 50_000_000 ether,
                virtualTokenReserve: 600_000_000 ether,
                virtualNativeReserve: 996_953_752_423_151_481_585,
                curvePrincipalTarget: 332_317_917_474_383_827_195,
                deployerPayout: 184_621_065_263_546_570_663,
                liquidityNative: 147_696_852_210_837_256_531,
                maintenanceGasLimit: 1_500_000
            })
        );
        rdaoLocker.bindSale(address(rdaoSale));

        RobynMaintenanceCoordinator maintenance = new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        RobynClaimsRouter claims = new RobynClaimsRouter(IRobynMaintenanceCoordinator(address(maintenance)), 1_550_000);
        RobynTradeRouter trades = new RobynTradeRouter();
        feeRouter.bindMaintenanceCoordinator(address(maintenance));
        staking.configureRewardSource(address(feeRouter), true);
        staking.configureRewardSource(address(rdaoSale), true);
        staking.configureRewardSource(address(rdaoLocker), true);
        staking.sealRewardSources();
        feeRouter.bindDaoRewardReceiver(address(staking));

        hook = _deployHook();
        RobynV4AdapterDeployer adapterDeployer = new RobynV4AdapterDeployer();
        RobynV4LockerDeployer lockerDeployer = new RobynV4LockerDeployer();
        RobynV4MarketDeployer marketDeployer = new RobynV4MarketDeployer();
        marketFactory = new RobynV4MarketFactory(
            RobynV4MarketFactory.Dependencies({
                launchFactory: launchFactory,
                feeRouter: feeRouter,
                assetRouter: assetRouter,
                oracleHook: hook,
                poolManager: poolManager,
                positionManager: positionManager,
                permit2: permit2,
                stateView: stateView,
                adapterDeployer: adapterDeployer,
                lockerDeployer: lockerDeployer,
                marketDeployer: marketDeployer,
                tokenSink: address(new RobynTokenSink())
            }),
            RobynV4BondingCurveMarket.CurveConfig({
                curveTokenAllocation: 800_000_000 ether,
                graduationTokenAllocation: 200_000_000 ether,
                initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666,
                initialVirtualNativeReserve: 0.5 ether,
                graduationThresholdNative: 1.5 ether + 1,
                maximumCurvePurchase: 0.5 ether,
                curveFeeBps: 100
            }),
            9_900,
            0.25 ether,
            1 gwei,
            0.000001 ether
        );
        RobynV4LaunchCoordinatorV7 schema20Coordinator =
            new RobynV4LaunchCoordinatorV7(launchFactory, marketFactory, feeRouter, trades, TREASURY, GUARDIAN);
        launchDeployer.bindController(address(launchFactory));
        vaultDeployer.bindController(address(launchFactory));
        adapterDeployer.bindController(address(marketFactory));
        lockerDeployer.bindController(address(marketFactory));
        marketDeployer.bindController(address(marketFactory));
        hook.bindRegistrar(address(marketFactory));
        assetRouter.bindLaunchRegistrar(address(marketFactory));
        launchFactory.bindCoordinator(address(schema20Coordinator));
        marketFactory.bindCoordinator(address(schema20Coordinator));
        feeRouter.bindCoordinator(address(schema20Coordinator));

        daoToken.approve(address(staking), 800_000_000 ether);
        staking.stake(800_000_000 ether, address(this));
        daoToken.approve(address(rdaoSale), 200_000_000 ether);
        rdaoSale.fundAllocation();
        vm.warp(block.timestamp + 1 hours);
        staking.activateFor(address(this));

        (RobynLaunchToken launchToken,, RobynV4BondingCurveMarket launchMarket) =
            schema20Coordinator.createLaunch(_request(keccak256("schema20-full-stack")));
        launchMarket.buy{value: 0.1 ether}(1);
        uint256 daoShare = feeRouter.launchAccount(address(launchToken)).pendingDaoNative;
        feeRouter.settleDaoFees(address(launchToken), daoShare);

        assertEq(schema20FeeRouter.daoRewardReceiver(), address(staking));
        assertEq(staking.totalPrincipal(), 800_000_000 ether);
        assertEq(staking.totalRewardsDeposited(), daoShare);
        assertEq(rdaoSale.saleInventory(), 150_000_000 ether);
        assertEq(rdaoSale.liquidityInventory(), 50_000_000 ether);
        assertEq(address(claims.maintenanceCoordinator()), address(maintenance));
        assertEq(uint256(schema20Coordinator.launchMode()), uint256(RobynV4LaunchCoordinatorV7.LaunchMode.Public));
    }
}
