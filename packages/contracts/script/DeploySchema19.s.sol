// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { RobynClaimsRouter } from "../src/RobynClaimsRouter.sol";
import { RobynDaoRewardDistributor } from "../src/RobynDaoRewardDistributor.sol";
import { RobynMaintenanceCoordinator } from "../src/RobynMaintenanceCoordinator.sol";
import { RobynTokenSink } from "../src/RobynTokenSink.sol";
import { RobynTradeRouter } from "../src/RobynTradeRouter.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { IRobynMaintenanceCoordinator } from "../src/interfaces/IRobynMaintenanceCoordinator.sol";
import { RobynNativeLaunchDeployerV4 } from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import { RobynNativeLaunchFactoryV4 } from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import { RobynNativeVaultDeployerV4 } from "../src/uniswap/RobynNativeVaultDeployerV4.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4AssetRouter, IWrappedNative } from "../src/uniswap/RobynV4AssetRouter.sol";
import { RobynV4AdapterDeployer } from "../src/uniswap/RobynV4AdapterDeployer.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4FeeAndPhaseHook } from "../src/uniswap/RobynV4FeeAndPhaseHook.sol";
import { RobynV4LaunchCoordinatorV7 } from "../src/uniswap/RobynV4LaunchCoordinatorV7.sol";
import { RobynV4LockerDeployer } from "../src/uniswap/RobynV4LockerDeployer.sol";
import { RobynV4MarketDeployer } from "../src/uniswap/RobynV4MarketDeployer.sol";
import { RobynV4MarketFactory } from "../src/uniswap/RobynV4MarketFactory.sol";

interface ISchema19Safe {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory array, address next);
}

interface ISchema19Timelock {
    function getMinDelay() external view returns (uint256);
}

interface ISchema19Governor {
    function token() external view returns (address);
    function timelock() external view returns (address);
}

/// @notice Exact Schema-19 broadcaster. Existing governance is verified and never redeployed.
contract DeploySchema19 is Script {
    address private constant SAFE_MODULE_SENTINEL = address(0x1);

    struct ExternalContracts {
        address create2Deployer;
        IPoolManager poolManager;
        IPositionManager positionManager;
        IV4Quoter quoter;
        IStateView stateView;
        IAllowanceTransfer permit2;
        IWrappedNative wrappedNative;
    }

    struct Governance {
        address deployer;
        address guardian;
        RobynDaoToken daoToken;
        ISchema19Timelock timelock;
        ISchema19Governor governor;
    }

    struct Stack {
        RobynV4AssetRouter assetRouter;
        RobynNativeLaunchDeployerV4 launchDeployer;
        RobynNativeVaultDeployerV4 vaultDeployer;
        RobynNativeLaunchFactoryV4 launchFactory;
        RobynNativeProtocolFeeRouterV4 feeRouter;
        RobynDaoRewardDistributor daoRewards;
        RobynMaintenanceCoordinator maintenance;
        RobynClaimsRouter claimsRouter;
        RobynTradeRouter tradeRouter;
        RobynTokenSink tokenSink;
        RobynV4FeeAndPhaseHook oracleHook;
        RobynV4AdapterDeployer adapterDeployer;
        RobynV4LockerDeployer lockerDeployer;
        RobynV4MarketDeployer marketDeployer;
        RobynV4MarketFactory marketFactory;
        RobynV4LaunchCoordinatorV7 coordinator;
    }

    struct DeploymentConfig {
        string json;
        uint256 startingNonce;
        Governance governance;
        ExternalContracts externalContracts;
        bytes32 hookSalt;
        bytes32 hookDomain;
        bytes32 hookInitCodeHash;
        uint256 rewardDuration;
        uint256 failureObservationSpacing;
        uint256 fallbackDelay;
        uint256 targetGraduationNative;
        uint256 maximumCurvePurchase;
        uint256 maintenanceTaskGas;
        uint256 maintenanceCallGas;
        address[] routeAssets;
        bytes[] routeConfigurationCalldata;
    }

    function run() external {
        DeploymentConfig memory config = _loadConfig();
        _verifyGovernance(config.governance);
        require(
            vm.getNonce(config.governance.deployer) == config.startingNonce,
            "Schema-19 nonce changed"
        );
        vm.startBroadcast();
        Stack memory stack = _deploy(config);
        _configureAndBind(stack, config);
        vm.stopBroadcast();
        _verify(stack, config);
        _log(stack);
    }

    function _loadConfig() private view returns (DeploymentConfig memory config) {
        config.json = vm.readFile(vm.envString("SCHEMA19_DEPLOYMENT_INPUT"));
        require(block.chainid == vm.parseJsonUint(config.json, ".chainId"), "Schema-19 wrong chain");
        require(vm.parseJsonUint(config.json, ".schemaVersion") == 19, "Schema-19 input required");
        require(!vm.parseJsonBool(config.json, ".provisional"), "provisional input");
        config.governance = Governance({
            deployer: vm.parseJsonAddress(config.json, ".deployment.deployer"),
            guardian: vm.parseJsonAddress(config.json, ".governance.guardianSafe"),
            daoToken: RobynDaoToken(
                payable(vm.parseJsonAddress(config.json, ".governance.daoToken"))
            ),
            timelock: ISchema19Timelock(vm.parseJsonAddress(config.json, ".governance.timelock")),
            governor: ISchema19Governor(vm.parseJsonAddress(config.json, ".governance.governor"))
        });
        config.startingNonce = vm.parseJsonUint(config.json, ".deployment.startingNonce");
        config.externalContracts = _externalContracts(config.json);
        config.hookSalt = vm.parseJsonBytes32(config.json, ".oracleHook.salt");
        config.hookDomain = vm.parseJsonBytes32(config.json, ".oracleHook.domain");
        config.hookInitCodeHash = vm.parseJsonBytes32(config.json, ".oracleHook.initCodeHash");
        config.rewardDuration = vm.parseJsonUint(config.json, ".settings.rewardDuration");
        config.failureObservationSpacing =
            vm.parseJsonUint(config.json, ".settings.failureObservationSpacing");
        config.fallbackDelay = vm.parseJsonUint(config.json, ".settings.fallbackDelay");
        config.targetGraduationNative =
            vm.parseJsonUint(config.json, ".settings.targetGraduationNative");
        config.maximumCurvePurchase =
            vm.parseJsonUint(config.json, ".settings.maximumCurvePurchase");
        config.maintenanceTaskGas = vm.parseJsonUint(config.json, ".settings.maintenanceTaskGas");
        config.maintenanceCallGas = vm.parseJsonUint(config.json, ".settings.maintenanceCallGas");
        config.routeAssets = abi.decode(vm.parseJson(config.json, ".routes.assets"), (address[]));
        config.routeConfigurationCalldata =
            abi.decode(vm.parseJson(config.json, ".routes.configurationCalldata"), (bytes[]));
        require(config.routeAssets.length >= 6, "six routes required");
        require(
            config.routeAssets.length == config.routeConfigurationCalldata.length,
            "route input mismatch"
        );
    }

    function _externalContracts(string memory json)
        private
        view
        returns (ExternalContracts memory result)
    {
        result = ExternalContracts({
            create2Deployer: vm.parseJsonAddress(json, ".external.create2Deployer"),
            poolManager: IPoolManager(vm.parseJsonAddress(json, ".external.poolManager")),
            positionManager: IPositionManager(
                vm.parseJsonAddress(json, ".external.positionManager")
            ),
            quoter: IV4Quoter(vm.parseJsonAddress(json, ".external.quoter")),
            stateView: IStateView(vm.parseJsonAddress(json, ".external.stateView")),
            permit2: IAllowanceTransfer(vm.parseJsonAddress(json, ".external.permit2")),
            wrappedNative: IWrappedNative(vm.parseJsonAddress(json, ".external.wrappedNative"))
        });
        require(result.create2Deployer.code.length != 0, "CREATE2 deployer missing");
        require(address(result.poolManager).code.length != 0, "PoolManager missing");
        require(address(result.positionManager).code.length != 0, "PositionManager missing");
        require(address(result.quoter).code.length != 0, "Quoter missing");
        require(address(result.stateView).code.length != 0, "StateView missing");
        require(address(result.permit2).code.length != 0, "Permit2 missing");
        require(address(result.wrappedNative).code.length != 0, "WETH missing");
    }

    function _deploy(DeploymentConfig memory config) private returns (Stack memory stack) {
        Governance memory gov = config.governance;
        ExternalContracts memory ext = config.externalContracts;
        stack.assetRouter = new RobynV4AssetRouter(
            ext.poolManager,
            ext.quoter,
            ext.stateView,
            address(gov.timelock),
            gov.guardian,
            ext.wrappedNative
        );
        _requirePredicted(config.json, "assetRouter", address(stack.assetRouter));
        stack.launchDeployer = new RobynNativeLaunchDeployerV4(config.rewardDuration);
        _requirePredicted(config.json, "launchDeployer", address(stack.launchDeployer));
        stack.vaultDeployer = new RobynNativeVaultDeployerV4();
        _requirePredicted(config.json, "vaultDeployer", address(stack.vaultDeployer));
        stack.launchFactory = new RobynNativeLaunchFactoryV4(
            stack.assetRouter,
            stack.launchDeployer,
            stack.vaultDeployer,
            1 wei,
            config.rewardDuration
        );
        _requirePredicted(config.json, "launchFactory", address(stack.launchFactory));
        stack.feeRouter = new RobynNativeProtocolFeeRouterV4(
            gov.daoToken,
            stack.assetRouter,
            payable(address(gov.timelock)),
            gov.guardian,
            config.rewardDuration
        );
        _requirePredicted(config.json, "feeRouter", address(stack.feeRouter));
        stack.daoRewards =
            new RobynDaoRewardDistributor(IVotes(address(gov.daoToken)), config.rewardDuration);
        _requirePredicted(config.json, "daoRewards", address(stack.daoRewards));
        stack.maintenance = new RobynMaintenanceCoordinator(
            stack.feeRouter, stack.assetRouter, config.maintenanceTaskGas
        );
        _requirePredicted(config.json, "maintenance", address(stack.maintenance));
        stack.claimsRouter = new RobynClaimsRouter(
            IRobynMaintenanceCoordinator(address(stack.maintenance)), config.maintenanceCallGas
        );
        _requirePredicted(config.json, "claimsRouter", address(stack.claimsRouter));
        stack.tradeRouter = new RobynTradeRouter();
        _requirePredicted(config.json, "tradeRouter", address(stack.tradeRouter));
        stack.tokenSink = new RobynTokenSink();
        _requirePredicted(config.json, "tokenSink", address(stack.tokenSink));
        stack.oracleHook = _deployHook(stack.feeRouter, config);
        stack.adapterDeployer = new RobynV4AdapterDeployer();
        _requirePredicted(config.json, "adapterDeployer", address(stack.adapterDeployer));
        stack.lockerDeployer = new RobynV4LockerDeployer();
        _requirePredicted(config.json, "lockerDeployer", address(stack.lockerDeployer));
        stack.marketDeployer = new RobynV4MarketDeployer();
        _requirePredicted(config.json, "marketDeployer", address(stack.marketDeployer));
        stack.marketFactory = _deployMarketFactory(stack, config);
        _requirePredicted(config.json, "marketFactory", address(stack.marketFactory));
        stack.feeRouter.bindMaintenanceCoordinator(address(stack.maintenance));
        stack.daoRewards.bindRewardDepositor(address(stack.feeRouter));
        stack.feeRouter.bindDaoRewardReceiver(address(stack.daoRewards));
        stack.coordinator = new RobynV4LaunchCoordinatorV7(
            stack.launchFactory,
            stack.marketFactory,
            stack.feeRouter,
            stack.tradeRouter,
            address(gov.timelock),
            gov.guardian
        );
        _requirePredicted(config.json, "coordinator", address(stack.coordinator));
    }

    function _deployHook(RobynNativeProtocolFeeRouterV4 feeRouter, DeploymentConfig memory config)
        private
        returns (RobynV4FeeAndPhaseHook hook)
    {
        ExternalContracts memory ext = config.externalContracts;
        bytes memory initCode = abi.encodePacked(
            type(RobynV4FeeAndPhaseHook).creationCode,
            abi.encode(
                ext.poolManager,
                feeRouter,
                config.governance.deployer,
                ext.positionManager,
                config.hookDomain
            )
        );
        require(keccak256(initCode) == config.hookInitCodeHash, "hook init code changed");
        address expected =
            vm.computeCreate2Address(config.hookSalt, config.hookInitCodeHash, ext.create2Deployer);
        _requirePredicted(config.json, "oracleHook", expected);
        (bool created,) = ext.create2Deployer.call(abi.encodePacked(config.hookSalt, initCode));
        require(created && expected.code.length != 0, "hook deployment failed");
        hook = RobynV4FeeAndPhaseHook(payable(expected));
    }

    function _deployMarketFactory(Stack memory stack, DeploymentConfig memory config)
        private
        returns (RobynV4MarketFactory marketFactory)
    {
        ExternalContracts memory ext = config.externalContracts;
        marketFactory = new RobynV4MarketFactory(
            RobynV4MarketFactory.Dependencies({
                launchFactory: stack.launchFactory,
                feeRouter: stack.feeRouter,
                assetRouter: stack.assetRouter,
                oracleHook: stack.oracleHook,
                poolManager: ext.poolManager,
                positionManager: ext.positionManager,
                permit2: ext.permit2,
                stateView: ext.stateView,
                adapterDeployer: stack.adapterDeployer,
                lockerDeployer: stack.lockerDeployer,
                marketDeployer: stack.marketDeployer,
                tokenSink: address(stack.tokenSink)
            }),
            RobynV4BondingCurveMarket.CurveConfig({
                curveTokenAllocation: 800_000_000 ether,
                graduationTokenAllocation: 200_000_000 ether,
                initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666,
                initialVirtualNativeReserve: 1,
                graduationThresholdNative: config.targetGraduationNative,
                maximumCurvePurchase: config.maximumCurvePurchase,
                curveFeeBps: 100
            }),
            9_900,
            0.25 ether,
            1 gwei,
            0.000001 ether
        );
    }

    function _configureAndBind(Stack memory stack, DeploymentConfig memory config) private {
        stack.launchFactory
            .configureFallbackPolicy(config.failureObservationSpacing, config.fallbackDelay);
        for (uint256 index; index < config.routeConfigurationCalldata.length; ++index) {
            bytes memory data = config.routeConfigurationCalldata[index];
            bytes4 selector;
            assembly {
                selector := mload(add(data, 32))
            }
            require(
                selector == RobynV4AssetRouter.configureRoute.selector
                    || selector == RobynV4AssetRouter.configureWrappedNativeRoute.selector,
                "unapproved route selector"
            );
            (bool configured,) = address(stack.assetRouter).call(data);
            require(configured, "route configuration failed");
        }
        stack.launchDeployer.bindController(address(stack.launchFactory));
        stack.vaultDeployer.bindController(address(stack.launchFactory));
        stack.adapterDeployer.bindController(address(stack.marketFactory));
        stack.lockerDeployer.bindController(address(stack.marketFactory));
        stack.marketDeployer.bindController(address(stack.marketFactory));
        stack.oracleHook.bindRegistrar(address(stack.marketFactory));
        stack.assetRouter.bindLaunchRegistrar(address(stack.marketFactory));
        stack.launchFactory.bindCoordinator(address(stack.coordinator));
        stack.marketFactory.bindCoordinator(address(stack.coordinator));
        stack.feeRouter.bindCoordinator(address(stack.coordinator));
    }

    function _verify(Stack memory stack, DeploymentConfig memory config) private view {
        _verifyGovernance(config.governance);
        require(
            stack.coordinator.launchMode() == RobynV4LaunchCoordinatorV7.LaunchMode.Public,
            "not Public"
        );
        require(!stack.assetRouter.conversionsPaused(), "asset conversions paused");
        require(!stack.feeRouter.paused(), "fee conversions paused");
        require(
            stack.marketFactory.graduationThresholdNative() == config.targetGraduationNative,
            "profile target"
        );
        require(
            stack.marketFactory.maximumCurvePurchase() == config.maximumCurvePurchase, "profile max"
        );
        require(
            stack.launchFactory.failureObservationSpacing() == config.failureObservationSpacing,
            "spacing"
        );
        require(stack.launchFactory.fallbackDelay() == config.fallbackDelay, "fallback");
        require(
            stack.feeRouter.maintenanceCoordinator() == address(stack.maintenance),
            "maintenance binding"
        );
        require(stack.feeRouter.daoRewardReceiver() == address(stack.daoRewards), "DAO receiver");
        require(stack.daoRewards.rewardDepositor() == address(stack.feeRouter), "DAO depositor");
        require(stack.launchFactory.launchCount() == 0, "unexpected launch");
        require(address(stack.feeRouter).balance == 0, "unexpected router balance");
        require(address(stack.daoRewards).balance == 0, "unexpected DAO reward balance");
        for (uint256 index; index < config.routeAssets.length; ++index) {
            address asset = config.routeAssets[index];
            if (asset == address(config.externalContracts.wrappedNative)) {
                require(stack.assetRouter.executionRouteStatus(asset).ready, "WETH route not ready");
            } else {
                require(stack.assetRouter.routeStatus(asset).ready, "asset route not ready");
            }
        }
    }

    function _verifyGovernance(Governance memory gov) private view {
        require(address(gov.daoToken).code.length != 0, "RDAO missing");
        require(address(gov.timelock).code.length != 0, "Timelock missing");
        require(address(gov.governor).code.length != 0, "Governor missing");
        require(gov.guardian.code.length != 0, "Safe missing");
        require(gov.daoToken.totalSupply() == 1_000_000_000 ether, "RDAO supply");
        require(gov.daoToken.balanceOf(gov.deployer) == gov.daoToken.totalSupply(), "RDAO owner");
        require(ISchema19Timelock(gov.timelock).getMinDelay() == 1 hours, "Timelock delay");
        require(gov.governor.token() == address(gov.daoToken), "Governor token");
        require(gov.governor.timelock() == address(gov.timelock), "Governor Timelock");
        address[] memory owners = ISchema19Safe(gov.guardian).getOwners();
        require(owners.length == 1 && owners[0] == gov.deployer, "Safe owner");
        require(ISchema19Safe(gov.guardian).getThreshold() == 1, "Safe threshold");
        (address[] memory modules, address nextModule) =
            ISchema19Safe(gov.guardian).getModulesPaginated(SAFE_MODULE_SENTINEL, 10);
        require(modules.length == 0, "Safe modules");
        require(nextModule == SAFE_MODULE_SENTINEL, "Safe module cursor");
    }

    function _requirePredicted(string memory json, string memory label, address actual)
        private
        view
    {
        address expected = vm.parseJsonAddress(json, string.concat(".deployment.contracts.", label));
        require(actual == expected, string.concat(label, " prediction changed"));
    }

    function _log(Stack memory stack) private view {
        console2.log("SCHEMA19_ASSET_ROUTER", address(stack.assetRouter));
        console2.log("SCHEMA19_FEE_ROUTER", address(stack.feeRouter));
        console2.log("SCHEMA19_DAO_REWARDS", address(stack.daoRewards));
        console2.log("SCHEMA19_MAINTENANCE", address(stack.maintenance));
        console2.log("SCHEMA19_CLAIMS_ROUTER", address(stack.claimsRouter));
        console2.log("SCHEMA19_TRADE_ROUTER", address(stack.tradeRouter));
        console2.log("SCHEMA19_MARKET_FACTORY", address(stack.marketFactory));
        console2.log("SCHEMA19_COORDINATOR", address(stack.coordinator));
        console2.log("SCHEMA19_ORACLE_HOOK", address(stack.oracleHook));
    }
}
