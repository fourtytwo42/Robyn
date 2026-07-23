// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { FeeBasketVault } from "../src/FeeBasketVault.sol";
import { RobynDaoLaunchCoordinator } from "../src/RobynDaoLaunchCoordinator.sol";
import { RobynLaunchDeployerV2 } from "../src/RobynLaunchDeployerV2.sol";
import { RobynLaunchFactoryV2 } from "../src/RobynLaunchFactoryV2.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynGovernor } from "../src/dao/RobynGovernor.sol";
import { RobynProtocolFeeRouterV2 } from "../src/dao/RobynProtocolFeeRouterV2.sol";
import { RewardFeePositionLocker } from "../src/uniswap/RewardFeePositionLocker.sol";
import { UniswapV3AdapterDeployer } from "../src/uniswap/UniswapV3AdapterDeployer.sol";
import { UniswapV3BondingCurveMarket } from "../src/uniswap/UniswapV3BondingCurveMarket.sol";
import { UniswapV3MarketDeployer } from "../src/uniswap/UniswapV3MarketDeployer.sol";
import { UniswapV3MarketFactoryV3 } from "../src/uniswap/UniswapV3MarketFactoryV3.sol";
import {
    GraduationMockConversionRouter,
    GraduationMockERC20,
    GraduationMockFactory,
    GraduationMockPositionManager,
    GraduationMockQuoter,
    GraduationMockSwapRouter
} from "./UniswapGraduation.t.sol";
import { DaoFeeActor, DaoFeeNativeConverter } from "./DaoFees.t.sol";
import { DaoGovernedValue } from "./DaoGovernance.t.sol";

interface SystemSimulationVm {
    function deal(address account, uint256 newBalance) external;
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
}

/// @notice Deterministic production-shape simulation for schema-v4 accounting and lifecycle paths.
/// @dev The actors are EOAs generated from fixed addresses so the run is reproducible.
contract SchemaV4HundredsUsersSimulationTest {
    SystemSimulationVm private constant vm =
        SystemSimulationVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant USER_COUNT = 512;
    uint256 private constant LAUNCH_COUNT = 32;
    uint256 private constant ECONOMIC_ACTION_COUNT = 25_000;
    uint256 private constant ECONOMIC_SEED_COUNT = 20;
    uint256 private constant SUPPLY = 2_666 ether;
    uint24 private constant POOL_FEE = 10_000;

    GraduationMockERC20 private base;
    GraduationMockERC20 private reward;
    GraduationMockConversionRouter private basketConverter;
    GraduationMockFactory private uniswapFactory;
    GraduationMockPositionManager private positionManager;
    GraduationMockSwapRouter private swapRouter;
    RobynLaunchFactoryV2 private launchFactory;
    UniswapV3MarketFactoryV3 private marketFactory;
    RobynDaoLaunchCoordinator private coordinator;
    RobynDaoToken private daoToken;
    RobynProtocolFeeRouterV2 private feeRouter;
    DaoFeeActor private treasury;
    DaoFeeNativeConverter private nativeConverter;
    RobynLaunchToken[] private tokens;
    FeeBasketVault[] private vaults;
    UniswapV3BondingCurveMarket[] private markets;

    function setUp() external {
        base = new GraduationMockERC20("Mock USD", "mUSD");
        reward = new GraduationMockERC20("Mock Stock", "mSTOCK");
        basketConverter = new GraduationMockConversionRouter();
        uniswapFactory = new GraduationMockFactory();
        positionManager = new GraduationMockPositionManager(uniswapFactory);
        swapRouter = new GraduationMockSwapRouter();
        treasury = new DaoFeeActor();

        address[] memory recipients = new address[](2);
        recipients[0] = address(this);
        recipients[1] = address(treasury);
        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 800_000_000 ether;
        allocations[1] = 200_000_000 ether;
        daoToken = new RobynDaoToken(recipients, allocations);
        feeRouter =
            new RobynProtocolFeeRouterV2(base, daoToken, payable(address(treasury)), address(this));

        RobynLaunchDeployerV2 launchDeployer = new RobynLaunchDeployerV2();
        launchFactory = new RobynLaunchFactoryV2(base, basketConverter, launchDeployer, 1, 1 days);
        UniswapV3AdapterDeployer adapterDeployer = new UniswapV3AdapterDeployer();
        UniswapV3MarketDeployer marketDeployer = new UniswapV3MarketDeployer();
        UniswapV3BondingCurveMarket.CurveConfig memory curve =
            UniswapV3BondingCurveMarket.CurveConfig({
                curveTokenAllocation: 2_000 ether,
                graduationTokenAllocation: 666 ether,
                initialVirtualTokenReserve: 3_000 ether,
                initialVirtualBaseReserve: 333 ether,
                graduationThresholdBase: 666 ether,
                curveFeeBps: 100
            });
        UniswapV3MarketFactoryV3.FactoryDexConfig memory dex =
            UniswapV3MarketFactoryV3.FactoryDexConfig({
                factory: uniswapFactory,
                positionManager: positionManager,
                swapRouter: swapRouter,
                quoter: new GraduationMockQuoter(),
                poolFee: POOL_FEE,
                tickLower: -887_200,
                tickUpper: 887_200,
                initialBasePerTokenX18: 1 ether,
                minimumUseBps: 9_900,
                maximumPriceDeviationBps: 100
            });
        marketFactory = new UniswapV3MarketFactoryV3(
            base, launchFactory, adapterDeployer, marketDeployer, feeRouter, curve, dex
        );
        coordinator = new RobynDaoLaunchCoordinator(launchFactory, marketFactory, feeRouter);

        launchDeployer.bindController(address(launchFactory));
        adapterDeployer.bindController(address(marketFactory));
        marketDeployer.bindController(address(marketFactory));
        launchFactory.bindCoordinator(address(coordinator));
        marketFactory.bindCoordinator(address(coordinator));
        feeRouter.bindCoordinator(address(coordinator));

        address[] memory exclusions = new address[](2);
        exclusions[0] = address(treasury);
        exclusions[1] = address(feeRouter);
        daoToken.sealRewardExclusions(exclusions);
        daoToken.bindRewardDepositor(address(feeRouter));
        nativeConverter = new DaoFeeNativeConverter();
        vm.deal(address(nativeConverter), 10_000 ether);
        feeRouter.setConverter(nativeConverter);
        reward.mint(address(basketConverter), type(uint128).max);

        for (uint256 index; index < LAUNCH_COUNT; ++index) {
            address creator = _user(index % 4);
            vm.prank(creator);
            (RobynLaunchToken token, FeeBasketVault vault, UniswapV3BondingCurveMarket market) =
                coordinator.createLaunch(_request(index + 1));
            tokens.push(token);
            vaults.push(vault);
            markets.push(market);
        }
    }

    function testSimulation512UsersAcrossLaunchTradeRewardAndClaimLifecycles() external {
        _distributeDaoAndDelegate();
        _simulateBondingTrades();
        _graduateAndTradeOnDex();
        _convertBasketAndNativeRewards();
        _exerciseClaimsAndTransfers();
        _assertConservation();
    }

    function testSimulation100VotersProposalLifecycle() external {
        daoToken.delegate(address(this));
        for (uint256 index; index < 100; ++index) {
            address voter = _user(index);
            daoToken.transfer(voter, 2_000_000 ether);
            vm.prank(voter);
            daoToken.delegate(voter);
        }
        vm.warp(block.timestamp + 1);

        address[] memory empty = new address[](0);
        TimelockController timelock = new TimelockController(2 days, empty, empty, address(this));
        RobynGovernor governor = new RobynGovernor(daoToken, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(0xCAFE));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        DaoGovernedValue target = new DaoGovernedValue(address(timelock));
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(DaoGovernedValue.setValue, (512));
        string memory description = "512-user deterministic simulation";
        uint256 proposalId = governor.propose(targets, values, calldatas, description);

        vm.warp(block.timestamp + 1 days + 1);
        for (uint256 index; index < 100; ++index) {
            vm.prank(_user(index));
            governor.castVote(proposalId, index % 10 == 0 ? 0 : 1);
        }
        vm.warp(block.timestamp + 3 days + 1);
        require(uint8(governor.state(proposalId)) == 4, "proposal did not succeed");
        bytes32 descriptionHash = keccak256(bytes(description));
        governor.queue(targets, values, calldatas, descriptionHash);
        vm.warp(block.timestamp + 2 days + 1);
        governor.execute(targets, values, calldatas, descriptionHash);
        require(target.value() == 512, "governance execution");
    }

    function testSchemaV4AtomicRollbackAuthorizationAndPauseMatrix() external {
        uint256 beforeCount = launchFactory.launchCount();

        vm.prank(_user(0));
        try coordinator.createLaunch(_request(1)) {
            revert("duplicate salt accepted");
        } catch { }
        require(launchFactory.launchCount() == beforeCount, "duplicate launch persisted");

        RobynLaunchFactoryV2.LaunchRequest memory zeroSalt = _request(90);
        zeroSalt.userSalt = bytes32(0);
        vm.prank(_user(90));
        try coordinator.createLaunch(zeroSalt) {
            revert("zero salt accepted");
        } catch { }
        require(launchFactory.launchCount() == beforeCount, "zero-salt launch persisted");

        RobynLaunchFactoryV2.LaunchRequest memory invalidBasket = _request(91);
        invalidBasket.weights[0] = 9_999;
        (address invalidToken, address invalidVault, bytes32 invalidSaltHash) =
            coordinator.predictLaunchAddresses(_user(91), invalidBasket);
        vm.prank(_user(91));
        try coordinator.createLaunch(invalidBasket) {
            revert("invalid basket accepted");
        } catch { }
        require(invalidToken.code.length == 0, "invalid token persisted");
        require(invalidVault.code.length == 0, "invalid vault persisted");
        require(!launchFactory.usedLaunchSalt(invalidSaltHash), "invalid salt persisted");
        require(launchFactory.launchCount() == beforeCount, "invalid launch persisted");

        RobynLaunchFactoryV2.LaunchRequest memory squatted = _request(92);
        (address predictedToken, address predictedVault, bytes32 predictedSaltHash) =
            coordinator.predictLaunchAddresses(_user(92), squatted);
        uniswapFactory.createPool(address(base), predictedToken, POOL_FEE);
        vm.prank(_user(92));
        try coordinator.createLaunch(squatted) {
            revert("precreated pool accepted");
        } catch { }
        require(predictedToken.code.length == 0, "squatted token persisted");
        require(predictedVault.code.length == 0, "squatted vault persisted");
        require(!launchFactory.usedLaunchSalt(predictedSaltHash), "squatted salt persisted");
        require(launchFactory.launchCount() == beforeCount, "squatted launch persisted");

        try launchFactory.createLaunchFor(address(this), address(this), SUPPLY, _request(93)) {
            revert("direct launch accepted");
        } catch { }
        try marketFactory.createMarketFor(tokens[0], _user(0), address(this)) {
            revert("direct market accepted");
        } catch { }
        try feeRouter.registerLaunch(
            tokens[0], address(this), vaults[0], address(markets[0]), address(this)
        ) {
            revert("direct fee registration accepted");
        } catch { }
        try launchFactory.bindCoordinator(address(this)) {
            revert("launch coordinator rebound");
        } catch { }
        try marketFactory.bindCoordinator(address(this)) {
            revert("market coordinator rebound");
        } catch { }
        try feeRouter.bindCoordinator(address(this)) {
            revert("fee coordinator rebound");
        } catch { }

        address trader = _user(100);
        base.mint(trader, 10 ether);
        vm.startPrank(trader);
        base.approve(address(markets[0]), 10 ether);
        markets[0].buy(10 ether, 1);
        vm.stopPrank();
        RobynProtocolFeeRouterV2.LaunchFeeAccount memory beforePause =
            feeRouter.launchAccount(address(tokens[0]));

        vm.prank(_user(101));
        try feeRouter.setPaused(true) {
            revert("unauthorized pause accepted");
        } catch { }
        feeRouter.setPaused(true);
        try feeRouter.convertPendingToNative(
            IERC20(address(tokens[0])), 1 ether, 1, block.timestamp + 1
        ) {
            revert("paused conversion accepted");
        } catch { }
        RobynProtocolFeeRouterV2.LaunchFeeAccount memory duringPause =
            feeRouter.launchAccount(address(tokens[0]));
        require(
            duringPause.pendingCreatorBase == beforePause.pendingCreatorBase
                && duringPause.pendingDaoRewardBase == beforePause.pendingDaoRewardBase
                && duringPause.pendingTreasuryBase == beforePause.pendingTreasuryBase,
            "pause changed liabilities"
        );
        try feeRouter.setPaused(false) {
            revert("guardian unpaused");
        } catch { }
        vm.prank(address(treasury));
        feeRouter.setPaused(false);
        require(!feeRouter.paused(), "treasury unpause failed");

        vm.prank(_user(102));
        try feeRouter.setConverter(nativeConverter) {
            revert("unauthorized converter accepted");
        } catch { }
        require(address(feeRouter.converter()) == address(nativeConverter), "converter changed");
    }

    function _distributeDaoAndDelegate() private {
        for (uint256 index; index < USER_COUNT; ++index) {
            address user = _user(index);
            daoToken.transfer(user, 1_000_000 ether);
            vm.prank(user);
            daoToken.delegate(user);
        }
    }

    function _simulateBondingTrades() private {
        for (uint256 index; index < USER_COUNT; ++index) {
            address user = _user(index);
            uint256 marketIndex = index % LAUNCH_COUNT;
            base.mint(user, 25 ether);
            vm.startPrank(user);
            base.approve(address(markets[marketIndex]), type(uint256).max);
            markets[marketIndex].buy(2 ether, 1);
            if (index % 9 == 0) {
                uint256 balance = tokens[marketIndex].balanceOf(user);
                if (balance > 2) {
                    tokens[marketIndex].approve(address(markets[marketIndex]), balance / 4);
                    markets[marketIndex].sell(balance / 4, 1);
                }
            }
            vm.stopPrank();
        }

        for (uint256 actionIndex; actionIndex < ECONOMIC_ACTION_COUNT; ++actionIndex) {
            uint256 seed = actionIndex % ECONOMIC_SEED_COUNT;
            uint256 entropy =
                uint256(keccak256(abi.encode(seed, actionIndex / ECONOMIC_SEED_COUNT)));
            address user = _user(entropy % USER_COUNT);
            uint256 marketIndex = (entropy >> 32) % LAUNCH_COUNT;
            base.mint(user, 0.02 ether);
            vm.startPrank(user);
            base.approve(address(markets[marketIndex]), type(uint256).max);
            if (entropy % 5 != 0) {
                markets[marketIndex].buy(0.01 ether, 1);
            } else {
                uint256 balance = tokens[marketIndex].balanceOf(user);
                if (balance > 20) {
                    uint256 sellAmount = balance / 20;
                    tokens[marketIndex].approve(address(markets[marketIndex]), sellAmount);
                    markets[marketIndex].sell(sellAmount, 1);
                } else {
                    markets[marketIndex].buy(0.01 ether, 1);
                }
            }
            vm.stopPrank();
        }
    }

    function _graduateAndTradeOnDex() private {
        for (uint256 marketIndex; marketIndex < 2; ++marketIndex) {
            address closer = _user(240 + marketIndex);
            base.mint(closer, 1_000 ether);
            vm.startPrank(closer);
            base.approve(address(markets[marketIndex]), type(uint256).max);
            markets[marketIndex].buy(1_000 ether, 1);
            vm.stopPrank();
            require(markets[marketIndex].graduated(), "graduation");

            address liquidityUser = _user(marketIndex);
            uint256 balance = tokens[marketIndex].balanceOf(liquidityUser);
            vm.prank(liquidityUser);
            tokens[marketIndex].transfer(address(swapRouter), balance / 10);
            base.mint(address(swapRouter), 1_000 ether);

            address dexUser = _user(220 + marketIndex);
            base.mint(dexUser, 10 ether);
            vm.startPrank(dexUser);
            base.approve(address(markets[marketIndex]), type(uint256).max);
            markets[marketIndex].buy(1 ether, 1);
            uint256 dexBalance = tokens[marketIndex].balanceOf(dexUser);
            tokens[marketIndex].approve(address(markets[marketIndex]), dexBalance);
            markets[marketIndex].sell(dexBalance / 2, 1);
            vm.stopPrank();
        }
    }

    function _convertBasketAndNativeRewards() private {
        for (uint256 index; index < LAUNCH_COUNT; ++index) {
            FeeBasketVault.BasketLeg memory selected = vaults[index].leg(0);
            if (selected.pendingBase != 0) {
                vaults[index].convertLeg(
                    0, selected.pendingBase, selected.pendingBase, block.timestamp + 1
                );
            }
            RobynProtocolFeeRouterV2.LaunchFeeAccount memory account =
                feeRouter.launchAccount(address(tokens[index]));
            uint256 pending = account.pendingCreatorBase + account.pendingDaoRewardBase
                + account.pendingTreasuryBase;
            if (pending != 0) {
                feeRouter.convertPendingToNative(
                    IERC20(address(tokens[index])), pending, pending, block.timestamp + 1
                );
            }
        }
    }

    function _exerciseClaimsAndTransfers() private {
        for (uint256 index; index < 64; ++index) {
            address user = _user(index);
            uint256 tokenIndex = index % LAUNCH_COUNT;
            if (tokens[tokenIndex].withdrawableRewardOf(user, 0) != 0) {
                vm.prank(user);
                tokens[tokenIndex].claim(0);
            }
            if (daoToken.claimableRewardOf(user) != 0) {
                vm.prank(user);
                daoToken.claimRewards();
            }
            uint256 balance = tokens[tokenIndex].balanceOf(user);
            if (balance != 0) {
                vm.prank(user);
                tokens[tokenIndex].transfer(_user((index + 1) % USER_COUNT), balance / 3);
            }
        }

        uint256 tokensPerCreator = LAUNCH_COUNT / 4;
        for (uint256 creatorIndex; creatorIndex < 4; ++creatorIndex) {
            address[] memory creatorTokens = new address[](tokensPerCreator);
            for (uint256 offset; offset < tokensPerCreator; ++offset) {
                creatorTokens[offset] = address(tokens[creatorIndex + (offset * 4)]);
            }
            vm.prank(_user(creatorIndex));
            feeRouter.claimCreatorFeesBatch(creatorTokens);
        }
    }

    function _assertConservation() private view {
        require(launchFactory.launchCount() == LAUNCH_COUNT, "launch count");
        require(daoToken.totalSupply() == 1_000_000_000 ether, "dao supply");
        require(feeRouter.totalCreatorNativeLiability() == 0, "creator liability");
        uint256 cumulativeFees;
        uint256 basketFees;
        uint256 creatorFees;
        for (uint256 index; index < LAUNCH_COUNT; ++index) {
            require(tokens[index].totalSupply() == SUPPLY, "launch supply");
            require(tokens[index].exclusionsSealed(), "exclusions");
            require(markets[index].seeded(), "market seed");
            require(vaults[index].totalPendingBase() == 0, "basket pending");
            RobynProtocolFeeRouterV2.LaunchFeeAccount memory account =
                feeRouter.launchAccount(address(tokens[index]));
            require(account.registered, "fee account");
            require(account.claimableCreatorNative == 0, "creator claimable");
            cumulativeFees += account.cumulativeBaseFees;
            basketFees += vaults[index].totalFeesReceived();
            creatorFees += account.cumulativeCreatorNative;
        }
        require(
            cumulativeFees
                == basketFees + creatorFees + feeRouter.totalDaoNativeRewards()
                    + feeRouter.totalTreasuryNative(),
            "fee conservation"
        );
    }

    function _request(uint256 salt)
        private
        view
        returns (RobynLaunchFactoryV2.LaunchRequest memory request)
    {
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        request = RobynLaunchFactoryV2.LaunchRequest({
            name: "System Simulation",
            symbol: "SIM",
            assets: assets,
            weights: weights,
            userSalt: bytes32(salt)
        });
    }

    function _user(uint256 index) private pure returns (address) {
        return address(uint160(0x100_000 + index));
    }
}
