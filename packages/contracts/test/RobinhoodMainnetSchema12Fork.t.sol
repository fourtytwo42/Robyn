// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
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
import { IWrappedNative } from "../src/uniswap/RobynV4AssetRouter.sol";
import { RobynV4AdapterDeployer } from "../src/uniswap/RobynV4AdapterDeployer.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4FeePositionLocker } from "../src/uniswap/RobynV4FeePositionLocker.sol";
import { RobynV4LaunchCoordinatorV5 } from "../src/uniswap/RobynV4LaunchCoordinatorV5.sol";
import { RobynV4LockerDeployer } from "../src/uniswap/RobynV4LockerDeployer.sol";
import { RobynV4MarketDeployer } from "../src/uniswap/RobynV4MarketDeployer.sol";
import { RobynV4MarketFactory } from "../src/uniswap/RobynV4MarketFactory.sol";
import { RobynV4FeeAndPhaseHook } from "../src/uniswap/RobynV4FeeAndPhaseHook.sol";
import { ITestPositionManager } from "./RobynV4NativeProtocol.t.sol";

/// @notice No-broadcast security-remediated rehearsal on a Robinhood mainnet fork.
/// @dev Uses canonical chain-4663 v4 contracts and rejects synthetic production routes.
contract RobinhoodMainnetSchema12ForkTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager private constant POOL_MANAGER =
        IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    ITestPositionManager private constant POSITION_MANAGER =
        ITestPositionManager(0x58daec3116aae6D93017bAAea7749052E8a04fA7);
    IV4Quoter private constant QUOTER = IV4Quoter(0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94);
    IStateView private constant STATE_VIEW = IStateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b);
    IAllowanceTransfer private constant PERMIT2 =
        IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address private constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address private constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address private constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address private constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    address private constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    IWrappedNative private constant WETH =
        IWrappedNative(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    address payable private treasury;
    address private guardian;
    string private constant METADATA_URI =
        "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q";

    RobynV4AssetRouter private assetRouter;
    RobynV4FeeAndPhaseHook private hook;
    RobynNativeProtocolFeeRouterV4 private feeRouter;
    RobynV4LaunchCoordinatorV5 private coordinator;
    RobynDaoToken private daoToken;

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
        treasury = payable(vm.envAddress("ROBYN_MAINNET_TREASURY"));
        guardian = vm.envAddress("ROBYN_MAINNET_GUARDIAN");
        require(treasury != address(0) && guardian != address(0), "production roles required");
        require(treasury != address(0xBEEF) && guardian != address(0xCAFE), "placeholder roles");
        vm.deal(address(this), 100 ether);
        _deployProductionProtocol();
        _exerciseRequiredCoreRoutes();

        uint256 treasuryBefore = treasury.balance;
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

        for (uint256 index; index < 3; ++index) {
            RobynNativeBasketVaultV2.BasketLeg memory leg = vault.leg(index);
            assertGt(leg.pendingNative, 0);
            RobynV4AssetRouter.RouteStatus memory status =
                assetRouter.routeStatus(address(leg.asset));
            uint256 amount = leg.pendingNative > status.maximumNativeInput
                ? status.maximumNativeInput
                : leg.pendingNative;
            (uint256 basketQuote,) =
                assetRouter.quoteNativeToAsset(address(leg.asset), uint128(amount));
            vault.convertLeg(index, amount, (basketQuote * 99) / 100, block.timestamp);
        }
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
        assertGt(treasury.balance, treasuryBefore);
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
        assertGt(GOOGL.code.length, 0);
        assertEq(IERC20Metadata(GOOGL).decimals(), 18);
        assertEq(keccak256(bytes(IERC20Metadata(GOOGL).symbol())), keccak256(bytes("GOOGL")));
        assertEq(keccak256(bytes(IERC20Metadata(MSFT).symbol())), keccak256(bytes("MSFT")));
        assertEq(keccak256(bytes(IERC20Metadata(NVDA).symbol())), keccak256(bytes("NVDA")));
        assertEq(keccak256(bytes(IERC20Metadata(SPCX).symbol())), keccak256(bytes("SPCX")));
        assertEq(keccak256(bytes(IERC20Metadata(SPY).symbol())), keccak256(bytes("SPY")));
    }

    function _deployProductionProtocol() private {
        assetRouter =
            new RobynV4AssetRouter(POOL_MANAGER, QUOTER, STATE_VIEW, address(this), guardian, WETH);
        _configureRequiredCoreRoutes();
        assetRouter.configureWrappedNativeRoute(
            0.5 ether, keccak256("ROBINHOOD_MAINNET_DIRECT_WETH"), true
        );

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
        feeRouter = new RobynNativeProtocolFeeRouterV4(daoToken, assetRouter, treasury, guardian);
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
                stateView: STATE_VIEW,
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
        exclusions[0] = treasury;
        daoToken.sealRewardExclusions(exclusions);
        daoToken.bindRewardDepositor(address(feeRouter));
    }

    function _configureRequiredCoreRoutes() private {
        _configureProductionStockRoute(GOOGL, 0.5 ether);
        _configureProductionStockRoute(MSFT, 0.5 ether);
        _configureProductionStockRoute(NVDA, 0.5 ether);
        _configureProductionStockRoute(SPCX, 0.5 ether);
        _configureProductionStockRoute(SPY, 0.1 ether);
    }

    function _configureProductionStockRoute(address asset, uint128 maximumNativeInput) private {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(asset),
            fee: 10_000,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
        (uint160 sqrtPriceX96, int24 tick,,) = STATE_VIEW.getSlot0(key.toId());
        require(
            sqrtPriceX96 != 0 && STATE_VIEW.getLiquidity(key.toId()) != 0,
            "GOOGL production route unavailable"
        );
        assetRouter.configureRoute(
            asset,
            RobynV4AssetRouter.Route({
                fee: 10_000,
                tickSpacing: 200,
                hooks: IHooks(address(0)),
                minimumLiquidity: 1,
                maximumNativeInput: maximumNativeInput,
                referenceTick: tick,
                maximumReferenceTickDeviation: 198,
                enforceReferencePrice: true,
                verificationClass: keccak256("ROBINHOOD_MAINNET_STOCK_TOKEN"),
                enabled: true
            })
        );
        assertTrue(assetRouter.routeStatus(asset).ready);
    }

    function _exerciseRequiredCoreRoutes() private {
        address[5] memory stocks = [GOOGL, MSFT, NVDA, SPCX, SPY];
        for (uint256 index; index < stocks.length; ++index) {
            address asset = stocks[index];
            uint128 nativeInput = 0.000001 ether;
            (uint256 quoted,) = assetRouter.quoteNativeToAsset(asset, nativeInput);
            uint256 before = IERC20Metadata(asset).balanceOf(address(this));
            uint256 received = assetRouter.swapExactNativeForAsset{ value: nativeInput }(
                asset, (quoted * 99) / 100, address(this), block.timestamp
            );
            assertEq(IERC20Metadata(asset).balanceOf(address(this)) - before, received);
            uint128 sellAmount = uint128(received / 2);
            IERC20Metadata(asset).approve(address(assetRouter), sellAmount);
            (uint256 nativeQuote,) = assetRouter.quoteAssetToNative(asset, sellAmount);
            assertGt(
                assetRouter.swapExactAssetForNative(
                    asset,
                    sellAmount,
                    (nativeQuote * 99) / 100,
                    payable(address(this)),
                    block.timestamp
                ),
                0
            );
        }
        uint256 wrapped = assetRouter.swapExactNativeForAsset{ value: 0.000001 ether }(
            address(WETH), 0.000001 ether, address(this), block.timestamp
        );
        WETH.approve(address(assetRouter), wrapped);
        assertEq(
            assetRouter.swapExactAssetForNative(
                address(WETH), uint128(wrapped), wrapped, payable(address(this)), block.timestamp
            ),
            wrapped
        );
    }

    function _deployHook() private returns (RobynV4FeeAndPhaseHook deployed) {
        uint160 flags = Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 domain = keccak256("sherwood-schema12-mainnet-fork");
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
        address[] memory assets = new address[](3);
        assets[0] = GOOGL;
        assets[1] = MSFT;
        assets[2] = NVDA;
        uint16[] memory weights = new uint16[](3);
        weights[0] = 3_334;
        weights[1] = 3_333;
        weights[2] = 3_333;
        request = RobynNativeLaunchFactoryV4.LaunchRequest({
            name: "Sherwood Mainnet Fork",
            symbol: "SMF",
            assets: assets,
            weights: weights,
            metadataUri: METADATA_URI,
            userSalt: salt,
            expectedGraduationProfileVersion: 1
        });
    }
}
