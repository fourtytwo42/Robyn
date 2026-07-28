// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
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
import {
    IPoolModifyLiquidityFixture,
    ITestPositionManager,
    V4TestAsset
} from "./RobynV4NativeProtocol.t.sol";

/// @notice No-broadcast security-remediated rehearsal on a Robinhood mainnet fork.
/// @dev Uses canonical chain-4663 v4 contracts and the current production AAPL Stock Token.
contract RobinhoodMainnetSchema9ForkTest is Test {
    IPoolManager private constant POOL_MANAGER =
        IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    ITestPositionManager private constant POSITION_MANAGER =
        ITestPositionManager(0x58daec3116aae6D93017bAAea7749052E8a04fA7);
    IV4Quoter private constant QUOTER = IV4Quoter(0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94);
    IAllowanceTransfer private constant PERMIT2 =
        IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address private constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address payable private constant TREASURY = payable(address(0xBEEF));
    address private constant GUARDIAN = address(0xCAFE);
    string private constant METADATA_URI =
        "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q";

    RobynV4AssetRouter private assetRouter;
    RobynV4FeeAndPhaseHook private hook;
    RobynNativeProtocolFeeRouterV4 private feeRouter;
    RobynV4LaunchCoordinatorV5 private coordinator;
    RobynDaoToken private daoToken;
    IStateView private stateView;

    receive() external payable { }

    function testRemediatedProductionLifecycleOnRobinhoodMainnetFork() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpcUrl);
        assertEq(block.chainid, 4663);
        _verifyCanonicalVenueAndStock();
        vm.deal(address(this), 100 ether);
        _deployProductionProtocol();

        uint256 treasuryBefore = TREASURY.balance;
        (RobynLaunchToken token, RobynNativeBasketVaultV2 vault, RobynV4BondingCurveMarket market) =
            coordinator.createLaunch{ value: 0.5 ether }(_request(bytes32(uint256(4663))));
        assertEq(market.maximumCurvePurchase(), 0.5 ether);
        assertGt(token.balanceOf(address(this)), 0);

        {
            for (uint256 purchase; purchase < 20 && !market.graduated(); ++purchase) {
                market.buy{ value: 0.5 ether }(1);
            }
            assertTrue(market.graduated());
            RobynV4FeePositionLocker locker = market.graduationAdapter().locker();
            uint128 lockedPrincipal = locker.principalLiquidity();
            assertLe(locker.principalNativeResidual(), 1 gwei);
            assertLe(locker.principalTokenResidual(), 0.000001 ether);

            uint256 pendingTokenBefore = hook.pendingTokenFees(address(token));
            market.buy{ value: 0.01 ether }(1);
            assertGt(hook.pendingTokenFees(address(token)), pendingTokenBefore);
            uint256 sellAmount = token.balanceOf(address(this)) / 50;
            token.approve(address(market), sellAmount);
            market.sell(sellAmount, 1);
            uint256 pendingNative = hook.pendingNativeFees(address(token));
            assertGt(pendingNative, 0);
            hook.settleNativeFees(token, pendingNative);

            vm.warp(block.timestamp + 5 minutes);
            market.buy{ value: 0.000001 ether }(1);
            uint128 pendingToken = uint128(hook.pendingTokenFees(address(token)));
            (uint256 tokenFeeQuote,) = assetRouter.quoteAssetToNative(address(token), pendingToken);
            hook.convertTokenFees(token, pendingToken, (tokenFeeQuote * 99) / 100, block.timestamp);

            (uint256 collectedNative, uint256 collectedToken) = locker.collectFees(0, 0);
            if (collectedNative != 0) locker.routeCollectedNative(collectedNative);
            if (collectedToken != 0) {
                (uint256 lockerQuote,) =
                    assetRouter.quoteAssetToNative(address(token), uint128(collectedToken));
                locker.convertCollectedToken(
                    uint128(collectedToken), (lockerQuote * 99) / 100, block.timestamp
                );
            }
            assertEq(
                POSITION_MANAGER.getPositionLiquidity(locker.positionTokenId()), lockedPrincipal
            );
        }

        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(address(token));
        feeRouter.settleBasketFees(address(token), account.pendingBasketNative);
        feeRouter.settleDaoFees(feeRouter.totalDaoNativeLiability());
        feeRouter.settleTreasuryFees(feeRouter.totalTreasuryNativeLiability());

        uint256 pendingBasket = vault.totalPendingNative();
        assertGt(pendingBasket, 0);
        (uint256 basketQuote,) = assetRouter.quoteNativeToAsset(AAPL, uint128(pendingBasket));
        vault.convertLeg(0, pendingBasket, (basketQuote * 99) / 100, block.timestamp);
        vm.warp(block.timestamp + 1 hours);
        assertGt(token.claimAll(), 0);

        account = feeRouter.launchAccount(address(token));
        assertEq(
            feeRouter.totalBasketNative() + account.cumulativeCreatorNative
                + feeRouter.totalDaoNativeRewards() + feeRouter.totalTreasuryNative(),
            account.cumulativeNativeFees
        );
        assertGt(account.claimableCreatorNative, 0);
        feeRouter.claimCreatorFees(address(token));
        assertGt(daoToken.claimRewards(), 0);
        assertGt(TREASURY.balance, treasuryBefore);
    }

    function _verifyCanonicalVenueAndStock() private view {
        assertEq(
            keccak256(address(POOL_MANAGER).code),
            0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626
        );
        assertEq(
            keccak256(address(POSITION_MANAGER).code),
            0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2
        );
        assertEq(
            keccak256(address(QUOTER).code),
            0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6
        );
        assertGt(AAPL.code.length, 0);
        assertEq(IERC20Metadata(AAPL).decimals(), 18);
        assertEq(keccak256(bytes(IERC20Metadata(AAPL).symbol())), keccak256(bytes("AAPL")));
    }

    function _deployProductionProtocol() private {
        stateView = IStateView(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/StateView.sol/StateView.json",
                abi.encode(POOL_MANAGER)
            )
        );
        assetRouter = new RobynV4AssetRouter(POOL_MANAGER, QUOTER, stateView, address(this));
        V4TestAsset stock = V4TestAsset(AAPL);
        deal(AAPL, address(this), 10_000_000 ether, true);
        _seedStockPool(stock);

        RobynNativeLaunchDeployerV4 launchDeployer = new RobynNativeLaunchDeployerV4();
        RobynNativeVaultDeployerV4 vaultDeployer = new RobynNativeVaultDeployerV4();
        RobynNativeLaunchFactoryV4 launchFactory = new RobynNativeLaunchFactoryV4(
            assetRouter, launchDeployer, vaultDeployer, 1 wei, 1 days
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
            initialVirtualNativeReserve: 2 ether,
            graduationThresholdNative: 6 ether + 1,
            maximumCurvePurchase: 0.5 ether,
            curveFeeBps: 100
        });
        RobynV4AdapterDeployer adapterDeployer = new RobynV4AdapterDeployer();
        RobynV4LockerDeployer lockerDeployer = new RobynV4LockerDeployer();
        RobynV4MarketDeployer marketDeployer = new RobynV4MarketDeployer();
        RobynV4MarketFactory marketFactory = new RobynV4MarketFactory(
            RobynV4MarketFactory.Dependencies({
                launchFactory: launchFactory,
                feeRouter: feeRouter,
                assetRouter: assetRouter,
                oracleHook: hook,
                poolManager: POOL_MANAGER,
                positionManager: POSITION_MANAGER,
                permit2: PERMIT2,
                stateView: stateView,
                adapterDeployer: adapterDeployer,
                lockerDeployer: lockerDeployer,
                marketDeployer: marketDeployer,
                tokenSink: address(new RobynTokenSink())
            }),
            curve,
            9_900,
            0.5 ether,
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

    function _seedStockPool(V4TestAsset stock) private {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(AAPL),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        POOL_MANAGER.initialize(key, uint160(1 << 96));
        IPoolModifyLiquidityFixture liquidityRouter = IPoolModifyLiquidityFixture(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.default.json",
                abi.encode(POOL_MANAGER)
            )
        );
        stock.approve(address(liquidityRouter), type(uint256).max);
        uint128 liquidity = 100 ether;
        uint160 upper = TickMath.getSqrtPriceAtTick(600);
        uint256 nativeAmount =
            SqrtPriceMath.getAmount0Delta(uint160(1 << 96), upper, liquidity, true);
        liquidityRouter.modifyLiquidity{ value: nativeAmount }(
            key,
            ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: int256(uint256(liquidity)),
                salt: keccak256("sherwood-mainnet-fork-stock-route")
            }),
            bytes("")
        );
        assetRouter.configureRoute(
            AAPL,
            RobynV4AssetRouter.Route({
                fee: 3_000,
                tickSpacing: 60,
                hooks: IHooks(address(0)),
                minimumLiquidity: 1,
                maximumNativeInput: 0.5 ether,
                referenceTick: 0,
                maximumReferenceTickDeviation: 198,
                enforceReferencePrice: true,
                verificationClass: keccak256("ROBINHOOD_MAINNET_STOCK_TOKEN"),
                enabled: true
            })
        );
        assertTrue(assetRouter.routeStatus(AAPL).ready);
    }

    function _deployHook() private returns (RobynV4FeeAndPhaseHook deployed) {
        uint160 flags = Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 domain = keccak256("sherwood-schema9-mainnet-fork");
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(RobynV4FeeAndPhaseHook).creationCode,
            abi.encode(POOL_MANAGER, feeRouter, address(this), POSITION_MANAGER, domain)
        );
        deployed = new RobynV4FeeAndPhaseHook{ salt: salt }(
            POOL_MANAGER, feeRouter, address(this), address(POSITION_MANAGER), domain
        );
        assertEq(address(deployed), predicted);
    }

    function _request(bytes32 salt)
        private
        pure
        returns (RobynNativeLaunchFactoryV4.LaunchRequest memory request)
    {
        address[] memory assets = new address[](1);
        assets[0] = AAPL;
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        request = RobynNativeLaunchFactoryV4.LaunchRequest({
            name: "Sherwood Mainnet Fork",
            symbol: "SMF",
            assets: assets,
            weights: weights,
            metadataUri: METADATA_URI,
            userSalt: salt
        });
    }

    function _deployPinned(string memory artifact, bytes memory constructorArgs)
        private
        returns (address deployed)
    {
        bytes memory creationCode = vm.getCode(artifact);
        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        assembly {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0) && deployed.code.length != 0, "pinned deploy failed");
    }
}
