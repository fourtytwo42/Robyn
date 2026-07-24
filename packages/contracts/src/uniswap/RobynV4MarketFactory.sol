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
import {RobynV4BondingCurveMarket} from "./RobynV4BondingCurveMarket.sol";
import {RobynV4GraduationAdapter} from "./RobynV4GraduationAdapter.sol";
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

    constructor(
        RobynNativeLaunchFactoryV4 launchFactory_,
        RobynNativeProtocolFeeRouterV3 feeRouter_,
        RobynV4AssetRouter assetRouter_,
        RobynV4OracleHook oracleHook_,
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        IStateView stateView_,
        RobynV4BondingCurveMarket.CurveConfig memory curve_,
        uint16 minimumUseBps_,
        uint128 maximumNativeSwap_
    ) {
        if (
            address(launchFactory_) == address(0) || address(feeRouter_) == address(0)
                || address(assetRouter_) == address(0) || address(oracleHook_) == address(0)
                || address(poolManager_) == address(0) || address(positionManager_) == address(0)
                || address(permit2_) == address(0) || address(stateView_) == address(0)
                || address(launchFactory_).code.length == 0 || address(feeRouter_).code.length == 0
                || address(assetRouter_).code.length == 0 || address(oracleHook_).code.length == 0
                || address(poolManager_).code.length == 0 || address(positionManager_).code.length == 0
                || address(permit2_).code.length == 0 || address(stateView_).code.length == 0
                || address(launchFactory_.assetRouter()) != address(assetRouter_)
                || address(feeRouter_.assetRouter()) != address(assetRouter_)
                || address(oracleHook_.poolManager()) != address(poolManager_) || curve_.curveTokenAllocation == 0
                || curve_.graduationTokenAllocation == 0
                || curve_.initialVirtualTokenReserve <= curve_.curveTokenAllocation
                || curve_.initialVirtualNativeReserve == 0 || curve_.graduationThresholdNative == 0
                || curve_.curveFeeBps == 0 || curve_.curveFeeBps > 1_000 || minimumUseBps_ == 0
                || minimumUseBps_ > 10_000 || maximumNativeSwap_ == 0
        ) revert InvalidConfiguration();
        launchFactory = launchFactory_;
        feeRouter = feeRouter_;
        assetRouter = assetRouter_;
        oracleHook = oracleHook_;
        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        stateView = stateView_;
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
        adapter = new RobynV4GraduationAdapter(
            token,
            poolManager,
            positionManager,
            permit2,
            stateView,
            assetRouter,
            IHooks(address(oracleHook)),
            address(this),
            terminalSqrtPriceX96,
            minimumUseBps,
            maximumNativeSwap
        );
        PoolKey memory key = adapter.poolKey();
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
        market = new RobynV4BondingCurveMarket(token, vault, creator, seedAuthority, curve, adapter);
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
