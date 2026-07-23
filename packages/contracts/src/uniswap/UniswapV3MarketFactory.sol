// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { RobynLaunchFactory } from "../RobynLaunchFactory.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { UniswapV3AdapterDeployer } from "./UniswapV3AdapterDeployer.sol";
import { UniswapV3BondingCurveMarket } from "./UniswapV3BondingCurveMarket.sol";
import { UniswapV3GraduationAdapter } from "./UniswapV3GraduationAdapter.sol";
import {
    INonfungiblePositionManager,
    IQuoterV2,
    ISwapRouter,
    IUniswapV3Factory
} from "./UniswapV3Interfaces.sol";
import { UniswapV3MarketDeployer } from "./UniswapV3MarketDeployer.sol";

/// @notice Permissionless creator-authorized factory for canonical Uniswap v3 markets.
contract UniswapV3MarketFactory {
    string public constant CONTRACT_VERSION = "1.0.0";

    error InvalidConfiguration();
    error Unauthorized();
    error MarketAlreadyExists();
    error DeployersNotBound();

    struct FactoryDexConfig {
        IUniswapV3Factory factory;
        INonfungiblePositionManager positionManager;
        ISwapRouter swapRouter;
        IQuoterV2 quoter;
        uint24 poolFee;
        int24 tickLower;
        int24 tickUpper;
        uint256 initialBasePerTokenX18;
        uint16 minimumUseBps;
        uint16 maximumPriceDeviationBps;
    }

    IERC20 public immutable baseAsset;
    RobynLaunchFactory public immutable launchFactory;
    UniswapV3AdapterDeployer public immutable adapterDeployer;
    UniswapV3MarketDeployer public immutable marketDeployer;

    uint256 public immutable curveTokenAllocation;
    uint256 public immutable graduationTokenAllocation;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualBaseReserve;
    uint256 public immutable graduationThresholdBase;
    uint16 public immutable curveFeeBps;

    IUniswapV3Factory public immutable uniswapFactory;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    IQuoterV2 public immutable quoter;
    uint24 public immutable poolFee;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;
    uint256 public immutable initialBasePerTokenX18;
    uint16 public immutable minimumUseBps;
    uint16 public immutable maximumPriceDeviationBps;

    mapping(address => address) public marketByToken;
    mapping(address => address) public adapterByToken;

    event MarketCreated(
        address indexed creator,
        address indexed token,
        address indexed market,
        address adapter,
        address pool,
        address locker
    );

    constructor(
        IERC20 baseAsset_,
        RobynLaunchFactory launchFactory_,
        UniswapV3AdapterDeployer adapterDeployer_,
        UniswapV3MarketDeployer marketDeployer_,
        UniswapV3BondingCurveMarket.CurveConfig memory curve_,
        FactoryDexConfig memory dex_
    ) {
        if (
            address(dex_.factory) == address(0) || address(dex_.positionManager) == address(0)
                || address(dex_.swapRouter) == address(0) || address(dex_.quoter) == address(0)
                || address(dex_.factory).code.length == 0
                || address(dex_.positionManager).code.length == 0
                || address(dex_.swapRouter).code.length == 0
                || address(dex_.quoter).code.length == 0
        ) revert InvalidConfiguration();
        int24 tickSpacing_ = dex_.factory.feeAmountTickSpacing(dex_.poolFee);
        if (
            address(baseAsset_) == address(0) || address(launchFactory_) == address(0)
                || address(adapterDeployer_) == address(0) || address(marketDeployer_) == address(0)
                || address(adapterDeployer_).code.length == 0
                || address(marketDeployer_).code.length == 0
                || address(launchFactory_.baseAsset()) != address(baseAsset_)
                || curve_.curveTokenAllocation == 0 || curve_.graduationTokenAllocation == 0
                || curve_.initialVirtualTokenReserve <= curve_.curveTokenAllocation
                || curve_.initialVirtualBaseReserve == 0 || curve_.graduationThresholdBase == 0
                || curve_.curveFeeBps == 0 || curve_.curveFeeBps > 1_000 || dex_.poolFee == 0
                || tickSpacing_ == 0 || dex_.tickLower >= dex_.tickUpper
                || dex_.tickLower % tickSpacing_ != 0 || dex_.tickUpper % tickSpacing_ != 0
                || dex_.initialBasePerTokenX18 == 0 || dex_.minimumUseBps == 0
                || dex_.minimumUseBps > 10_000 || dex_.maximumPriceDeviationBps > 1_000
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchFactory = launchFactory_;
        adapterDeployer = adapterDeployer_;
        marketDeployer = marketDeployer_;
        curveTokenAllocation = curve_.curveTokenAllocation;
        graduationTokenAllocation = curve_.graduationTokenAllocation;
        initialVirtualTokenReserve = curve_.initialVirtualTokenReserve;
        initialVirtualBaseReserve = curve_.initialVirtualBaseReserve;
        graduationThresholdBase = curve_.graduationThresholdBase;
        curveFeeBps = curve_.curveFeeBps;
        uniswapFactory = dex_.factory;
        positionManager = dex_.positionManager;
        swapRouter = dex_.swapRouter;
        quoter = dex_.quoter;
        poolFee = dex_.poolFee;
        tickLower = dex_.tickLower;
        tickUpper = dex_.tickUpper;
        initialBasePerTokenX18 = dex_.initialBasePerTokenX18;
        minimumUseBps = dex_.minimumUseBps;
        maximumPriceDeviationBps = dex_.maximumPriceDeviationBps;
    }

    function createMarket(RobynLaunchToken token)
        external
        returns (UniswapV3BondingCurveMarket market)
    {
        if (launchFactory.creatorByToken(address(token)) != msg.sender) {
            revert Unauthorized();
        }
        if (marketByToken[address(token)] != address(0)) revert MarketAlreadyExists();
        if (
            adapterDeployer.controller() != address(this)
                || marketDeployer.controller() != address(this)
        ) revert DeployersNotBound();
        address vaultAddress = launchFactory.vaultByToken(address(token));
        if (vaultAddress == address(0)) revert InvalidConfiguration();
        FeeBasketVault vault = FeeBasketVault(vaultAddress);

        UniswapV3GraduationAdapter.AdapterConfig memory dex =
            UniswapV3GraduationAdapter.AdapterConfig({
                factory: uniswapFactory,
                positionManager: positionManager,
                swapRouter: swapRouter,
                quoter: quoter,
                poolFee: poolFee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                initialSqrtPriceX96: _initialSqrtPriceX96(token),
                minimumUseBps: minimumUseBps,
                maximumPriceDeviationBps: maximumPriceDeviationBps
            });
        UniswapV3GraduationAdapter adapter = adapterDeployer.deploy(baseAsset, token, vault, dex);
        UniswapV3BondingCurveMarket.CurveConfig memory curve =
            UniswapV3BondingCurveMarket.CurveConfig({
                curveTokenAllocation: curveTokenAllocation,
                graduationTokenAllocation: graduationTokenAllocation,
                initialVirtualTokenReserve: initialVirtualTokenReserve,
                initialVirtualBaseReserve: initialVirtualBaseReserve,
                graduationThresholdBase: graduationThresholdBase,
                curveFeeBps: curveFeeBps
            });
        market = marketDeployer.deploy(baseAsset, token, vault, msg.sender, curve, adapter);
        adapter.bindMarket(address(market));
        marketByToken[address(token)] = address(market);
        adapterByToken[address(token)] = address(adapter);
        emit MarketCreated(
            msg.sender,
            address(token),
            address(market),
            address(adapter),
            adapter.pool(),
            address(adapter.locker())
        );
    }

    function _initialSqrtPriceX96(RobynLaunchToken token) private view returns (uint160) {
        uint256 ratioX192 = address(token) < address(baseAsset)
            ? Math.mulDiv(initialBasePerTokenX18, 1 << 192, 1e18)
            : Math.mulDiv(1e18, 1 << 192, initialBasePerTokenX18);
        uint256 sqrtRatioX96 = Math.sqrt(ratioX192);
        if (sqrtRatioX96 == 0 || sqrtRatioX96 > type(uint160).max) {
            revert InvalidConfiguration();
        }
        return uint160(sqrtRatioX96);
    }
}
