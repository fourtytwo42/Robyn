// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynBootstrapTimelock } from "../src/dao/RobynBootstrapTimelock.sol";
import { RobynDaoTokenV3 } from "../src/dao/RobynDaoTokenV3.sol";
import { RobynGovernorV2 } from "../src/dao/RobynGovernorV2.sol";
import { DevnetWrappedNative } from "../src/devnet/DevnetWrappedNative.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../src/RobynRdaoStaking.sol";

contract Schema20GovernedValue {
    address public immutable timelock;
    uint256 public value;

    constructor(address timelock_) { timelock = timelock_; }

    function setValue(uint256 value_) external {
        require(msg.sender == timelock, "timelock only");
        value = value_;
    }
}

contract Schema20GovernanceStakingTest is Test {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    address private constant GUARDIAN = address(0xCAFE);
    address private constant SALE_CUSTODY = address(0x5A1E);

    RobynDaoTokenV3 private token;
    RobynBootstrapTimelock private timelock;
    RobynGovernorV2 private governor;
    RobynRdaoStaking private staking;
    Schema20GovernedValue private target;

    function setUp() external {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = SUPPLY;
        token = new RobynDaoTokenV3(recipients, amounts, 1 hours, address(this));
        bytes32[2] memory plans = [keccak256("schema20-unused-0"), keccak256("schema20-unused-1")];
        timelock = new RobynBootstrapTimelock(
            token, address(this), GUARDIAN, keccak256("SCHEMA20_GOVERNANCE"), plans
        );
        token.bindBootstrapController(address(timelock));
        governor = new RobynGovernorV2(token, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), GUARDIAN);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));
        DevnetWrappedNative weth = new DevnetWrappedNative();
        staking = new RobynRdaoStaking(
            IERC20(address(token)), IRobynWrappedNative(address(weth)), address(timelock),
            GUARDIAN, 24 hours, 1 hours, 7 days
        );
        staking.sealRewardSources();
        target = new Schema20GovernedValue(address(timelock));
    }

    function testTwoHundredMillionAllocationEndsUnanimousButStakedVotesPassGovernance() external {
        token.delegate(address(this));
        token.transfer(SALE_CUSTODY, 200_000_000 ether);
        assertTrue(timelock.bootstrapFinalized());
        assertEq(timelock.bootstrapFinalizationReason(), timelock.REASON_RDAO_DISTRIBUTED());
        token.approve(address(staking), 800_000_000 ether);
        staking.stake(800_000_000 ether, address(this));
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.getVotes(address(this)), 800_000_000 ether);
        vm.warp(block.timestamp + 2);

        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(Schema20GovernedValue.setValue, (42));
        vm.expectRevert(RobynGovernorV2.UnanimousOwnershipRequired.selector);
        governor.scheduleUnanimous(targets, values, payloads, keccak256("no shortcut"));

        string memory description = "Schema-20 ordinary governance with staked RDAO";
        bytes32 descriptionHash = keccak256(bytes(description));
        uint256 proposalId = governor.propose(targets, values, payloads, description);
        assertEq(governor.proposalThreshold(), 10_000_000 ether);
        assertEq(governor.quorumNumerator(), 10);
        assertEq(governor.quorum(block.timestamp - 1), 100_000_000 ether);
        vm.warp(block.timestamp + 1 hours + 1);
        governor.castVote(proposalId, 1);
        vm.warp(block.timestamp + 4 hours + 1);
        governor.queue(targets, values, payloads, descriptionHash);
        vm.expectRevert();
        governor.execute(targets, values, payloads, descriptionHash);
        vm.warp(block.timestamp + 1 hours + 1);
        governor.execute(targets, values, payloads, descriptionHash);
        assertEq(target.value(), 42);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(staking.totalPrincipal(), 800_000_000 ether);
    }
}
