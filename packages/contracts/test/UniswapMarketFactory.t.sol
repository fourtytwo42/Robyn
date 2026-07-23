// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynLaunchFactory } from "../src/RobynLaunchFactory.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { UniswapV3AdapterDeployer } from "../src/uniswap/UniswapV3AdapterDeployer.sol";
import { UniswapV3BondingCurveMarket } from "../src/uniswap/UniswapV3BondingCurveMarket.sol";
import { UniswapV3GraduationAdapter } from "../src/uniswap/UniswapV3GraduationAdapter.sol";
import { UniswapV3MarketDeployer } from "../src/uniswap/UniswapV3MarketDeployer.sol";
import { UniswapV3MarketFactory } from "../src/uniswap/UniswapV3MarketFactory.sol";
import {
    GraduationMockConversionRouter,
    GraduationMockERC20,
    GraduationMockFactory,
    GraduationMockPositionManager,
    GraduationMockQuoter,
    GraduationMockSwapRouter
} from "./UniswapGraduation.t.sol";

contract UniswapMarketFactoryTest {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    GraduationMockERC20 private base;
    RobynLaunchFactory private launchFactory;
    RobynLaunchToken private token;
    UniswapV3AdapterDeployer private adapterDeployer;
    UniswapV3MarketDeployer private marketDeployer;
    UniswapV3MarketFactory private marketFactory;

    function setUp() public {
        base = new GraduationMockERC20("Mock USD", "mUSD");
        GraduationMockERC20 reward = new GraduationMockERC20("Mock Stock", "mSTOCK");
        GraduationMockConversionRouter conversionRouter = new GraduationMockConversionRouter();
        launchFactory = new RobynLaunchFactory(base, conversionRouter, 1, 1 days);
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        (token,) = launchFactory.createLaunch("Factory Graduate", "FGRAD", SUPPLY, assets, weights);

        GraduationMockFactory uniswapFactory = new GraduationMockFactory();
        GraduationMockPositionManager positionManager =
            new GraduationMockPositionManager(uniswapFactory);
        GraduationMockSwapRouter swapRouter = new GraduationMockSwapRouter();
        GraduationMockQuoter quoter = new GraduationMockQuoter();
        UniswapV3BondingCurveMarket.CurveConfig memory curve =
            UniswapV3BondingCurveMarket.CurveConfig({
                curveTokenAllocation: 2_000 ether,
                graduationTokenAllocation: 666 ether,
                initialVirtualTokenReserve: 3_000 ether,
                initialVirtualBaseReserve: 333 ether,
                graduationThresholdBase: 666 ether,
                curveFeeBps: 100
            });
        UniswapV3MarketFactory.FactoryDexConfig memory dex = UniswapV3MarketFactory.FactoryDexConfig({
            factory: uniswapFactory,
            positionManager: positionManager,
            swapRouter: swapRouter,
            quoter: quoter,
            poolFee: 10_000,
            tickLower: -887_200,
            tickUpper: 887_200,
            initialBasePerTokenX18: 1 ether,
            minimumUseBps: 9_900,
            maximumPriceDeviationBps: 100
        });
        adapterDeployer = new UniswapV3AdapterDeployer();
        marketDeployer = new UniswapV3MarketDeployer();
        marketFactory = new UniswapV3MarketFactory(
            base, launchFactory, adapterDeployer, marketDeployer, curve, dex
        );
        adapterDeployer.bindController(address(marketFactory));
        marketDeployer.bindController(address(marketFactory));
    }

    function testFactoryCreatesBoundMarketPoolAdapterAndLocker() public {
        UniswapV3BondingCurveMarket market = marketFactory.createMarket(token);
        UniswapV3GraduationAdapter adapter = market.graduationAdapter();
        require(marketFactory.marketByToken(address(token)) == address(market), "market mapping");
        require(marketFactory.adapterByToken(address(token)) == address(adapter), "adapter mapping");
        require(adapter.bondingMarket() == address(market), "market binding");
        require(adapter.pool() != address(0), "pool");
        require(address(adapter.locker()) != address(0), "locker");
        require(adapterDeployer.controller() == address(marketFactory), "adapter controller");
        require(marketDeployer.controller() == address(marketFactory), "market controller");

        try marketFactory.createMarket(token) {
            revert("duplicate market");
        } catch { }
    }

    function testFactoryRejectsNonCreator() public {
        GraduationUnauthorizedMarketCreator caller = new GraduationUnauthorizedMarketCreator();
        try caller.create(marketFactory, token) {
            revert("non-creator market");
        } catch { }
    }
}

contract GraduationUnauthorizedMarketCreator {
    function create(UniswapV3MarketFactory factory, RobynLaunchToken token) external {
        factory.createMarket(token);
    }
}
