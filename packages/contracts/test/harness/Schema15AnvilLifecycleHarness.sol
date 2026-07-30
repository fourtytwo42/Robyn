// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { RobynLaunchToken } from "../../src/RobynLaunchToken.sol";
import { RobynNativeLaunchDeployerV4 } from "../../src/uniswap/RobynNativeLaunchDeployerV4.sol";

contract Schema15TortureRewardAsset is ERC20 {
    constructor() ERC20("Schema 15 Torture Reward", "S15R") {
        _mint(msg.sender, 10_000_000 ether);
    }
}

/// @notice Disposable chain-31337 broadcast harness for exact launch-token
/// production and accelerated stream deployments. It is not production code.
contract Schema15AnvilLifecycleHarness {
    Schema15TortureRewardAsset public immutable rewardAsset;
    RobynNativeLaunchDeployerV4 public immutable productionDeployer;
    RobynNativeLaunchDeployerV4 public immutable acceleratedDeployer;
    RobynLaunchToken public productionToken;
    RobynLaunchToken public acceleratedToken;
    address public immutable holder;
    bool public initialized;

    constructor(address holder_) {
        require(holder_ != address(0), "holder");
        holder = holder_;
        rewardAsset = new Schema15TortureRewardAsset();
        productionDeployer = new RobynNativeLaunchDeployerV4(1 hours);
        acceleratedDeployer = new RobynNativeLaunchDeployerV4(10 minutes);
    }

    function initialize() external {
        require(msg.sender == holder, "holder only");
        require(!initialized, "initialized");
        initialized = true;
        productionDeployer.bindController(address(this));
        acceleratedDeployer.bindController(address(this));

        address[] memory assets = new address[](1);
        assets[0] = address(rewardAsset);
        RobynNativeLaunchDeployerV4.TokenRequest memory productionRequest =
            RobynNativeLaunchDeployerV4.TokenRequest({
                name: "Schema 15 Production",
                symbol: "S15P",
                supplyRecipient: holder,
                initialSupply: 1_000_000_000 ether,
                vault: address(this),
                assets: assets,
                tokenUri: "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q"
            });
        RobynNativeLaunchDeployerV4.TokenRequest memory acceleratedRequest = productionRequest;
        acceleratedRequest.name = "Schema 15 Accelerated";
        acceleratedRequest.symbol = "S15A";
        productionToken =
            productionDeployer.deployToken(keccak256("schema15-production"), productionRequest);
        acceleratedToken =
            acceleratedDeployer.deployToken(keccak256("schema15-accelerated"), acceleratedRequest);
        address[] memory exclusions = new address[](0);
        productionDeployer.sealExclusions(productionToken, exclusions);
        acceleratedDeployer.sealExclusions(acceleratedToken, exclusions);
        rewardAsset.approve(address(productionToken), type(uint256).max);
        rewardAsset.approve(address(acceleratedToken), type(uint256).max);
    }

    function productionDuration() external view returns (uint256) {
        return productionToken.REWARD_STREAM_DURATION();
    }

    function acceleratedDuration() external view returns (uint256) {
        return acceleratedToken.REWARD_STREAM_DURATION();
    }

    function depositBoth(uint256 amount) external {
        require(initialized, "not initialized");
        productionToken.distributeReward(0, amount);
        acceleratedToken.distributeReward(0, amount);
    }
}
