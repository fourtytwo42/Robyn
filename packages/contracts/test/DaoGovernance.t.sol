// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynGovernor } from "../src/dao/RobynGovernor.sol";

interface DaoGovernanceVm {
    function warp(uint256 timestamp) external;
}

contract DaoGovernedValue {
    uint256 public value;
    address public immutable timelock;

    constructor(address timelock_) {
        timelock = timelock_;
    }

    function setValue(uint256 value_) external {
        require(msg.sender == timelock, "timelock only");
        value = value_;
    }
}

contract DaoGovernanceTest {
    DaoGovernanceVm private constant vm =
        DaoGovernanceVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testProposalVoteQueueAndTimelockExecution() external {
        address[] memory recipients = new address[](2);
        recipients[0] = address(this);
        recipients[1] = address(0xBEEF);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 900_000_000 ether;
        amounts[1] = 100_000_000 ether;
        RobynDaoToken token = new RobynDaoToken(recipients, amounts, 1 hours);
        token.delegate(address(this));
        vm.warp(block.timestamp + 1);

        address[] memory empty = new address[](0);
        TimelockController timelock = new TimelockController(2 days, empty, empty, address(this));
        RobynGovernor governor = new RobynGovernor(token, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(0xCAFE));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        DaoGovernedValue target = new DaoGovernedValue(address(timelock));
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(DaoGovernedValue.setValue, (42));
        string memory description = "Set the governed value to 42";

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        require(uint8(governor.state(proposalId)) == 0, "pending");
        vm.warp(block.timestamp + 1 days + 1);
        governor.castVote(proposalId, 1);
        require(uint8(governor.state(proposalId)) == 1, "active");
        vm.warp(block.timestamp + 3 days + 1);
        require(uint8(governor.state(proposalId)) == 4, "succeeded");
        bytes32 descriptionHash = keccak256(bytes(description));
        governor.queue(targets, values, calldatas, descriptionHash);
        require(uint8(governor.state(proposalId)) == 5, "queued");
        vm.warp(block.timestamp + 2 days + 1);
        governor.execute(targets, values, calldatas, descriptionHash);
        require(target.value() == 42, "executed");
        require(uint8(governor.state(proposalId)) == 7, "complete");
    }
}
