// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RobynLaunchToken} from "../src/RobynLaunchToken.sol";
import {RobynClaimsRouter} from "../src/RobynClaimsRouter.sol";
import {IRobynMaintenanceCoordinator} from "../src/interfaces/IRobynMaintenanceCoordinator.sol";

interface Schema19Vm {
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
}

contract Schema19RewardAsset is ERC20 {
    constructor() ERC20("Schema 19 Reward", "S19R") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract Schema19RevertingMaintenance is IRobynMaintenanceCoordinator {
    uint256 public constant taskGasLimit = 100_000;
    function processRewards(address) external pure returns (bool) {
        revert("maintenance unavailable");
    }
}

contract Schema19ClaimMaintenanceTest {
    Schema19Vm private constant vm = Schema19Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant HOLDER = address(0xA11CE);
    address private constant RELAYER = address(0xB0B);

    function testPermissionlessClaimAllForAlwaysPaysAccount() external {
        (RobynLaunchToken token, Schema19RewardAsset reward) = _fundedToken();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(RELAYER);
        uint256 claimed = token.claimAllFor(HOLDER);
        require(claimed > 99 ether && claimed <= 100 ether, "claim amount");
        require(reward.balanceOf(HOLDER) == claimed, "holder paid");
        require(reward.balanceOf(RELAYER) == 0, "relayer redirected");
    }

    function testClaimSurvivesMaintenanceRevert() external {
        (RobynLaunchToken token, Schema19RewardAsset reward) = _fundedToken();
        Schema19RevertingMaintenance maintenance = new Schema19RevertingMaintenance();
        RobynClaimsRouter router = new RobynClaimsRouter(maintenance, 100_000);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(HOLDER);
        (uint256 claimed, bool maintenanceCallSucceeded) = router.claimAll(token);
        require(claimed > 99 ether && claimed <= 100 ether, "claim amount");
        require(!maintenanceCallSucceeded, "maintenance unexpectedly succeeded");
        require(reward.balanceOf(HOLDER) == claimed, "holder paid");
    }

    function _fundedToken() private returns (RobynLaunchToken token, Schema19RewardAsset reward) {
        reward = new Schema19RewardAsset();
        address[] memory rewards = new address[](1);
        rewards[0] = address(reward);
        token = new RobynLaunchToken(
            "Schema 19 Token", "S19", HOLDER, 1_000 ether, address(this), rewards, "ipfs://baaaaaaaaaaaaaaaaaaaa"
        );
        address[] memory excluded = new address[](0);
        token.sealExclusions(excluded);
        reward.mint(address(this), 100 ether);
        reward.approve(address(token), 100 ether);
        token.distributeReward(0, 100 ether);
    }
}
