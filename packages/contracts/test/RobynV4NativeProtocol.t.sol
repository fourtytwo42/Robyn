// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynTokenSink } from "../src/RobynTokenSink.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynNativeLaunchDeployerV4 } from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import { RobynNativeLaunchFactoryV4 } from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import { RobynNativeVaultDeployerV4 } from "../src/uniswap/RobynNativeVaultDeployerV4.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4AssetRouter } from "../src/uniswap/RobynV4AssetRouter.sol";
import { RobynV4AdapterDeployer } from "../src/uniswap/RobynV4AdapterDeployer.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4FeePositionLocker } from "../src/uniswap/RobynV4FeePositionLocker.sol";
import { RobynV4LaunchCoordinatorV5 } from "../src/uniswap/RobynV4LaunchCoordinatorV5.sol";
import { RobynV4LockerDeployer } from "../src/uniswap/RobynV4LockerDeployer.sol";
import { RobynV4MarketDeployer } from "../src/uniswap/RobynV4MarketDeployer.sol";
import { RobynV4MarketFactory } from "../src/uniswap/RobynV4MarketFactory.sol";
import { RobynV4FeeAndPhaseHook } from "../src/uniswap/RobynV4FeeAndPhaseHook.sol";

interface ITestPositionManager is IPositionManager {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IPoolSwapFixture {
    struct TestSettings {
        bool takeClaims;
        bool settleUsingBurn;
    }

    function swap(
        PoolKey memory key,
        SwapParams memory params,
        TestSettings memory settings,
        bytes memory hookData
    ) external payable returns (BalanceDelta delta);
}

interface IPoolModifyLiquidityFixture {
    function modifyLiquidity(
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes memory hookData
    ) external payable returns (bytes32 delta);
}

interface IPoolDonateFixture {
    function donate(PoolKey memory key, uint256 amount0, uint256 amount1, bytes memory hookData)
        external
        payable
        returns (BalanceDelta delta);
}

contract V4TestAsset is ERC20 {
    constructor() ERC20("Test Basket Asset", "TBA") {
        _mint(msg.sender, 10_000_000 ether);
    }
}

contract RobynV4NativeProtocolTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager internal poolManager;
    IAllowanceTransfer internal permit2;
    ITestPositionManager internal positionManager;
    IStateView internal stateView;
    IV4Quoter internal quoter;
    RobynV4AssetRouter internal assetRouter;
    RobynV4FeeAndPhaseHook internal hook;
    RobynNativeLaunchFactoryV4 internal launchFactory;
    RobynNativeProtocolFeeRouterV4 internal feeRouter;
    RobynV4MarketFactory internal marketFactory;
    RobynV4LaunchCoordinatorV5 internal coordinator;
    RobynDaoToken internal daoToken;
    V4TestAsset internal basketAsset;

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address payable internal constant TREASURY = payable(address(0xBEEF));
    address internal constant GUARDIAN = address(0xCAFE);
    string internal constant METADATA_URI =
        "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q";

    receive() external payable { }

    function setUp() public virtual {
        vm.deal(address(this), 100 ether);
        poolManager = IPoolManager(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolManager.sol/PoolManager.default.json",
                abi.encode(address(this))
            )
        );
        vm.etch(PERMIT2, vm.parseBytes(vm.readLine("test/fixtures/permit2-runtime.hex")));
        permit2 = IAllowanceTransfer(PERMIT2);
        positionManager = ITestPositionManager(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json",
                abi.encode(poolManager, permit2, 300_000, address(1), address(2))
            )
        );
        stateView = IStateView(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/StateView.sol/StateView.json",
                abi.encode(poolManager)
            )
        );
        quoter = IV4Quoter(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/V4Quoter.sol/V4Quoter.json",
                abi.encode(poolManager)
            )
        );
        assetRouter = new RobynV4AssetRouter(poolManager, quoter, stateView, address(this));
        basketAsset = new V4TestAsset();
        _seedBasketPool();

        RobynNativeLaunchDeployerV4 launchDeployer = new RobynNativeLaunchDeployerV4();
        RobynNativeVaultDeployerV4 vaultDeployer = new RobynNativeVaultDeployerV4();
        launchFactory = new RobynNativeLaunchFactoryV4(
            assetRouter, launchDeployer, vaultDeployer, 1 wei, 1 hours
        );
        launchDeployer.bindController(address(launchFactory));
        vaultDeployer.bindController(address(launchFactory));

        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        daoToken = new RobynDaoToken(recipients, allocations);
        feeRouter = new RobynNativeProtocolFeeRouterV4(daoToken, assetRouter, TREASURY, GUARDIAN);
        hook = _deployHook();

        RobynV4BondingCurveMarket.CurveConfig memory curve = RobynV4BondingCurveMarket.CurveConfig({
            curveTokenAllocation: 800_000_000 ether,
            graduationTokenAllocation: 200_000_000 ether,
            initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666,
            initialVirtualNativeReserve: 0.5 ether,
            graduationThresholdNative: 1.5 ether + 1,
            maximumCurvePurchase: 0.5 ether,
            curveFeeBps: 100
        });
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
            curve,
            9_900,
            0.25 ether,
            1 gwei,
            0.000001 ether
        );
        adapterDeployer.bindController(address(marketFactory));
        lockerDeployer.bindController(address(marketFactory));
        marketDeployer.bindController(address(marketFactory));
        hook.bindRegistrar(address(marketFactory));
        assetRouter.bindLaunchRegistrar(address(marketFactory));
        coordinator = new RobynV4LaunchCoordinatorV5(launchFactory, marketFactory, feeRouter);
        launchFactory.bindCoordinator(address(coordinator));
        marketFactory.bindCoordinator(address(coordinator));
        feeRouter.bindCoordinator(address(coordinator));
        address[] memory exclusions = new address[](1);
        exclusions[0] = TREASURY;
        daoToken.sealRewardExclusions(exclusions);
        daoToken.bindRewardDepositor(address(feeRouter));
    }

    function testAtomicLaunchInitializesPoolAndSeedsSupply() public {
        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(1))));

        assertEq(token.balanceOf(address(market)), 1_000_000_000 ether);
        assertEq(address(vault.launchToken()), address(token));
        assertTrue(market.seeded());
        assertFalse(market.graduated());
        bytes32 poolId = marketFactory.poolIdByToken(address(token));
        (uint160 sqrtPriceX96,,,) = stateView.getSlot0(PoolId.wrap(poolId));
        assertEq(sqrtPriceX96, marketFactory.terminalSqrtPriceX96());
        assertEq(assetRouter.routeStatus(address(token)).poolId, poolId);
        assertFalse(assetRouter.routeStatus(address(token)).ready);
    }

    function testAtomicLaunchCanIncludeCreatorPurchase() public {
        uint256 purchase = 0.1 ether;
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch{ value: purchase }(_request(bytes32(uint256(101))));

        uint256 creatorTokens = token.balanceOf(address(this));
        assertGt(creatorTokens, 0);
        assertEq(token.balanceOf(address(market)), 1_000_000_000 ether - creatorTokens);
        assertEq(token.balanceOf(address(coordinator)), 0);
        assertEq(address(coordinator).balance, 0);
        assertEq(feeRouter.launchAccount(address(token)).cumulativeNativeFees, 0.001 ether);
        assertTrue(token.exclusionsSealed());
        assertFalse(market.graduated());
    }

    function testBondingCurvePurchaseCapIsEnforced() public {
        (,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(104))));
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynV4BondingCurveMarket.MaximumCurvePurchaseExceeded.selector,
                0.5 ether,
                0.5 ether + 1
            )
        );
        market.buy{ value: 0.5 ether + 1 }(1);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynV4BondingCurveMarket.MaximumCurvePurchaseExceeded.selector,
                0.5 ether,
                0.5 ether + 1
            )
        );
        market.quoteBuy(0.5 ether + 1);
    }

    function testOnlyCoordinatorCanUseLaunchPurchasePath() public {
        (,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(102))));
        vm.deal(address(0x1234), 1 ether);
        vm.prank(address(0x1234));
        vm.expectRevert(RobynV4BondingCurveMarket.Unauthorized.selector);
        market.buyFor{ value: 0.1 ether }(address(0x1234), 1);
    }

    function testOversizedInitialPurchaseRollsBackLaunch() public {
        uint256 countBefore = launchFactory.launchCount();
        vm.expectPartialRevert(RobynV4BondingCurveMarket.MaximumCurvePurchaseExceeded.selector);
        coordinator.createLaunch{ value: 1.4 ether }(_request(bytes32(uint256(103))));
        assertEq(launchFactory.launchCount(), countBefore);
    }

    function testOracleHookRejectsZeroInitializer() public {
        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidConfiguration.selector);
        new RobynV4FeeAndPhaseHook(
            poolManager,
            feeRouter,
            address(0),
            address(positionManager),
            keccak256("invalid-initializer")
        );
    }

    function testOracleHookRejectsZeroDeploymentDomain() public {
        vm.expectRevert(RobynV4FeeAndPhaseHook.InvalidConfiguration.selector);
        new RobynV4FeeAndPhaseHook(
            poolManager, feeRouter, address(this), address(positionManager), bytes32(0)
        );
    }

    function testAssetRouterBootstrapConfigurationClosesWhenRegistrarBinds() public {
        RobynV4AssetRouter bootstrapRouter =
            new RobynV4AssetRouter(poolManager, quoter, stateView, address(0xF00D));
        RobynV4AssetRouter.Route memory configured = RobynV4AssetRouter.Route({
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0)),
            minimumLiquidity: 1,
            maximumNativeInput: 0.1 ether,
            referenceTick: 0,
            maximumReferenceTickDeviation: 198,
            enforceReferencePrice: true,
            verificationClass: keccak256("TEST"),
            enabled: true
        });

        bootstrapRouter.configureRoute(address(basketAsset), configured);
        bootstrapRouter.bindLaunchRegistrar(address(marketFactory));
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        bootstrapRouter.configureRoute(address(basketAsset), configured);

        vm.prank(address(0xF00D));
        bootstrapRouter.configureRoute(address(basketAsset), configured);
    }

    function testCurveFeesConserveImmutableSplit() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(2))));
        uint256 treasuryBefore = TREASURY.balance;
        market.buy{ value: 0.1 ether }(1);
        uint256 totalFee = feeRouter.launchAccount(address(token)).cumulativeNativeFees;
        assertEq(totalFee, 0.001 ether);
        assertEq(feeRouter.totalCreatorNativeLiability(), 0.00025 ether);
        assertEq(feeRouter.totalDaoNativeRewards(), 0.0002 ether);
        assertEq(feeRouter.totalTreasuryNative(), 0.00005 ether);
        assertEq(feeRouter.totalBasketNative(), 0.0005 ether);
        assertEq(TREASURY.balance - treasuryBefore, 0);
        assertEq(feeRouter.totalNativeLiabilities(), 0.001 ether);
        feeRouter.settleBasketFees(address(token), 0.0005 ether);
        feeRouter.settleDaoFees(0.0002 ether);
        feeRouter.settleTreasuryFees(0.00005 ether);
        assertEq(TREASURY.balance - treasuryBefore, 0.00005 ether);
        assertEq(address(feeRouter).balance, feeRouter.totalCreatorNativeLiability());
    }

    function testZeroEligibleDaoSupplyQueuesWithoutBlockingTrade() public {
        if (daoToken.balanceOf(address(this)) != daoToken.totalSupply()) return;
        daoToken.transfer(TREASURY, daoToken.balanceOf(address(this)));
        assertEq(daoToken.eligibleRewardSupply(), 0);
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(306))));

        market.buy{ value: 0.1 ether }(1);

        assertEq(feeRouter.totalDaoNativeLiability(), 0.0002 ether);
        vm.expectRevert(RobynNativeProtocolFeeRouterV4.InvalidConfiguration.selector);
        feeRouter.settleDaoFees(0.0002 ether);

        uint256 excludedBalance = daoToken.balanceOf(TREASURY);
        vm.prank(TREASURY);
        daoToken.transfer(address(this), excludedBalance);
        feeRouter.settleDaoFees(0.0002 ether);
        assertEq(feeRouter.totalDaoNativeLiability(), 0);
        assertEq(daoToken.totalRewardsDeposited(), 0.0002 ether);
        assertGt(feeRouter.launchAccount(address(token)).cumulativeNativeFees, 0);
    }

    function testProtectedBasketRouteRejectsWeakMinimumOutputAndReferenceDeviation() public {
        uint128 amount = 0.002 ether;
        vm.expectPartialRevert(RobynV4AssetRouter.WeakMinimumOutput.selector);
        assetRouter.swapExactNativeForAsset{ value: amount }(
            address(basketAsset), 1, address(this), block.timestamp
        );

        for (
            uint256 index;
            index < 128 && assetRouter.routeStatus(address(basketAsset)).ready;
            ++index
        ) {
            (uint256 quote,) = assetRouter.quoteNativeToAsset(address(basketAsset), amount);
            assetRouter.swapExactNativeForAsset{ value: amount }(
                address(basketAsset), (quote * 99) / 100, address(this), block.timestamp
            );
        }
        RobynV4AssetRouter.RouteStatus memory status = assetRouter.routeStatus(address(basketAsset));
        assertFalse(status.ready);
        assertEq(status.reason, assetRouter.REASON_REFERENCE_PRICE_DEVIATION());
    }

    function testProtectedBasketImpactAllowanceIsAppliedAfterPoolFee() public view {
        assertEq(assetRouter.protectedQuoteFloor(1 ether, 3_000), 0.98703 ether);
    }

    function testGraduationLocksPrincipalAndPostGraduationTrades() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(3))));
        _graduateMarket(market);
        assertTrue(market.graduated());
        assertEq(
            uint256(hook.poolPhase(market.graduationAdapter().poolId())),
            uint256(RobynV4FeeAndPhaseHook.PoolPhase.Trading)
        );
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        uint128 principal = locker.principalLiquidity();
        assertGt(principal, 0);
        assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principal);
        assertEq(positionManager.ownerOf(locker.positionTokenId()), address(locker));
        assertTrue(assetRouter.routeStatus(address(token)).ready);

        uint256 tokenBefore = token.balanceOf(address(this));
        market.buy{ value: 0.01 ether }(1);
        assertGt(token.balanceOf(address(this)), tokenBefore);
        uint128 sellAmount = uint128((token.balanceOf(address(this)) - tokenBefore) / 2);
        token.approve(address(market), sellAmount);
        uint256 nativeBefore = address(this).balance;
        market.sell(sellAmount, 1);
        assertGt(address(this).balance, nativeBefore);
        locker.collectFees(0, 0);
        assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principal);
    }

    function testBondingPoolRejectsDirectSwapLiquidityAndDonation() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(305))));
        PoolKey memory key = market.graduationAdapter().poolKey();
        (uint160 priceBefore, int24 tickBefore,,) = stateView.getSlot0(key.toId());
        assertEq(
            uint256(hook.poolPhase(PoolId.unwrap(key.toId()))),
            uint256(RobynV4FeeAndPhaseHook.PoolPhase.Bonding)
        );

        IPoolSwapFixture swapper = IPoolSwapFixture(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolSwapTest.sol/PoolSwapTest.default.json",
                abi.encode(poolManager)
            )
        );
        IPoolSwapFixture.TestSettings memory settings =
            IPoolSwapFixture.TestSettings({ takeClaims: false, settleUsingBurn: false });
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        swapper.swap{ value: 0.01 ether }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(0.01 ether),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            bytes("")
        );

        market.buy{ value: 0.1 ether }(1);
        IPoolModifyLiquidityFixture liquidityRouter = IPoolModifyLiquidityFixture(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.default.json",
                abi.encode(poolManager)
            )
        );
        token.approve(address(liquidityRouter), type(uint256).max);
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        liquidityRouter.modifyLiquidity{ value: 0.01 ether }(
            key,
            ModifyLiquidityParams({
                tickLower: -887200,
                tickUpper: 887200,
                liquidityDelta: int256(1 ether),
                salt: keccak256("blocked-pre-graduation")
            }),
            bytes("")
        );

        IPoolDonateFixture donor = IPoolDonateFixture(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolDonateTest.sol/PoolDonateTest.json",
                abi.encode(poolManager)
            )
        );
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        donor.donate{ value: 1 wei }(key, 1 wei, 0, bytes(""));

        (uint160 priceAfter, int24 tickAfter,,) = stateView.getSlot0(key.toId());
        assertEq(priceAfter, priceBefore);
        assertEq(tickAfter, tickBefore);
        assertEq(hook.observationCount(PoolId.unwrap(key.toId())), 1);
    }

    function testLockerSegregatesPrincipalFeesAndUnattributedAssets() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(307))));
        _graduateMarket(market);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        uint256 principalNativeResidual = locker.principalNativeResidual();
        uint256 principalResidual = locker.principalTokenResidual();
        uint128 principalLiquidity = locker.principalLiquidity();
        assertGt(principalNativeResidual, 0);
        assertEq(locker.unattributedNative(), 0);

        token.transfer(address(locker), 1 ether);
        assertEq(locker.unattributedLaunchTokens(), 1 ether);
        vm.expectRevert(RobynV4FeePositionLocker.InvalidConfiguration.selector);
        locker.convertCollectedToken(1 ether, 1, block.timestamp);
        locker.sweepUnattributedLaunchTokens();
        assertEq(token.balanceOf(marketFactory.tokenSink()), 1 ether);
        assertEq(locker.principalTokenResidual(), principalResidual);

        uint256 treasuryBefore = TREASURY.balance;
        vm.deal(address(locker), address(locker).balance + 1 ether);
        assertEq(locker.unattributedNative(), 1 ether);
        vm.expectRevert(RobynV4FeePositionLocker.InvalidConfiguration.selector);
        locker.routeCollectedNative(1 ether);
        locker.sweepUnattributedNative();
        assertEq(TREASURY.balance - treasuryBefore, 1 ether);
        assertEq(locker.principalNativeResidual(), principalNativeResidual);
        assertEq(address(locker).balance, principalNativeResidual);
        assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principalLiquidity);
    }

    function testThirdPartyLiquidityDilutesLockedLpFeesButNotHookFees() public {
        (RobynLaunchToken soloToken,, RobynV4BondingCurveMarket soloMarket) =
            coordinator.createLaunch(_request(bytes32(uint256(303))));
        (RobynLaunchToken sharedToken,, RobynV4BondingCurveMarket sharedMarket) =
            coordinator.createLaunch(_request(bytes32(uint256(304))));
        _graduateMarket(soloMarket);
        _graduateMarket(sharedMarket);

        RobynV4FeePositionLocker soloLocker = soloMarket.graduationAdapter().locker();
        RobynV4FeePositionLocker sharedLocker = sharedMarket.graduationAdapter().locker();
        _addThirdPartyFullRangeLiquidity(
            sharedMarket.graduationAdapter().poolKey(),
            sharedToken,
            sharedLocker.principalLiquidity()
        );

        uint256 soloLockedLpFee = _accrueAndRoutePostGraduationFees(soloMarket, soloToken);
        uint256 sharedLockedLpFee = _accrueAndRoutePostGraduationFees(sharedMarket, sharedToken);
        assertGt(soloLockedLpFee, 0);
        assertGt(sharedLockedLpFee, 0);
        assertLt(sharedLockedLpFee, soloLockedLpFee);
        assertEq(
            positionManager.getPositionLiquidity(soloLocker.positionTokenId()),
            soloLocker.principalLiquidity()
        );
        assertEq(
            positionManager.getPositionLiquidity(sharedLocker.positionTokenId()),
            sharedLocker.principalLiquidity()
        );
    }

    function testHookChargesAndSettlesExactInputFeesInBothDirections() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(30))));
        _graduateMarket(market);

        uint256 tokenBefore = token.balanceOf(address(this));
        uint256 pendingTokenBefore = hook.pendingTokenFees(address(token));
        market.buy{ value: 0.01 ether }(1);
        uint256 receivedToken = token.balanceOf(address(this)) - tokenBefore;
        uint256 tokenFee = hook.pendingTokenFees(address(token)) - pendingTokenBefore;
        assertGt(tokenFee, 0);
        assertGe(tokenFee * 100, receivedToken + tokenFee);
        assertLt((tokenFee - 1) * 100, receivedToken + tokenFee);

        uint128 sellAmount = uint128(receivedToken / 2);
        token.approve(address(market), sellAmount);
        uint256 nativeBefore = address(this).balance;
        uint256 pendingNativeBefore = hook.pendingNativeFees(address(token));
        market.sell(sellAmount, 1);
        uint256 receivedNative = address(this).balance - nativeBefore;
        uint256 nativeFee = hook.pendingNativeFees(address(token)) - pendingNativeBefore;
        assertGt(nativeFee, 0);
        assertGe(nativeFee * 100, receivedNative + nativeFee);
        assertLt((nativeFee - 1) * 100, receivedNative + nativeFee);

        uint256 routedBefore = feeRouter.launchAccount(address(token)).cumulativeHookNativeFees;
        hook.settleNativeFees(token, nativeFee);
        assertEq(
            feeRouter.launchAccount(address(token)).cumulativeHookNativeFees,
            routedBefore + nativeFee
        );
        assertEq(hook.pendingNativeFees(address(token)), pendingNativeBefore);
    }

    function testHookChargesExactOutputFeesInBothDirections() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(301))));
        _graduateMarket(market);
        PoolKey memory key = market.graduationAdapter().poolKey();
        IPoolSwapFixture swapper = IPoolSwapFixture(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolSwapTest.sol/PoolSwapTest.default.json",
                abi.encode(poolManager)
            )
        );
        IPoolSwapFixture.TestSettings memory settings =
            IPoolSwapFixture.TestSettings({ takeClaims: false, settleUsingBurn: false });

        uint256 nativeFeeBefore = hook.pendingNativeFees(address(token));
        uint256 nativeBalanceBefore = address(this).balance;
        swapper.swap{ value: 0.1 ether }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: int256(1 ether),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            bytes("")
        );
        uint256 nativeSpent = nativeBalanceBefore - address(this).balance;
        uint256 nativeFee = hook.pendingNativeFees(address(token)) - nativeFeeBefore;
        assertGt(nativeFee, 0);
        assertGe(nativeFee * 100, nativeSpent);
        assertLt((nativeFee - 1) * 100, nativeSpent);

        token.approve(address(swapper), type(uint256).max);
        uint256 tokenFeeBefore = hook.pendingTokenFees(address(token));
        uint256 tokenBalanceBefore = token.balanceOf(address(this));
        swapper.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: int256(0.000001 ether),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            bytes("")
        );
        uint256 tokenSpent = tokenBalanceBefore - token.balanceOf(address(this));
        uint256 tokenFee = hook.pendingTokenFees(address(token)) - tokenFeeBefore;
        assertGt(tokenFee, 0);
        assertGe(tokenFee * 100, tokenSpent);
        assertLt((tokenFee - 1) * 100, tokenSpent);
    }

    function testHookTokenFeesConvertWithSafetyAndRemainFullyAttributed() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(302))));
        _graduateMarket(market);
        market.buy{ value: 0.01 ether }(1);
        vm.warp(block.timestamp + 5 minutes);
        market.buy{ value: 0.000001 ether }(1);

        uint128 tokenFees = uint128(hook.pendingTokenFees(address(token)));
        assertGt(tokenFees, 0);
        (uint256 quote,) = assetRouter.quoteAssetToNative(address(token), tokenFees);
        uint256 routedBefore = feeRouter.launchAccount(address(token)).cumulativeHookNativeFees;
        uint256 nativePendingBefore = hook.pendingNativeFees(address(token));

        uint256 nativeOut =
            hook.convertTokenFees(token, tokenFees, (quote * 99) / 100, block.timestamp);

        assertGt(nativeOut, 0);
        assertEq(hook.pendingTokenFees(address(token)), 0);
        assertEq(
            feeRouter.launchAccount(address(token)).cumulativeHookLaunchFeesConverted, tokenFees
        );
        assertEq(
            feeRouter.launchAccount(address(token)).cumulativeHookNativeFees,
            routedBefore + nativeOut
        );
        assertGt(hook.pendingNativeFees(address(token)), nativePendingBefore);
    }

    function testLaunchFeeSaleRequiresFiveMinuteOracleHistory() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(31))));
        _graduateMarket(market);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        uint128 collectedTokenFees = _accrueTokenLpFees(market, token);

        vm.expectRevert(RobynV4FeeAndPhaseHook.InsufficientHistory.selector);
        locker.convertCollectedToken(collectedTokenFees, 1, block.timestamp);
    }

    function testBoundedLaunchFeeSaleRoutesNativeAfterFreshTwap() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(32))));
        _graduateMarket(market);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        vm.warp(block.timestamp + 5 minutes);
        market.buy{ value: 0.000001 ether }(1);
        uint128 collectedTokenFees = _accrueTokenLpFees(market, token);
        uint256 feesBefore = feeRouter.launchAccount(address(token)).cumulativeNativeFees;

        uint256 nativeOut = locker.convertCollectedToken(collectedTokenFees, 1, block.timestamp);

        assertGt(nativeOut, 0);
        assertEq(
            feeRouter.launchAccount(address(token)).cumulativeLaunchFeesConverted,
            collectedTokenFees
        );
        assertEq(
            feeRouter.launchAccount(address(token)).cumulativeNativeFees, feesBefore + nativeOut
        );
    }

    function testLaunchFeeSaleRejectsSpotTwapManipulation() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(33))));
        _graduateMarket(market);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        uint128 collectedTokenFees = _accrueTokenLpFees(market, token);
        vm.warp(block.timestamp + 5 minutes);
        market.buy{ value: 0.1 ether }(1);

        vm.expectPartialRevert(RobynV4FeePositionLocker.SpotTwapDeviation.selector);
        locker.convertCollectedToken(collectedTokenFees, 1, block.timestamp);
    }

    function testLaunchFeeSaleRejectsStaleLatestObservation() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(34))));
        _graduateMarket(market);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        uint128 collectedTokenFees = _accrueTokenLpFees(market, token);
        vm.warp(block.timestamp + 5 minutes);
        market.buy{ value: 0.000001 ether }(1);
        vm.warp(block.timestamp + 15 minutes + 1);

        vm.expectPartialRevert(RobynV4FeePositionLocker.StaleObservation.selector);
        locker.convertCollectedToken(collectedTokenFees, 1, block.timestamp);
    }

    function testUnregisteredPredictedPoolCannotBeSquatted() public {
        RobynNativeLaunchFactoryV4.LaunchRequest memory request = _request(bytes32(uint256(4)));
        (address predictedToken,,) = coordinator.predictLaunchAddresses(address(this), request);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(predictedToken),
            fee: 10_000,
            tickSpacing: 200,
            hooks: IHooks(address(hook))
        });
        uint160 terminalPrice = marketFactory.terminalSqrtPriceX96();
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        poolManager.initialize(key, terminalPrice);
        (RobynLaunchToken token,,) = coordinator.createLaunch(request);
        assertEq(address(token), predictedToken);
    }

    function _graduateMarket(RobynV4BondingCurveMarket market) internal {
        while (!market.graduated()) {
            market.buy{ value: 0.5 ether }(1);
        }
    }

    function _accrueAndRoutePostGraduationFees(
        RobynV4BondingCurveMarket market,
        RobynLaunchToken token
    ) internal returns (uint256 lockedLpNativeFee) {
        uint256 hookFeeBefore = hook.pendingTokenFees(address(token));
        market.buy{ value: 0.01 ether }(1);
        assertGt(hook.pendingTokenFees(address(token)) - hookFeeBefore, 0);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        (uint256 collectedNative,) = locker.collectFees(0, 0);
        locker.routeCollectedNative(collectedNative);
        lockedLpNativeFee = feeRouter.launchAccount(address(token)).cumulativeLockedLpNativeFees;
    }

    function _accrueTokenLpFees(RobynV4BondingCurveMarket market, RobynLaunchToken token)
        internal
        returns (uint128 collectedTokenFees)
    {
        uint256 tokenBefore = token.balanceOf(address(this));
        market.buy{ value: 0.01 ether }(1);
        uint256 purchased = token.balanceOf(address(this)) - tokenBefore;
        uint256 sellAmount = purchased / 2;
        token.approve(address(market), sellAmount);
        market.sell(sellAmount, 1);
        (, uint256 collected) = market.graduationAdapter().locker().collectFees(0, 0);
        assertGt(collected, 0);
        collectedTokenFees = uint128(collected);
    }

    function _addThirdPartyFullRangeLiquidity(
        PoolKey memory key,
        RobynLaunchToken token,
        uint128 liquidity
    ) internal {
        IPoolModifyLiquidityFixture liquidityRouter =
            IPoolModifyLiquidityFixture(
                _deployPinned(
                    "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.default.json",
                    abi.encode(poolManager)
                )
            );
        (uint160 sqrtPriceX96,,,) = stateView.getSlot0(key.toId());
        uint160 lower = TickMath.getSqrtPriceAtTick(-887200);
        uint160 upper = TickMath.getSqrtPriceAtTick(887200);
        uint256 nativeAmount = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, upper, liquidity, true);
        uint256 tokenAmount = SqrtPriceMath.getAmount1Delta(lower, sqrtPriceX96, liquidity, true);
        require(token.balanceOf(address(this)) >= tokenAmount, "insufficient third-party token");
        token.approve(address(liquidityRouter), tokenAmount);
        liquidityRouter.modifyLiquidity{ value: nativeAmount }(
            key,
            ModifyLiquidityParams({
                tickLower: -887200,
                tickUpper: 887200,
                liquidityDelta: int256(uint256(liquidity)),
                salt: keccak256("third-party-full-range")
            }),
            bytes("")
        );
        assertEq(token.allowance(address(this), address(liquidityRouter)), 0);
    }

    function _deployPinned(string memory artifact, bytes memory constructorArgs)
        internal
        returns (address deployed)
    {
        bytes memory creationCode = vm.getCode(artifact);
        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        assembly {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0) && deployed.code.length != 0, "pinned deploy failed");
    }

    function _deployHook() internal returns (RobynV4FeeAndPhaseHook deployed) {
        uint160 flags = Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 deploymentDomain = keccak256("robyn-v4-native-protocol-test");
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(RobynV4FeeAndPhaseHook).creationCode,
            abi.encode(
                poolManager, feeRouter, address(this), address(positionManager), deploymentDomain
            )
        );
        deployed = new RobynV4FeeAndPhaseHook{ salt: salt }(
            poolManager, feeRouter, address(this), address(positionManager), deploymentDomain
        );
        assertEq(address(deployed), predicted);
    }

    function _seedBasketPool() internal {
        _seedAssetPool(basketAsset);
    }

    function _seedAssetPool(V4TestAsset asset) internal {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(asset)),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(key, uint160(1 << 96));
        IPoolModifyLiquidityFixture liquidityRouter = IPoolModifyLiquidityFixture(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.default.json",
                abi.encode(poolManager)
            )
        );
        asset.approve(address(liquidityRouter), type(uint256).max);
        uint128 liquidity = 10 ether;
        uint160 upper = TickMath.getSqrtPriceAtTick(600);
        uint256 nativeAmount =
            SqrtPriceMath.getAmount0Delta(uint160(1 << 96), upper, liquidity, true);
        liquidityRouter.modifyLiquidity{ value: nativeAmount }(
            key,
            ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );
        assetRouter.configureRoute(
            address(asset),
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
        assertTrue(assetRouter.routeStatus(address(asset)).ready);
    }

    function _request(bytes32 salt)
        internal
        view
        returns (RobynNativeLaunchFactoryV4.LaunchRequest memory request)
    {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        request = RobynNativeLaunchFactoryV4.LaunchRequest({
            name: "Robyn Native Test",
            symbol: "RNT",
            assets: assets,
            weights: weights,
            metadataUri: METADATA_URI,
            userSalt: salt
        });
    }
}
