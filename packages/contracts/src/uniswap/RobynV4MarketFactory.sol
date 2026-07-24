// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RobynLaunchToken} from "../RobynLaunchToken.sol";
import {RobynNativeBasketVaultV2} from "./RobynNativeBasketVaultV2.sol";
import {RobynNativeLaunchFactoryV4} from "./RobynNativeLaunchFactoryV4.sol";
import {RobynNativeProtocolFeeRouterV3} from "./RobynNativeProtocolFeeRouterV3.sol";
import {RobynV4AssetRouter} from "./RobynV4AssetRouter.sol";
import {RobynV4AdapterDeployer} from "./RobynV4AdapterDeployer.sol";
import {RobynV4BondingCurveMarket} from "./RobynV4BondingCurveMarket.sol";
import {IPositionManagerPermit2, RobynV4FeePositionLocker} from "./RobynV4FeePositionLocker.sol";
import {RobynV4GraduationAdapter} from "./RobynV4GraduationAdapter.sol";
import {RobynV4LockerDeployer} from "./RobynV4LockerDeployer.sol";
import {RobynV4MarketDeployer} from "./RobynV4MarketDeployer.sol";
import {RobynV4OracleHook} from "./RobynV4OracleHook.sol";

/// @notice Coordinator-only factory that preinitializes native-ETH v4 pools atomically.
contract RobynV4MarketFactory {
    using PoolIdLibrary for PoolKey;

    string public constant CONTRACT_VERSION = "1.0.0";
    uint24 public constant POOL_FEE_PIPS = 10_000;
    int24 public constant TICK_SPACING = 200;

    error InvalidConfiguration();
    error Unauthorized();
    error CoordinatorNotBound();
    error CoordinatorAlreadyBound();
    error MarketAlreadyExists();
    error PoolInitializationMismatch();

    RobynNativeLaunchFactoryV4 public immutable launchFactory;
    RobynNativeProtocolFeeRouterV3 public immutable feeRouter;
    RobynV4AssetRouter public immutable assetRouter;
    RobynV4OracleHook public immutable oracleHook;
    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    IStateView public immutable stateView;
    RobynV4AdapterDeployer public immutable adapterDeployer;
    RobynV4LockerDeployer public immutable lockerDeployer;
    RobynV4MarketDeployer public immutable marketDeployer;
    address public immutable initializer;
    address public coordinator;

    uint256 public immutable curveTokenAllocation;
    uint256 public immutable graduationTokenAllocation;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualNativeReserve;
    uint256 public immutable graduationThresholdNative;
    uint16 public immutable curveFeeBps;
    uint16 public immutable minimumUseBps;
    uint128 public immutable maximumNativeSwap;
    uint160 public immutable terminalSqrtPriceX96;
    uint256 public immutable terminalNativePerTokenX18;

    mapping(address token => address market) public marketByToken;
    mapping(address token => address adapter) public adapterByToken;
    mapping(address token => bytes32 poolId) public poolIdByToken;

    event CoordinatorBound(address indexed coordinator);
    event MarketCreated(
        address indexed creator,
        address indexed token,
        address indexed market,
        address adapter,
        bytes32 poolId,
        address locker,
        uint160 initialSqrtPriceX96
    );

    struct Dependencies {
        RobynNativeLaunchFactoryV4 launchFactory;
        RobynNativeProtocolFeeRouterV3 feeRouter;
        RobynV4AssetRouter assetRouter;
        RobynV4OracleHook oracleHook;
        IPoolManager poolManager;
        IPositionManager positionManager;
        IAllowanceTransfer permit2;
        IStateView stateView;
        RobynV4AdapterDeployer adapterDeployer;
        RobynV4LockerDeployer lockerDeployer;
        RobynV4MarketDeployer marketDeployer;
    }

    constructor(
        Dependencies memory dependencies,
        RobynV4BondingCurveMarket.CurveConfig memory curve_,
        uint16 minimumUseBps_,
        uint128 maximumNativeSwap_
    ) {
        if (
            address(dependencies.launchFactory) == address(0) || address(dependencies.feeRouter) == address(0)
                || address(dependencies.assetRouter) == address(0) || address(dependencies.oracleHook) == address(0)
                || address(dependencies.poolManager) == address(0)
                || address(dependencies.positionManager) == address(0) || address(dependencies.permit2) == address(0)
                || address(dependencies.stateView) == address(0) || address(dependencies.adapterDeployer) == address(0)
                || address(dependencies.lockerDeployer) == address(0)
                || address(dependencies.marketDeployer) == address(0)
                || address(dependencies.launchFactory).code.length == 0
                || address(dependencies.feeRouter).code.length == 0
                || address(dependencies.assetRouter).code.length == 0
                || address(dependencies.oracleHook).code.length == 0
                || address(dependencies.poolManager).code.length == 0
                || address(dependencies.positionManager).code.length == 0
                || address(dependencies.permit2).code.length == 0 || address(dependencies.stateView).code.length == 0
                || address(dependencies.adapterDeployer).code.length == 0
                || address(dependencies.lockerDeployer).code.length == 0
                || address(dependencies.marketDeployer).code.length == 0
                || address(dependencies.launchFactory.assetRouter()) != address(dependencies.assetRouter)
                || address(dependencies.feeRouter.assetRouter()) != address(dependencies.assetRouter)
                || address(dependencies.oracleHook.poolManager()) != address(dependencies.poolManager)
                || curve_.curveTokenAllocation == 0 || curve_.graduationTokenAllocation == 0
                || curve_.initialVirtualTokenReserve <= curve_.curveTokenAllocation
                || curve_.initialVirtualNativeReserve == 0 || curve_.graduationThresholdNative == 0
                || curve_.curveFeeBps == 0 || curve_.curveFeeBps > 1_000 || minimumUseBps_ == 0
                || minimumUseBps_ > 10_000 || maximumNativeSwap_ == 0
        ) revert InvalidConfiguration();
        launchFactory = dependencies.launchFactory;
        feeRouter = dependencies.feeRouter;
        assetRouter = dependencies.assetRouter;
        oracleHook = dependencies.oracleHook;
        poolManager = dependencies.poolManager;
        positionManager = dependencies.positionManager;
        permit2 = dependencies.permit2;
        stateView = dependencies.stateView;
        adapterDeployer = dependencies.adapterDeployer;
        lockerDeployer = dependencies.lockerDeployer;
        marketDeployer = dependencies.marketDeployer;
        initializer = msg.sender;
        curveTokenAllocation = curve_.curveTokenAllocation;
        graduationTokenAllocation = curve_.graduationTokenAllocation;
        initialVirtualTokenReserve = curve_.initialVirtualTokenReserve;
        initialVirtualNativeReserve = curve_.initialVirtualNativeReserve;
        graduationThresholdNative = curve_.graduationThresholdNative;
        curveFeeBps = curve_.curveFeeBps;
        minimumUseBps = minimumUseBps_;
        maximumNativeSwap = maximumNativeSwap_;
        uint256 terminalTokenReserve = curve_.initialVirtualTokenReserve - curve_.curveTokenAllocation;
        uint256 terminalNativeReserve =
            Math.ceilDiv(curve_.initialVirtualNativeReserve * curve_.initialVirtualTokenReserve, terminalTokenReserve);
        terminalNativePerTokenX18 = Math.mulDiv(terminalNativeReserve, 1e18, terminalTokenReserve);
        terminalSqrtPriceX96 = _sqrtPriceForNativePerToken(terminalNativePerTokenX18);
    }

    modifier onlyCoordinator() {
        if (coordinator == address(0)) revert CoordinatorNotBound();
        if (msg.sender != coordinator) revert Unauthorized();
        _;
    }

    function bindCoordinator(address coordinator_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (coordinator != address(0)) revert CoordinatorAlreadyBound();
        if (coordinator_ == address(0) || coordinator_.code.length == 0) {
            revert InvalidConfiguration();
        }
        coordinator = coordinator_;
        emit CoordinatorBound(coordinator_);
    }

    function requiredTokenSupply() external view returns (uint256) {
        return curveTokenAllocation + graduationTokenAllocation;
    }

    function createMarketFor(RobynLaunchToken token, address creator, address seedAuthority)
        external
        onlyCoordinator
        returns (RobynV4BondingCurveMarket market)
    {
        if (creator == address(0) || seedAuthority != msg.sender) revert InvalidConfiguration();
        if (launchFactory.creatorByToken(address(token)) != creator) revert Unauthorized();
        if (marketByToken[address(token)] != address(0)) revert MarketAlreadyExists();
        address vaultAddress = launchFactory.vaultByToken(address(token));
        if (vaultAddress == address(0)) revert InvalidConfiguration();
        RobynNativeBasketVaultV2 vault = RobynNativeBasketVaultV2(payable(vaultAddress));

        (RobynV4GraduationAdapter adapter, bytes32 poolId) = _createAdapter(token);
        market = _deployMarket(token, vault, creator, seedAuthority, adapter);
        marketByToken[address(token)] = address(market);
        adapterByToken[address(token)] = address(adapter);
        poolIdByToken[address(token)] = poolId;
        emit MarketCreated(
            creator,
            address(token),
            address(market),
            address(adapter),
            poolId,
            address(adapter.locker()),
            terminalSqrtPriceX96
        );
    }

    function _createAdapter(RobynLaunchToken token) private returns (RobynV4GraduationAdapter adapter, bytes32 poolId) {
        adapter = adapterDeployer.deploy(
            RobynV4AdapterDeployer.Deployment({
                launchToken: token,
                poolManager: poolManager,
                positionManager: positionManager,
                permit2: permit2,
                stateView: stateView,
                assetRouter: assetRouter,
                hook: IHooks(address(oracleHook)),
                initialSqrtPriceX96: terminalSqrtPriceX96,
                minimumUseBps: minimumUseBps,
                maximumNativeSwap: maximumNativeSwap
            })
        );
        PoolKey memory key = adapter.poolKey();
        RobynV4FeePositionLocker locker = lockerDeployer.deploy(
            IPositionManagerPermit2(address(positionManager)),
            permit2,
            poolManager,
            token,
            key,
            address(adapter),
            maximumNativeSwap
        );
        adapter.bindLocker(locker);
        poolId = PoolId.unwrap(key.toId());
        oracleHook.registerPool(key);
        int24 initializedTick = poolManager.initialize(key, terminalSqrtPriceX96);
        (uint160 actualSqrtPriceX96, int24 actualTick,,) = stateView.getSlot0(PoolId.wrap(poolId));
        if (actualSqrtPriceX96 != terminalSqrtPriceX96 || actualTick != initializedTick || actualSqrtPriceX96 == 0) {
            revert PoolInitializationMismatch();
        }
        assetRouter.configureLaunchRoute(
            address(token),
            RobynV4AssetRouter.Route({
                fee: POOL_FEE_PIPS,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(address(oracleHook)),
                minimumLiquidity: 1,
                maximumNativeInput: maximumNativeSwap,
                referenceTick: 0,
                maximumReferenceTickDeviation: 0,
                enforceReferencePrice: false,
                verificationClass: keccak256("ROBYN_V4_LAUNCH_POOL"),
                enabled: true
            })
        );
    }

    function _deployMarket(
        RobynLaunchToken token,
        RobynNativeBasketVaultV2 vault,
        address creator,
        address seedAuthority,
        RobynV4GraduationAdapter adapter
    ) private returns (RobynV4BondingCurveMarket market) {
        RobynV4BondingCurveMarket.CurveConfig memory curve =
            RobynV4BondingCurveMarket.CurveConfig({
                curveTokenAllocation: curveTokenAllocation,
                graduationTokenAllocation: graduationTokenAllocation,
                initialVirtualTokenReserve: initialVirtualTokenReserve,
                initialVirtualNativeReserve: initialVirtualNativeReserve,
                graduationThresholdNative: graduationThresholdNative,
                curveFeeBps: curveFeeBps
            });
        market = marketDeployer.deploy(token, vault, creator, seedAuthority, curve, adapter);
        market.bindFeeRouter(feeRouter);
        adapter.bindMarket(address(market));
        adapter.bindFeeRouter(feeRouter);
    }

    function _sqrtPriceForNativePerToken(uint256 nativePerTokenX18) private pure returns (uint160) {
        uint256 ratioX192 = Math.mulDiv(1e18, 1 << 192, nativePerTokenX18);
        uint256 sqrtRatioX96 = Math.sqrt(ratioX192);
        if (sqrtRatioX96 == 0 || sqrtRatioX96 > type(uint160).max) {
            revert InvalidConfiguration();
        }
        return uint160(sqrtRatioX96);
    }
}
