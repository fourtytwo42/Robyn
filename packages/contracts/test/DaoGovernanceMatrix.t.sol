// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynGovernor } from "../src/dao/RobynGovernor.sol";
import { DaoGovernedValue } from "./DaoGovernance.t.sol";

interface DaoGovernanceMatrixVm {
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
}

contract DaoGovernanceMatrixTest {
    DaoGovernanceMatrixVm private constant vm =
        DaoGovernanceMatrixVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GUARDIAN = address(0xCAFE);
    address private constant LOW_POWER = address(0x1001);

    RobynDaoToken private token;
    TimelockController private timelock;
    RobynGovernor private governor;
    DaoGovernedValue private target;

    function setUp() external {
        address[] memory recipients = new address[](2);
        recipients[0] = address(this);
        recipients[1] = address(0xBEEF);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 900_000_000 ether;
        amounts[1] = 100_000_000 ether;
        token = new RobynDaoToken(recipients, amounts, 1 hours);
        token.delegate(address(this));
        vm.warp(block.timestamp + 1);

        address[] memory empty = new address[](0);
        timelock = new TimelockController(2 days, empty, empty, address(this));
        governor = new RobynGovernor(token, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), GUARDIAN);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));
        target = new DaoGovernedValue(address(timelock));
    }

    function testBelowThresholdCannotPropose() external {
        token.transfer(LOW_POWER, 5_000_000 ether);
        vm.prank(LOW_POWER);
        token.delegate(LOW_POWER);
        vm.warp(block.timestamp + 1);
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal(1);
        vm.prank(LOW_POWER);
        try governor.propose(targets, values, calldatas, "below threshold") {
            revert("below-threshold proposal accepted");
        } catch { }
    }

    function testNoQuorumAndAgainstVoteAreDefeated() external {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal(2);
        uint256 noQuorum = governor.propose(targets, values, calldatas, "no quorum");
        vm.warp(block.timestamp + 1 days + 1);
        vm.warp(block.timestamp + 3 days + 1);
        require(uint8(governor.state(noQuorum)) == 3, "no-quorum proposal not defeated");

        vm.warp(block.timestamp + 1);
        uint256 against = governor.propose(targets, values, calldatas, "against majority");
        vm.warp(block.timestamp + 1 days + 1);
        governor.castVote(against, 0);
        vm.warp(block.timestamp + 3 days + 1);
        require(uint8(governor.state(against)) == 3, "against proposal not defeated");
    }

    function testDoubleVoteAndInvalidSupportFail() external {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal(3);
        uint256 proposalId = governor.propose(targets, values, calldatas, "vote validation");
        vm.warp(block.timestamp + 1 days + 1);
        try governor.castVote(proposalId, 3) {
            revert("invalid support accepted");
        } catch { }
        governor.castVoteWithReason(proposalId, 1, "tested");
        try governor.castVote(proposalId, 1) {
            revert("double vote accepted");
        } catch { }
        require(governor.hasVoted(proposalId, address(this)), "vote not recorded");
    }

    function testOnlyGovernanceCanChangeGovernorSettings() external {
        try governor.setVotingDelay(2 days) {
            revert("voting delay changed directly");
        } catch { }
        try governor.setVotingPeriod(4 days) {
            revert("voting period changed directly");
        } catch { }
        try governor.setProposalThreshold(2_000_000 ether) {
            revert("proposal threshold changed directly");
        } catch { }
        try governor.updateQuorumNumerator(20) {
            revert("quorum changed directly");
        } catch { }
        try governor.updateTimelock(timelock) {
            revert("timelock changed directly");
        } catch { }
        require(governor.votingDelay() == 1 days, "voting delay mutated");
        require(governor.votingPeriod() == 3 days, "voting period mutated");
        require(governor.quorumNumerator() == 10, "quorum mutated");
    }

    function testGuardianCanCancelQueuedOperationButCannotExecuteEarly() external {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal(4);
        string memory description = "guardian cancellation";
        bytes32 descriptionHash = keccak256(bytes(description));
        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + 1 days + 1);
        governor.castVote(proposalId, 1);
        vm.warp(block.timestamp + 3 days + 1);
        governor.queue(targets, values, calldatas, descriptionHash);
        try governor.execute(targets, values, calldatas, descriptionHash) {
            revert("early execution accepted");
        } catch { }

        bytes32 operationSalt = bytes20(address(governor)) ^ descriptionHash;
        bytes32 operationId =
            timelock.hashOperationBatch(targets, values, calldatas, bytes32(0), operationSalt);
        vm.prank(GUARDIAN);
        timelock.cancel(operationId);
        require(uint8(governor.state(proposalId)) == 2, "guardian cancellation not reflected");
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
