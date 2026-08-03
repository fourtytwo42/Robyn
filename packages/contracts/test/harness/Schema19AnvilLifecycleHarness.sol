// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { RobynClaimsRouter } from "../../src/RobynClaimsRouter.sol";
import { RobynLaunchToken } from "../../src/RobynLaunchToken.sol";
import { IRobynMaintenanceCoordinator } from "../../src/interfaces/IRobynMaintenanceCoordinator.sol";
import { RobynNativeLaunchDeployerV4 } from "../../src/uniswap/RobynNativeLaunchDeployerV4.sol";

contract Schema19TortureRewardAsset is ERC20 {
    constructor() ERC20("Schema 19 Torture Reward", "S19R") {
        _mint(msg.sender, 10_000_000 ether);
    }
}

contract Schema19BroadcastMaintenance is IRobynMaintenanceCoordinator {
    uint256 public constant taskGasLimit = 100_000;
    address public immutable controller;
    bool public failureEnabled;
    uint256 public successfulAttempts;
    address public lastToken;

    constructor(address controller_) {
        controller = controller_;
    }

    function setFailure(bool enabled) external {
        require(msg.sender == controller, "controller");
        failureEnabled = enabled;
    }

    function processRewards(address token) external returns (bool) {
        if (failureEnabled) revert("maintenance unavailable");
        successfulAttempts += 1;
        lastToken = token;
        return true;
    }
}

/// @notice Disposable chain-31337 broadcast harness for Schema-19 claim-first
/// maintenance isolation. It is never deployed outside isolated Anvil.
contract Schema19AnvilLifecycleHarness {
    Schema19TortureRewardAsset public immutable rewardAsset;
    RobynNativeLaunchDeployerV4 public immutable productionDeployer;
    RobynNativeLaunchDeployerV4 public immutable acceleratedDeployer;
    Schema19BroadcastMaintenance public immutable maintenance;
    RobynClaimsRouter public immutable claimsRouter;
    RobynLaunchToken public productionToken;
    RobynLaunchToken public acceleratedToken;
    address public immutable administrator;
    address public immutable holder;
    bool public initialized;

    constructor(address holder_) {
        require(holder_ != address(0), "holder");
        administrator = msg.sender;
        holder = holder_;
        rewardAsset = new Schema19TortureRewardAsset();
        productionDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        acceleratedDeployer = new RobynNativeLaunchDeployerV4(10 minutes);
        maintenance = new Schema19BroadcastMaintenance(address(this));
        claimsRouter = new RobynClaimsRouter(maintenance, maintenance.taskGasLimit());
    }

    function initialize() external {
        require(msg.sender == administrator, "administrator");
        require(!initialized, "initialized");
        initialized = true;
        productionDeployer.bindController(address(this));
        acceleratedDeployer.bindController(address(this));

        address[] memory assets = new address[](1);
        assets[0] = address(rewardAsset);
        RobynNativeLaunchDeployerV4.TokenRequest memory request =
            RobynNativeLaunchDeployerV4.TokenRequest({
                name: "Schema 19 Production",
                symbol: "S19P",
                supplyRecipient: holder,
                initialSupply: 1_000_000_000 ether,
                vault: address(this),
                assets: assets,
                tokenUri: "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q"
            });
        productionToken =
            productionDeployer.deployToken(keccak256("schema19-production"), request);
        request.name = "Schema 19 Accelerated";
        request.symbol = "S19A";
        acceleratedToken =
            acceleratedDeployer.deployToken(keccak256("schema19-accelerated"), request);
        address[] memory exclusions = new address[](0);
        productionDeployer.sealExclusions(productionToken, exclusions);
        acceleratedDeployer.sealExclusions(acceleratedToken, exclusions);
        rewardAsset.approve(address(productionToken), type(uint256).max);
        rewardAsset.approve(address(acceleratedToken), type(uint256).max);
    }

    function depositBoth(uint256 amount) external {
        require(initialized, "not initialized");
        productionToken.distributeReward(0, amount);
        acceleratedToken.distributeReward(0, amount);
    }

    function setMaintenanceFailure(bool enabled) external {
        require(msg.sender == administrator, "administrator");
        maintenance.setFailure(enabled);
    }

    function productionDuration() external view returns (uint256) {
        return productionToken.REWARD_STREAM_DURATION();
    }

    function acceleratedDuration() external view returns (uint256) {
        return acceleratedToken.REWARD_STREAM_DURATION();
    }
}
