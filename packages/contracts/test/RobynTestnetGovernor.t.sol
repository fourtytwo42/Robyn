// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RobynDaoToken} from "../src/dao/RobynDaoToken.sol";
import {RobynTestnetGovernor} from "../src/dao/RobynTestnetGovernor.sol";
import {DaoGovernedValue} from "./DaoGovernance.t.sol";

interface TestnetGovernorVm {
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
}

contract RobynTestnetGovernorTest {
    TestnetGovernorVm private constant vm = TestnetGovernorVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GUARDIAN = address(0xCAFE);

    RobynDaoToken private token;
    TimelockController private timelock;
    RobynTestnetGovernor private governor;
    DaoGovernedValue private target;

    function setUp() external {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_000_000 ether;
        token = new RobynDaoToken(recipients, amounts);
        token.delegate(address(this));
        vm.warp(block.timestamp + 1);

        address[] memory empty = new address[](0);
        timelock = new TimelockController(10 minutes, empty, empty, address(this));
        governor = new RobynTestnetGovernor(token, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), GUARDIAN);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));
        target = new DaoGovernedValue(address(timelock));
    }

    function testTestnetProfileAndCompleteLifecycle() external {
        require(governor.votingDelay() == 10 minutes, "delay");
        require(governor.votingPeriod() == 30 minutes, "period");
        require(governor.proposalThreshold() == 10_000_000 ether, "threshold");
        require(governor.quorumNumerator() == 10, "quorum");
        require(timelock.getMinDelay() == 10 minutes, "timelock");

        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal(42);
        string memory description = "Testnet assurance execution";
        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        require(uint8(governor.state(proposalId)) == 0, "pending");
        vm.warp(block.timestamp + 10 minutes + 1);
        governor.castVoteWithReason(proposalId, 1, "assurance");
        require(uint8(governor.state(proposalId)) == 1, "active");
        vm.warp(block.timestamp + 30 minutes + 1);
        require(uint8(governor.state(proposalId)) == 4, "succeeded");
        bytes32 descriptionHash = keccak256(bytes(description));
        governor.queue(targets, values, calldatas, descriptionHash);
        require(uint8(governor.state(proposalId)) == 5, "queued");
        try governor.execute(targets, values, calldatas, descriptionHash) {
            revert("early execution accepted");
        } catch {}
        vm.warp(block.timestamp + 10 minutes + 1);
        governor.execute(targets, values, calldatas, descriptionHash);
        require(target.value() == 42, "not executed");
        require(uint8(governor.state(proposalId)) == 7, "not complete");
    }

    function testGuardianCancelsQueuedOperation() external {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal(7);
        string memory description = "Testnet assurance cancellation";
        bytes32 descriptionHash = keccak256(bytes(description));
        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + 10 minutes + 1);
        governor.castVote(proposalId, 1);
        vm.warp(block.timestamp + 30 minutes + 1);
        governor.queue(targets, values, calldatas, descriptionHash);

        bytes32 operationSalt = bytes20(address(governor)) ^ descriptionHash;
        bytes32 operationId = timelock.hashOperationBatch(targets, values, calldatas, bytes32(0), operationSalt);
        vm.prank(GUARDIAN);
        timelock.cancel(operationId);
        require(uint8(governor.state(proposalId)) == 2, "not canceled");
        require(target.value() == 0, "canceled operation executed");
    }

    function _proposal(uint256 value)
        private
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        targets = new address[](1);
        targets[0] = address(target);
        values = new uint256[](1);
        calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(DaoGovernedValue.setValue, (value));
    }
}
