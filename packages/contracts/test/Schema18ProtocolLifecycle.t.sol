// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RobynV4NativeProtocolTest} from "./RobynV4NativeProtocol.t.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {RobynLaunchToken} from "../src/RobynLaunchToken.sol";
import {RobynTokenSink} from "../src/RobynTokenSink.sol";
import {RobynBootstrapTimelock} from "../src/dao/RobynBootstrapTimelock.sol";
import {RobynDaoTokenV3} from "../src/dao/RobynDaoTokenV3.sol";
import {RobynGovernorV2} from "../src/dao/RobynGovernorV2.sol";
import {RobynNativeBasketVaultV2} from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import {RobynNativeLaunchDeployerV4} from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import {RobynNativeLaunchFactoryV4} from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import {RobynNativeVaultDeployerV4} from "../src/uniswap/RobynNativeVaultDeployerV4.sol";
import {RobynNativeProtocolFeeRouterV4} from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import {RobynV4AssetRouter, IWrappedNative} from "../src/uniswap/RobynV4AssetRouter.sol";
import {RobynV4AdapterDeployer} from "../src/uniswap/RobynV4AdapterDeployer.sol";
import {RobynV4BondingCurveMarket} from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import {RobynV4LaunchCoordinatorV6} from "../src/uniswap/RobynV4LaunchCoordinatorV6.sol";
import {RobynV4LockerDeployer} from "../src/uniswap/RobynV4LockerDeployer.sol";
import {RobynV4MarketDeployer} from "../src/uniswap/RobynV4MarketDeployer.sol";
import {RobynV4MarketFactory} from "../src/uniswap/RobynV4MarketFactory.sol";

contract Schema18ProtocolLifecycleTest is RobynV4NativeProtocolTest {
    RobynBootstrapTimelock private bootstrapTimelock;
    RobynGovernorV2 private schema18Governor;
    RobynNativeLaunchDeployerV4 private schema18LaunchDeployer;
    RobynNativeVaultDeployerV4 private schema18VaultDeployer;
    RobynV4AdapterDeployer private schema18AdapterDeployer;
    RobynV4LockerDeployer private schema18LockerDeployer;
    RobynV4MarketDeployer private schema18MarketDeployer;

    function setUp() public override {
        super.setUp();
    }

    function testTwoStepBootstrapCanaryToPublicLifecycle() external {
        _deploySchema18Protocol();
        assertEq(uint256(coordinator.launchMode()), uint256(RobynV4LaunchCoordinatorV6.LaunchMode.Paused));
        assertTrue(assetRouter.conversionsPaused());
        assertTrue(feeRouter.paused());
        assertTrue(bootstrapTimelock.bootstrapActive());
        assertEq(schema18Governor.votingDelay(), 1 hours);
        assertEq(schema18Governor.votingPeriod(), 4 hours);
        assertEq(bootstrapTimelock.getMinDelay(), 1 hours);

        (address[] memory firstTargets, uint256[] memory firstValues, bytes[] memory firstData) = _bootstrapStepOne();
        bootstrapTimelock.executeBootstrapStep(0, firstTargets, firstValues, firstData);
        assertEq(uint256(coordinator.launchMode()), uint256(RobynV4LaunchCoordinatorV6.LaunchMode.Canary));
        assertFalse(assetRouter.conversionsPaused());
        assertFalse(feeRouter.paused());
        assertTrue(assetRouter.executionRouteStatus(address(basketAsset)).ready);
        assertTrue(assetRouter.executionRouteStatus(address(testWrappedNative)).ready);

        RobynNativeLaunchFactoryV4.LaunchRequest memory request = _request(keccak256("schema18-canary"));
        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch{value: 0.001 ether}(request);
        vault;
        for (uint256 purchase; purchase < 20 && !market.graduated(); ++purchase) {
            market.buy{value: 0.001 ether}(1);
        }
        assertTrue(market.graduated());
        assertEq(market.maximumCurvePurchase(), 0.001 ether);
        assertEq(market.graduationThresholdNative(), 0.01 ether);
        RobynV4MarketFactory.GraduationProfile memory canaryProfile =
            marketFactory.graduationProfileByToken(address(token));

        (address[] memory secondTargets, uint256[] memory secondValues, bytes[] memory secondData) = _bootstrapStepTwo();
        bootstrapTimelock.executeBootstrapStep(1, secondTargets, secondValues, secondData);
        assertTrue(bootstrapTimelock.bootstrapFinalized());
        assertEq(bootstrapTimelock.bootstrapFinalizationReason(), bootstrapTimelock.REASON_PLAN_COMPLETE());
        assertEq(uint256(coordinator.launchMode()), uint256(RobynV4LaunchCoordinatorV6.LaunchMode.Public));
        assertEq(marketFactory.graduationProfileVersion(), 2);
        assertEq(marketFactory.currentGraduationProfile().targetGraduationNative, 6 ether);
        assertEq(marketFactory.currentGraduationProfile().maximumCurvePurchase, 0.5 ether);
        assertEq(
            marketFactory.graduationProfileByToken(address(token)).targetGraduationNative,
            canaryProfile.targetGraduationNative
        );
        assertFalse(bootstrapTimelock.bootstrapActive());
    }

    function testGuardianAbortLeavesCorePaused() external {
        _deploySchema18Protocol();
        vm.prank(GUARDIAN);
        bootstrapTimelock.abortBootstrap();
        assertTrue(bootstrapTimelock.bootstrapFinalized());
        assertEq(uint256(coordinator.launchMode()), uint256(RobynV4LaunchCoordinatorV6.LaunchMode.Paused));
        assertTrue(assetRouter.conversionsPaused());
        assertTrue(feeRouter.paused());
    }

    function _deploySchema18Protocol() private {
        uint64 startingNonce = vm.getNonce(address(this));
        address predictedTimelock = vm.computeCreateAddress(address(this), startingNonce + 13);
        RobynDaoTokenV3 schema18Token = _deploySchema18Core(predictedTimelock);
        assertEq(vm.getNonce(address(this)), startingNonce + 13);
        bytes32 domain = keccak256("SCHEMA17_PROTOCOL_LIFECYCLE");
        bytes32[2] memory planHashes = _bootstrapPlanHashes(domain);
        bootstrapTimelock = new RobynBootstrapTimelock(schema18Token, address(this), GUARDIAN, domain, planHashes);
        assertEq(address(bootstrapTimelock), predictedTimelock);
        schema18Governor = new RobynGovernorV2(schema18Token, bootstrapTimelock);
        schema18Token.bindBootstrapController(address(bootstrapTimelock));
        _bindSchema18Core(schema18Token);
    }

    function _deploySchema18Core(address predictedTimelock) private returns (RobynDaoTokenV3 schema18Token) {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        schema18Token = new RobynDaoTokenV3(recipients, allocations, 1 hours, address(this));
        daoToken = schema18Token;
        assetRouter = new RobynV4AssetRouter(
            poolManager, quoter, stateView, predictedTimelock, GUARDIAN, IWrappedNative(address(testWrappedNative))
        );
        schema18LaunchDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        schema18VaultDeployer = new RobynNativeVaultDeployerV4();
        launchFactory =
            new RobynNativeLaunchFactoryV4(assetRouter, schema18LaunchDeployer, schema18VaultDeployer, 1 wei, 1 days);
        feeRouter =
            new RobynNativeProtocolFeeRouterV4(daoToken, assetRouter, payable(predictedTimelock), GUARDIAN, 1 hours);
        RobynTokenSink tokenSink = new RobynTokenSink();
        hook = _deployHook();
        schema18AdapterDeployer = new RobynV4AdapterDeployer();
        schema18LockerDeployer = new RobynV4LockerDeployer();
        schema18MarketDeployer = new RobynV4MarketDeployer();
        RobynV4BondingCurveMarket.CurveConfig memory curve = RobynV4BondingCurveMarket.CurveConfig({
            curveTokenAllocation: 800_000_000 ether,
            graduationTokenAllocation: 200_000_000 ether,
            initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666,
            initialVirtualNativeReserve: 2 ether,
            graduationThresholdNative: 0.01 ether,
            maximumCurvePurchase: 0.001 ether,
            curveFeeBps: 100
        });
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
                adapterDeployer: schema18AdapterDeployer,
                lockerDeployer: schema18LockerDeployer,
                marketDeployer: schema18MarketDeployer,
                tokenSink: address(tokenSink)
            }),
            curve,
            9_900,
            0.0005 ether,
            1 gwei,
            0.000001 ether
        );
        coordinator =
            new RobynV4LaunchCoordinatorV6(launchFactory, marketFactory, feeRouter, predictedTimelock, GUARDIAN);
    }

    function _bootstrapPlanHashes(bytes32 domain) private view returns (bytes32[2] memory hashes) {
        (address[] memory firstTargets, uint256[] memory firstValues, bytes[] memory firstData) = _bootstrapStepOne();
        (address[] memory secondTargets, uint256[] memory secondValues, bytes[] memory secondData) = _bootstrapStepTwo();
        hashes = [
            keccak256(abi.encode(block.chainid, domain, uint8(0), firstTargets, firstValues, firstData)),
            keccak256(abi.encode(block.chainid, domain, uint8(1), secondTargets, secondValues, secondData))
        ];
    }

    function _bindSchema18Core(RobynDaoTokenV3 schema18Token) private {
        schema18LaunchDeployer.bindController(address(launchFactory));
        schema18VaultDeployer.bindController(address(launchFactory));
        schema18AdapterDeployer.bindController(address(marketFactory));
        schema18LockerDeployer.bindController(address(marketFactory));
        schema18MarketDeployer.bindController(address(marketFactory));
        hook.bindRegistrar(address(marketFactory));
        assetRouter.bindLaunchRegistrar(address(marketFactory));
        launchFactory.bindCoordinator(address(coordinator));
        marketFactory.bindCoordinator(address(coordinator));
        feeRouter.bindCoordinator(address(coordinator));
        address[] memory exclusions = new address[](4);
        exclusions[0] = address(bootstrapTimelock);
        exclusions[1] = address(schema18Governor);
        exclusions[2] = address(feeRouter);
        exclusions[3] = address(coordinator);
        schema18Token.sealRewardExclusions(exclusions);
        schema18Token.bindRewardDepositor(address(feeRouter));
        schema18Token.delegate(address(this));
        bootstrapTimelock.grantRole(bootstrapTimelock.PROPOSER_ROLE(), address(schema18Governor));
        bootstrapTimelock.grantRole(bootstrapTimelock.CANCELLER_ROLE(), GUARDIAN);
        bootstrapTimelock.grantRole(bootstrapTimelock.EXECUTOR_ROLE(), address(0));
        bootstrapTimelock.renounceRole(bootstrapTimelock.DEFAULT_ADMIN_ROLE(), address(this));
        vm.prank(GUARDIAN);
        assetRouter.pauseConversions();
        vm.prank(GUARDIAN);
        feeRouter.setPaused(true);
    }

    function _bootstrapStepOne()
        private
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory payloads)
    {
        targets = new address[](5);
        values = new uint256[](5);
        payloads = new bytes[](5);
        targets[0] = address(assetRouter);
        payloads[0] = abi.encodeCall(RobynV4AssetRouter.resumeConversions, ());
        targets[1] = address(feeRouter);
        payloads[1] = abi.encodeCall(RobynNativeProtocolFeeRouterV4.setPaused, (false));
        targets[2] = address(assetRouter);
        payloads[2] = abi.encodeCall(
            RobynV4AssetRouter.configureRoute,
            (
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
                    verificationClass: keccak256("SCHEMA17_TEST_ASSET"),
                    enabled: true
                })
            )
        );
        targets[3] = address(assetRouter);
        payloads[3] = abi.encodeCall(RobynV4AssetRouter.configureWrappedNativeRoute, (0.5 ether, true));
        targets[4] = address(coordinator);
        payloads[4] = abi.encodeCall(RobynV4LaunchCoordinatorV6.setCanaryMode, (address(this)));
    }

    function _bootstrapStepTwo()
        private
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory payloads)
    {
        targets = new address[](4);
        values = new uint256[](4);
        payloads = new bytes[](4);
        targets[0] = address(marketFactory);
        payloads[0] = abi.encodeCall(RobynV4MarketFactory.setGraduationProfile, (6 ether, 0.5 ether));
        targets[1] = address(assetRouter);
        payloads[1] = abi.encodeCall(
            RobynV4AssetRouter.configureRoute,
            (
                address(basketAsset),
                RobynV4AssetRouter.Route({
                    fee: 3_000,
                    tickSpacing: 60,
                    hooks: IHooks(address(0)),
                    minimumLiquidity: 1,
                    maximumNativeInput: 0.025 ether,
                    referenceTick: 0,
                    maximumReferenceTickDeviation: 198,
                    enforceReferencePrice: true,
                    verificationClass: keccak256("SCHEMA17_TEST_ASSET"),
                    enabled: true
                })
            )
        );
        targets[2] = address(assetRouter);
        payloads[2] = abi.encodeCall(RobynV4AssetRouter.configureWrappedNativeRoute, (0.05 ether, true));
        targets[3] = address(coordinator);
        payloads[3] = abi.encodeCall(RobynV4LaunchCoordinatorV6.setPublicMode, ());
    }
}
