// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RobynLaunchToken} from "../src/RobynLaunchToken.sol";
import {RobynDaoToken} from "../src/dao/RobynDaoToken.sol";
import {RobynNativeBasketVaultV2} from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import {RobynNativeLaunchDeployerV4} from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import {RobynNativeLaunchFactoryV4} from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import {RobynNativeProtocolFeeRouterV3} from "../src/uniswap/RobynNativeProtocolFeeRouterV3.sol";
import {RobynV4AssetRouter} from "../src/uniswap/RobynV4AssetRouter.sol";
import {RobynV4BondingCurveMarket} from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import {RobynV4FeePositionLocker} from "../src/uniswap/RobynV4FeePositionLocker.sol";
import {RobynV4LaunchCoordinatorV5} from "../src/uniswap/RobynV4LaunchCoordinatorV5.sol";
import {RobynV4MarketFactory} from "../src/uniswap/RobynV4MarketFactory.sol";
import {RobynV4OracleHook} from "../src/uniswap/RobynV4OracleHook.sol";

interface ITestPositionManager is IPositionManager {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IPoolModifyLiquidityFixture {
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes memory hookData)
        external
        payable
        returns (bytes32 delta);
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
    RobynV4OracleHook internal hook;
    RobynNativeLaunchFactoryV4 internal launchFactory;
    RobynNativeProtocolFeeRouterV3 internal feeRouter;
    RobynV4MarketFactory internal marketFactory;
    RobynV4LaunchCoordinatorV5 internal coordinator;
    RobynDaoToken internal daoToken;
    V4TestAsset internal basketAsset;

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address payable internal constant TREASURY = payable(address(0xBEEF));
    address internal constant GUARDIAN = address(0xCAFE);
    string internal constant METADATA_URI = "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q";

    receive() external payable {}

    function setUp() public {
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
        hook = _deployHook();
        basketAsset = new V4TestAsset();
        _seedBasketPool();

        RobynNativeLaunchDeployerV4 launchDeployer = new RobynNativeLaunchDeployerV4();
        launchFactory = new RobynNativeLaunchFactoryV4(assetRouter, launchDeployer, 1 wei, 1 hours);
        launchDeployer.bindController(address(launchFactory));

        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        daoToken = new RobynDaoToken(recipients, allocations);
        feeRouter = new RobynNativeProtocolFeeRouterV3(daoToken, assetRouter, TREASURY, GUARDIAN);

        RobynV4BondingCurveMarket.CurveConfig memory curve = RobynV4BondingCurveMarket.CurveConfig({
            curveTokenAllocation: 800_000_000 ether,
            graduationTokenAllocation: 200_000_000 ether,
            initialVirtualTokenReserve: 1_100_000_000 ether,
            initialVirtualNativeReserve: 0.5 ether,
            graduationThresholdNative: 1.4 ether,
            curveFeeBps: 100
        });
        marketFactory = new RobynV4MarketFactory(
            launchFactory,
            feeRouter,
            assetRouter,
            hook,
            poolManager,
            positionManager,
            permit2,
            stateView,
            curve,
            9_900,
            0.25 ether
        );
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

    function testOracleHookRejectsZeroInitializer() public {
        vm.expectRevert(RobynV4OracleHook.InvalidConfiguration.selector);
        new RobynV4OracleHook(poolManager, address(0));
    }

    function testCurveFeesConserveImmutableSplit() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(2))));
        uint256 treasuryBefore = TREASURY.balance;
        market.buy{value: 0.1 ether}(1);
        uint256 totalFee = feeRouter.launchAccount(address(token)).cumulativeNativeFees;
        assertEq(totalFee, 0.001 ether);
        assertEq(feeRouter.totalCreatorNativeLiability(), 0.00025 ether);
        assertEq(feeRouter.totalDaoNativeRewards(), 0.0002 ether);
        assertEq(feeRouter.totalTreasuryNative(), 0.00005 ether);
        assertEq(feeRouter.totalBasketNative(), 0.0005 ether);
        assertEq(TREASURY.balance - treasuryBefore, 0.00005 ether);
        assertEq(address(feeRouter).balance, feeRouter.totalCreatorNativeLiability());
    }

    function testGraduationLocksPrincipalAndPostGraduationTrades() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(3))));
        market.buy{value: 3 ether}(1);
        assertTrue(market.graduated());
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        uint128 principal = locker.principalLiquidity();
        assertGt(principal, 0);
        assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principal);
        assertEq(positionManager.ownerOf(locker.positionTokenId()), address(locker));
        assertTrue(assetRouter.routeStatus(address(token)).ready);

        uint256 tokenBefore = token.balanceOf(address(this));
        market.buy{value: 0.01 ether}(1);
        assertGt(token.balanceOf(address(this)), tokenBefore);
        uint128 sellAmount = uint128((token.balanceOf(address(this)) - tokenBefore) / 2);
        token.approve(address(market), sellAmount);
        uint256 nativeBefore = address(this).balance;
        market.sell(sellAmount, 1);
        assertGt(address(this).balance, nativeBefore);
        locker.collectFees(0, 0);
        assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principal);
    }

    function testLaunchFeeSaleRequiresFiveMinuteOracleHistory() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(31))));
        market.buy{value: 3 ether}(1);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        token.transfer(address(locker), 1 ether);

        vm.expectRevert(RobynV4OracleHook.InsufficientHistory.selector);
        locker.convertCollectedToken(1 ether, 1, block.timestamp);
    }

    function testBoundedLaunchFeeSaleRoutesNativeAfterFreshTwap() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(32))));
        market.buy{value: 3 ether}(1);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        vm.warp(block.timestamp + 5 minutes);
        market.buy{value: 0.000001 ether}(1);
        token.transfer(address(locker), 1 ether);
        uint256 feesBefore = feeRouter.launchAccount(address(token)).cumulativeNativeFees;

        uint256 nativeOut = locker.convertCollectedToken(1 ether, 1, block.timestamp);

        assertGt(nativeOut, 0);
        assertEq(feeRouter.launchAccount(address(token)).cumulativeLaunchFeesConverted, 1 ether);
        assertEq(feeRouter.launchAccount(address(token)).cumulativeNativeFees, feesBefore + nativeOut);
    }

    function testLaunchFeeSaleRejectsSpotTwapManipulation() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(33))));
        market.buy{value: 3 ether}(1);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        vm.warp(block.timestamp + 5 minutes);
        market.buy{value: 0.1 ether}(1);
        token.transfer(address(locker), 1 ether);

        vm.expectPartialRevert(RobynV4FeePositionLocker.SpotTwapDeviation.selector);
        locker.convertCollectedToken(1 ether, 1, block.timestamp);
    }

    function testLaunchFeeSaleRejectsStaleLatestObservation() public {
        (RobynLaunchToken token,, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(34))));
        market.buy{value: 3 ether}(1);
        RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
        vm.warp(block.timestamp + 5 minutes);
        market.buy{value: 0.000001 ether}(1);
        token.transfer(address(locker), 1 ether);
        vm.warp(block.timestamp + 15 minutes + 1);

        vm.expectPartialRevert(RobynV4FeePositionLocker.StaleObservation.selector);
        locker.convertCollectedToken(1 ether, 1, block.timestamp);
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

    function _deployPinned(string memory artifact, bytes memory constructorArgs) private returns (address deployed) {
        bytes memory creationCode = vm.getCode(artifact);
        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        assembly {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0) && deployed.code.length != 0, "pinned deploy failed");
    }

    function _deployHook() private returns (RobynV4OracleHook deployed) {
        uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG;
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this), flags, type(RobynV4OracleHook).creationCode, abi.encode(poolManager, address(this))
        );
        deployed = new RobynV4OracleHook{salt: salt}(poolManager, address(this));
        assertEq(address(deployed), predicted);
    }

    function _seedBasketPool() private {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(basketAsset)),
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
        basketAsset.approve(address(liquidityRouter), type(uint256).max);
        uint128 liquidity = 10 ether;
        uint160 upper = TickMath.getSqrtPriceAtTick(600);
        uint256 nativeAmount = SqrtPriceMath.getAmount0Delta(uint160(1 << 96), upper, liquidity, true);
        liquidityRouter.modifyLiquidity{value: nativeAmount}(
            key,
            ModifyLiquidityParams({
                tickLower: -600, tickUpper: 600, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)
            }),
            bytes("")
        );
        assetRouter.configureRoute(
            address(basketAsset),
            RobynV4AssetRouter.Route({
                fee: 3_000,
                tickSpacing: 60,
                hooks: IHooks(address(0)),
                minimumLiquidity: 1,
                maximumNativeInput: 0.25 ether,
                verificationClass: keccak256("TEST_BASKET_ASSET"),
                enabled: true
            })
        );
        assertTrue(assetRouter.routeStatus(address(basketAsset)).ready);
    }

    function _request(bytes32 salt) private view returns (RobynNativeLaunchFactoryV4.LaunchRequest memory request) {
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
