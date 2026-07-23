// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynAtomicLaunchCoordinator } from "../src/RobynAtomicLaunchCoordinator.sol";
import { RobynLaunchDeployerV2 } from "../src/RobynLaunchDeployerV2.sol";
import { RobynLaunchFactoryV2 } from "../src/RobynLaunchFactoryV2.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { UniswapV3AdapterDeployer } from "../src/uniswap/UniswapV3AdapterDeployer.sol";
import { UniswapV3BondingCurveMarket } from "../src/uniswap/UniswapV3BondingCurveMarket.sol";
import { UniswapV3MarketDeployer } from "../src/uniswap/UniswapV3MarketDeployer.sol";
import { UniswapV3MarketFactoryV2 } from "../src/uniswap/UniswapV3MarketFactoryV2.sol";
import {
    GraduationMockConversionRouter,
    GraduationMockERC20,
    GraduationMockFactory,
    GraduationMockPositionManager,
    GraduationMockQuoter,
    GraduationMockSwapRouter
} from "./UniswapGraduation.t.sol";

contract AtomicLaunchCoordinatorTest {
    uint256 private constant SUPPLY = 2_666 ether;
    uint24 private constant POOL_FEE = 10_000;

    GraduationMockERC20 private base;
    GraduationMockERC20 private reward;
    GraduationMockConversionRouter private conversionRouter;
    GraduationMockFactory private uniswapFactory;
    RobynLaunchDeployerV2 private launchDeployer;
    RobynLaunchFactoryV2 private launchFactory;
    UniswapV3AdapterDeployer private adapterDeployer;
    UniswapV3MarketDeployer private marketDeployer;
    UniswapV3MarketFactoryV2 private marketFactory;
    RobynAtomicLaunchCoordinator private coordinator;

    function setUp() public {
        base = new GraduationMockERC20("Mock USD", "mUSD");
        reward = new GraduationMockERC20("Mock Stock", "mSTOCK");
        conversionRouter = new GraduationMockConversionRouter();
        launchDeployer = new RobynLaunchDeployerV2();
        launchFactory = new RobynLaunchFactoryV2(base, conversionRouter, launchDeployer, 1, 1 days);
        uniswapFactory = new GraduationMockFactory();
        GraduationMockPositionManager positionManager =
            new GraduationMockPositionManager(uniswapFactory);
        GraduationMockSwapRouter swapRouter = new GraduationMockSwapRouter();
        GraduationMockQuoter quoter = new GraduationMockQuoter();
        adapterDeployer = new UniswapV3AdapterDeployer();
        marketDeployer = new UniswapV3MarketDeployer();
        UniswapV3BondingCurveMarket.CurveConfig memory curve =
            UniswapV3BondingCurveMarket.CurveConfig({
                curveTokenAllocation: 2_000 ether,
                graduationTokenAllocation: 666 ether,
                initialVirtualTokenReserve: 3_000 ether,
                initialVirtualBaseReserve: 333 ether,
                graduationThresholdBase: 666 ether,
                curveFeeBps: 100
            });
        UniswapV3MarketFactoryV2.FactoryDexConfig memory dex =
            UniswapV3MarketFactoryV2.FactoryDexConfig({
                factory: uniswapFactory,
                positionManager: positionManager,
                swapRouter: swapRouter,
                quoter: quoter,
                poolFee: POOL_FEE,
                tickLower: -887_200,
                tickUpper: 887_200,
                initialBasePerTokenX18: 1 ether,
                minimumUseBps: 9_900,
                maximumPriceDeviationBps: 100
            });
        marketFactory = new UniswapV3MarketFactoryV2(
            base, launchFactory, adapterDeployer, marketDeployer, curve, dex
        );
        coordinator = new RobynAtomicLaunchCoordinator(launchFactory, marketFactory);
        launchDeployer.bindController(address(launchFactory));
        adapterDeployer.bindController(address(marketFactory));
        marketDeployer.bindController(address(marketFactory));
        launchFactory.bindCoordinator(address(coordinator));
        marketFactory.bindCoordinator(address(coordinator));
    }

    function testAtomicLaunchCreatesSeededCanonicalMarket() public {
        RobynLaunchFactoryV2.LaunchRequest memory request = _request(bytes32(uint256(1)));
        (address predictedToken, address predictedVault, bytes32 launchSaltHash) =
            coordinator.predictLaunchAddresses(address(this), request);
        (RobynLaunchToken token,, UniswapV3BondingCurveMarket market) =
            coordinator.createLaunch(request);

        require(address(token) == predictedToken, "token prediction");
        require(launchFactory.vaultByToken(address(token)) == predictedVault, "vault prediction");
        require(launchFactory.usedLaunchSalt(launchSaltHash), "salt unused");
        require(launchFactory.creatorByToken(address(token)) == address(this), "creator");
        require(marketFactory.marketByToken(address(token)) == address(market), "market mapping");
        require(market.seeded(), "not seeded");
        require(token.balanceOf(address(market)) == SUPPLY, "inventory");
        require(token.balanceOf(address(coordinator)) == 0, "coordinator balance");
        require(token.allowance(address(coordinator), address(market)) == 0, "allowance");
        require(token.exclusionsSealed(), "exclusions");
        require(token.isExcluded(address(market)), "market inclusion");
        require(token.isExcluded(address(market.graduationAdapter())), "adapter inclusion");
        require(token.isExcluded(market.graduatedPool()), "pool inclusion");
        require(token.isExcluded(market.positionLocker()), "locker inclusion");
        require(token.isExcluded(address(coordinator)), "coordinator inclusion");
    }

    function testDuplicateSaltRevertsWithoutChangingLaunchCount() public {
        RobynLaunchFactoryV2.LaunchRequest memory request = _request(bytes32(uint256(2)));
        coordinator.createLaunch(request);
        try coordinator.createLaunch(request) {
            revert("duplicate salt accepted");
        } catch { }
        require(launchFactory.launchCount() == 1, "launch count changed");
    }

    function testPoolPrecreationRevertsTheEntireLaunch() public {
        RobynLaunchFactoryV2.LaunchRequest memory request = _request(bytes32(uint256(3)));
        (address predictedToken, address predictedVault, bytes32 launchSaltHash) =
            coordinator.predictLaunchAddresses(address(this), request);
        uniswapFactory.createPool(address(base), predictedToken, POOL_FEE);

        try coordinator.createLaunch(request) {
            revert("squatted pool accepted");
        } catch { }
        require(launchFactory.launchCount() == 0, "launch persisted");
        require(predictedToken.code.length == 0, "token persisted");
        require(predictedVault.code.length == 0, "vault persisted");
        require(!launchFactory.usedLaunchSalt(launchSaltHash), "salt persisted");
        require(marketFactory.marketByToken(predictedToken) == address(0), "market persisted");
    }

    function testFactoriesRejectDirectCreationAfterBinding() public {
        RobynLaunchFactoryV2.LaunchRequest memory request = _request(bytes32(uint256(4)));
        try launchFactory.createLaunchFor(address(this), address(this), SUPPLY, request) {
            revert("direct launch accepted");
        } catch { }
        require(launchFactory.launchCount() == 0, "direct launch persisted");
        coordinator.createLaunch(_request(bytes32(uint256(40))));
        RobynLaunchToken token = RobynLaunchToken(launchFactory.launchTokenById(1));
        try marketFactory.createMarketFor(token, address(this), address(this)) {
            revert("direct market accepted");
        } catch { }
    }

    function testFactoryIsInactiveBeforeCoordinatorBinding() public {
        RobynLaunchDeployerV2 freshDeployer = new RobynLaunchDeployerV2();
        RobynLaunchFactoryV2 freshFactory =
            new RobynLaunchFactoryV2(base, conversionRouter, freshDeployer, 1, 1 days);
        freshDeployer.bindController(address(freshFactory));
        try freshFactory.createLaunchFor(
            address(this), address(this), SUPPLY, _request(bytes32(uint256(41)))
        ) {
            revert("inactive factory accepted launch");
        } catch { }
        require(freshFactory.launchCount() == 0, "inactive launch persisted");
    }

    function testCoordinatorBindingsCannotChange() public {
        try launchFactory.bindCoordinator(address(1)) {
            revert("launch coordinator rebound");
        } catch { }
        try marketFactory.bindCoordinator(address(1)) {
            revert("market coordinator rebound");
        } catch { }
        require(launchFactory.coordinator() == address(coordinator), "launch coordinator changed");
        require(marketFactory.coordinator() == address(coordinator), "market coordinator changed");
    }

    function testDistinctSaltsCreateDistinctConcurrentLaunches() public {
        (RobynLaunchToken first,,) = coordinator.createLaunch(_request(bytes32(uint256(5))));
        (RobynLaunchToken second,,) = coordinator.createLaunch(_request(bytes32(uint256(6))));
        require(address(first) != address(second), "same token");
        require(launchFactory.launchCount() == 2, "launch count");
    }

    function testMetadataUriIsImmutableAndAffectsPredictedAddress() public {
        RobynLaunchFactoryV2.LaunchRequest memory firstRequest = _request(bytes32(uint256(51)));
        (address firstPrediction,,) =
            coordinator.predictLaunchAddresses(address(this), firstRequest);
        firstRequest.metadataUri =
        "ipfs://bafkreibys2cv4ijpoedcl7qdbi5u66wuwedwg3lsc6pios3wcyaoyz7cau";
        (address secondPrediction,,) =
            coordinator.predictLaunchAddresses(address(this), firstRequest);
        require(firstPrediction != secondPrediction, "metadata not in create2");
        (RobynLaunchToken token,,) = coordinator.createLaunch(firstRequest);
        require(
            keccak256(bytes(token.tokenURI())) == keccak256(bytes(firstRequest.metadataUri)),
            "token uri"
        );
    }

    function testInvalidMetadataUriRollsBackEverything() public {
        RobynLaunchFactoryV2.LaunchRequest memory request = _request(bytes32(uint256(52)));
        request.metadataUri = "https://mutable.example/token.json";
        (address predictedToken, address predictedVault, bytes32 launchSaltHash) =
            coordinator.predictLaunchAddresses(address(this), request);
        try coordinator.createLaunch(request) {
            revert("invalid metadata accepted");
        } catch { }
        require(launchFactory.launchCount() == 0, "launch count changed");
        require(predictedToken.code.length == 0, "token persisted");
        require(predictedVault.code.length == 0, "vault persisted");
        require(!launchFactory.usedLaunchSalt(launchSaltHash), "salt persisted");
    }

    function testAtomicLaunchStillGraduates() public {
        (RobynLaunchToken token,, UniswapV3BondingCurveMarket market) =
            coordinator.createLaunch(_request(bytes32(uint256(7))));
        base.mint(address(this), 1_000 ether);
        base.approve(address(market), 1_000 ether);
        market.buy(1_000 ether, 1);
        require(market.graduated(), "not graduated");
        require(token.balanceOf(market.graduatedPool()) != 0, "pool token liquidity");
        require(base.balanceOf(market.graduatedPool()) != 0, "pool base liquidity");
    }

    function _request(bytes32 salt)
        private
        view
        returns (RobynLaunchFactoryV2.LaunchRequest memory request)
    {
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        request = RobynLaunchFactoryV2.LaunchRequest({
            name: "Atomic Launch",
            symbol: "ATOM",
            assets: assets,
            weights: weights,
            metadataUri: "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q",
            userSalt: salt
        });
    }
}
