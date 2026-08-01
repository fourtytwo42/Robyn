// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { RobynBootstrapTimelock } from "../src/dao/RobynBootstrapTimelock.sol";
import { RobynDaoTokenV2 } from "../src/dao/RobynDaoTokenV2.sol";
import { RobynGovernorV2 } from "../src/dao/RobynGovernorV2.sol";

contract Schema17GovernedTarget {
    error Unauthorized();
    error ForcedFailure();

    address public controller;
    uint256 public value;

    function bindController(address controller_) external {
        require(controller == address(0) && controller_ != address(0), "bind");
        controller = controller_;
    }

    function setValue(uint256 value_) external {
        if (msg.sender != controller) revert Unauthorized();
        value = value_;
    }

    function fail() external pure {
        revert ForcedFailure();
    }
}

contract Schema17BootstrapGovernanceTest is Test {
    address private constant GUARDIAN = address(0xCAFE);
    address private constant RECIPIENT = address(0xBEEF);
    bytes32 private constant DOMAIN = keccak256("SCHEMA17_BOOTSTRAP_TEST");

    RobynDaoTokenV2 private token;
    RobynBootstrapTimelock private timelock;
    RobynGovernorV2 private governor;
    Schema17GovernedTarget private target;

    address[] private step0Targets;
    uint256[] private step0Values;
    bytes[] private step0Payloads;
    address[] private step1Targets;
    uint256[] private step1Values;
    bytes[] private step1Payloads;

    function setUp() external {
        target = new Schema17GovernedTarget();
        token = _newToken();

        step0Targets.push(address(target));
        step0Values.push(0);
        step0Payloads.push(abi.encodeCall(Schema17GovernedTarget.setValue, (1)));
        step1Targets.push(address(target));
        step1Values.push(0);
        step1Payloads.push(abi.encodeCall(Schema17GovernedTarget.setValue, (2)));

        bytes32[2] memory hashes;
        hashes[0] = _planHash(0, step0Targets, step0Values, step0Payloads);
        hashes[1] = _planHash(1, step1Targets, step1Values, step1Payloads);
        timelock = new RobynBootstrapTimelock(token, address(this), GUARDIAN, DOMAIN, hashes);
        token.bindBootstrapController(address(timelock));
        target.bindController(address(timelock));

        governor = new RobynGovernorV2(token, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), GUARDIAN);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));
    }

    function testBootstrapExecutesOnlyExactSequentialPlansAndFinalizes() external {
        assertTrue(timelock.bootstrapActive());
        timelock.executeBootstrapStep(0, step0Targets, step0Values, step0Payloads);
        assertEq(target.value(), 1);
        assertEq(timelock.nextBootstrapStep(), 1);
        assertFalse(timelock.bootstrapFinalized());

        timelock.executeBootstrapStep(1, step1Targets, step1Values, step1Payloads);
        assertEq(target.value(), 2);
        assertTrue(timelock.bootstrapFinalized());
        assertEq(timelock.bootstrapFinalizationReason(), timelock.REASON_PLAN_COMPLETE());

        vm.expectRevert(RobynBootstrapTimelock.BootstrapInactive.selector);
        timelock.executeBootstrapStep(1, step1Targets, step1Values, step1Payloads);
    }

    function testWrongStepPayloadCallerAndValueFailClosed() external {
        vm.expectRevert(
            abi.encodeWithSelector(RobynBootstrapTimelock.InvalidBootstrapStep.selector, 0, 1)
        );
        timelock.executeBootstrapStep(1, step1Targets, step1Values, step1Payloads);

        bytes[] memory wrongPayloads = new bytes[](1);
        wrongPayloads[0] = abi.encodeCall(Schema17GovernedTarget.setValue, (99));
        bytes32 expectedPlan = timelock.bootstrapPlanHash(0);
        bytes32 suppliedPlan =
            timelock.hashBootstrapStep(0, step0Targets, step0Values, wrongPayloads);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobynBootstrapTimelock.BootstrapPlanMismatch.selector, expectedPlan, suppliedPlan
            )
        );
        timelock.executeBootstrapStep(0, step0Targets, step0Values, wrongPayloads);

        vm.prank(RECIPIENT);
        vm.expectRevert(RobynBootstrapTimelock.Unauthorized.selector);
        timelock.executeBootstrapStep(0, step0Targets, step0Values, step0Payloads);

        (RobynDaoTokenV2 freshToken, RobynBootstrapTimelock freshTimelock) = _deployValuePlan();
        freshToken;
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 1;
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(Schema17GovernedTarget.setValue, (3));
        vm.expectRevert(RobynBootstrapTimelock.BootstrapValueNotAllowed.selector);
        freshTimelock.executeBootstrapStep(0, targets, values, payloads);
    }

    function testFirstDistributionFinalizesAndReacquisitionCannotReactivate() external {
        token.transfer(RECIPIENT, 1);
        assertTrue(timelock.bootstrapFinalized());
        assertEq(timelock.bootstrapFinalizationReason(), timelock.REASON_RDAO_DISTRIBUTED());
        vm.prank(RECIPIENT);
        token.transfer(address(this), 1);
        assertEq(token.balanceOf(address(this)), token.totalSupply());
        assertFalse(timelock.bootstrapActive());
        vm.expectRevert(RobynBootstrapTimelock.BootstrapInactive.selector);
        timelock.executeBootstrapStep(0, step0Targets, step0Values, step0Payloads);
    }

    function testBootstrapControllerBindingRejectsMismatchedController() external {
        RobynDaoTokenV2 firstToken = _newToken();
        RobynDaoTokenV2 secondToken = _newToken();
        bytes32[2] memory hashes = [keccak256("mismatch-0"), keccak256("mismatch-1")];
        RobynBootstrapTimelock secondTimelock =
            new RobynBootstrapTimelock(secondToken, address(this), GUARDIAN, DOMAIN, hashes);

        vm.expectRevert(bytes4(keccak256("InvalidConfiguration()")));
        firstToken.bindBootstrapController(address(secondTimelock));
        secondToken.bindBootstrapController(address(secondTimelock));
        vm.expectRevert(RobynDaoTokenV2.BootstrapControllerAlreadyBound.selector);
        secondToken.bindBootstrapController(address(secondTimelock));
    }

    function testGuardianOwnerAndExpiryFinalizationPaths() external {
        vm.prank(GUARDIAN);
        timelock.abortBootstrap();
        assertEq(timelock.bootstrapFinalizationReason(), timelock.REASON_GUARDIAN_ABORTED());

        (RobynDaoTokenV2 ownerToken, RobynBootstrapTimelock ownerTimelock) = _deployEmptyTargets();
        ownerToken;
        ownerTimelock.finalizeBootstrap();
        assertEq(
            ownerTimelock.bootstrapFinalizationReason(), ownerTimelock.REASON_OWNER_FINALIZED()
        );

        (RobynDaoTokenV2 expiredToken, RobynBootstrapTimelock expiredTimelock) =
            _deployEmptyTargets();
        expiredToken;
        vm.warp(block.timestamp + 48 hours + 1);
        expiredTimelock.finalizeExpiredBootstrap();
        assertEq(expiredTimelock.bootstrapFinalizationReason(), expiredTimelock.REASON_EXPIRED());
    }

    function testRevertingBootstrapBatchRollsBackStateAndStep() external {
        Schema17GovernedTarget first = new Schema17GovernedTarget();
        Schema17GovernedTarget second = new Schema17GovernedTarget();
        RobynDaoTokenV2 freshToken = _newToken();
        address[] memory targets = new address[](2);
        targets[0] = address(first);
        targets[1] = address(second);
        uint256[] memory values = new uint256[](2);
        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeCall(Schema17GovernedTarget.setValue, (7));
        payloads[1] = abi.encodeCall(Schema17GovernedTarget.fail, ());
        bytes32[2] memory hashes;
        hashes[0] = _planHash(0, targets, values, payloads);
        hashes[1] = keccak256("unused-step");
        RobynBootstrapTimelock freshTimelock =
            new RobynBootstrapTimelock(freshToken, address(this), GUARDIAN, DOMAIN, hashes);
        freshToken.bindBootstrapController(address(freshTimelock));
        first.bindController(address(freshTimelock));
        second.bindController(address(freshTimelock));

        vm.expectRevert(Schema17GovernedTarget.ForcedFailure.selector);
        freshTimelock.executeBootstrapStep(0, targets, values, payloads);
        assertEq(first.value(), 0);
        assertEq(freshTimelock.nextBootstrapStep(), 0);
        assertFalse(freshTimelock.bootstrapFinalized());
    }

    function testUnanimousOwnerSkipsVoteButNotTimelock() external {
        timelock.finalizeBootstrap();
        token.delegate(address(this));
        vm.warp(block.timestamp + 2);
        bytes32 descriptionHash = keccak256("unanimous operation");
        uint256 nonce = governor.unanimousNonce();
        bytes32 salt = _unanimousSalt(
            nonce, address(this), step0Targets, step0Values, step0Payloads, descriptionHash
        );
        bytes32 operationId =
            governor.scheduleUnanimous(step0Targets, step0Values, step0Payloads, descriptionHash);
        assertEq(
            operationId,
            timelock.hashOperationBatch(step0Targets, step0Values, step0Payloads, bytes32(0), salt)
        );
        assertEq(governor.unanimousOperationOwner(operationId), address(this));

        vm.expectRevert();
        timelock.executeBatch(step0Targets, step0Values, step0Payloads, bytes32(0), salt);
        vm.warp(block.timestamp + 1 hours);
        timelock.executeBatch(step0Targets, step0Values, step0Payloads, bytes32(0), salt);
        assertEq(target.value(), 1);
    }

    function testGuardianCanCancelUnanimousOperation() external {
        timelock.finalizeBootstrap();
        token.delegate(address(this));
        vm.warp(block.timestamp + 2);
        bytes32 descriptionHash = keccak256("cancel unanimous operation");
        uint256 nonce = governor.unanimousNonce();
        bytes32 salt = _unanimousSalt(
            nonce, address(this), step0Targets, step0Values, step0Payloads, descriptionHash
        );
        bytes32 operationId =
            governor.scheduleUnanimous(step0Targets, step0Values, step0Payloads, descriptionHash);

        vm.prank(GUARDIAN);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert();
        timelock.executeBatch(step0Targets, step0Values, step0Payloads, bytes32(0), salt);
        assertEq(target.value(), 0);
    }

    function testPartialMissingOrSameTimestampVotesCannotUseUnanimousPath() external {
        timelock.finalizeBootstrap();
        vm.expectRevert(RobynGovernorV2.UnanimousOwnershipRequired.selector);
        governor.scheduleUnanimous(
            step0Targets, step0Values, step0Payloads, keccak256("no delegation")
        );

        token.delegate(address(this));
        token.transfer(RECIPIENT, 1);
        vm.warp(block.timestamp + 2);
        vm.expectRevert(RobynGovernorV2.UnanimousOwnershipRequired.selector);
        governor.scheduleUnanimous(step0Targets, step0Values, step0Payloads, keccak256("partial"));

        vm.prank(RECIPIENT);
        token.transfer(address(this), 1);
        vm.expectRevert(RobynGovernorV2.UnanimousOwnershipRequired.selector);
        governor.scheduleUnanimous(
            step0Targets, step0Values, step0Payloads, keccak256("same timestamp")
        );
    }

    function testHourDefaultsAndGovernanceCanChangeThem() external {
        timelock.finalizeBootstrap();
        token.delegate(address(this));
        vm.warp(block.timestamp + 2);
        assertEq(governor.votingDelay(), 1 hours);
        assertEq(governor.votingPeriod(), 4 hours);
        assertEq(governor.proposalThreshold(), 10_000_000 ether);
        assertEq(governor.quorumNumerator(), 10);
        assertEq(timelock.getMinDelay(), 1 hours);

        vm.prank(RECIPIENT);
        vm.expectRevert();
        governor.setVotingDelay(uint48(30 minutes));
        vm.prank(RECIPIENT);
        vm.expectRevert();
        timelock.updateDelay(30 minutes);

        address[] memory targets = new address[](5);
        targets[0] = address(governor);
        targets[1] = address(timelock);
        targets[2] = address(governor);
        targets[3] = address(governor);
        targets[4] = address(governor);
        uint256[] memory values = new uint256[](5);
        bytes[] memory payloads = new bytes[](5);
        payloads[0] = abi.encodeWithSignature("setVotingPeriod(uint32)", uint32(2 hours));
        payloads[1] = abi.encodeWithSignature("updateDelay(uint256)", 2 hours);
        payloads[2] = abi.encodeWithSignature("setVotingDelay(uint48)", uint48(30 minutes));
        payloads[3] = abi.encodeWithSignature("setProposalThreshold(uint256)", 5_000_000 ether);
        payloads[4] = abi.encodeWithSignature("updateQuorumNumerator(uint256)", 20);
        string memory description = "change governance clocks";
        bytes32 descriptionHash = keccak256(bytes(description));
        uint256 proposalId = governor.propose(targets, values, payloads, description);
        vm.warp(block.timestamp + 1 hours + 1);
        governor.castVote(proposalId, 1);
        vm.warp(block.timestamp + 4 hours + 1);
        governor.queue(targets, values, payloads, descriptionHash);
        vm.warp(block.timestamp + 1 hours + 1);
        governor.execute(targets, values, payloads, descriptionHash);
        assertEq(governor.votingDelay(), 30 minutes);
        assertEq(governor.votingPeriod(), 2 hours);
        assertEq(governor.proposalThreshold(), 5_000_000 ether);
        assertEq(governor.quorumNumerator(), 20);
        assertEq(timelock.getMinDelay(), 2 hours);
    }

    function _newToken() private returns (RobynDaoTokenV2 created) {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_000_000 ether;
        created = new RobynDaoTokenV2(recipients, amounts, 1 hours, address(this));
    }

    function _deployEmptyTargets()
        private
        returns (RobynDaoTokenV2 createdToken, RobynBootstrapTimelock createdTimelock)
    {
        createdToken = _newToken();
        bytes32[2] memory hashes = [keccak256("empty-0"), keccak256("empty-1")];
        createdTimelock =
            new RobynBootstrapTimelock(createdToken, address(this), GUARDIAN, DOMAIN, hashes);
        createdToken.bindBootstrapController(address(createdTimelock));
    }

    function _deployValuePlan()
        private
        returns (RobynDaoTokenV2 createdToken, RobynBootstrapTimelock createdTimelock)
    {
        createdToken = _newToken();
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        values[0] = 1;
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(Schema17GovernedTarget.setValue, (3));
        bytes32[2] memory hashes;
        hashes[0] = _planHash(0, targets, values, payloads);
        hashes[1] = keccak256("unused-value-step");
        createdTimelock =
            new RobynBootstrapTimelock(createdToken, address(this), GUARDIAN, DOMAIN, hashes);
        createdToken.bindBootstrapController(address(createdTimelock));
    }

    function _planHash(
        uint8 step,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory payloads
    ) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, DOMAIN, step, targets, values, payloads));
    }

    function _unanimousSalt(
        uint256 nonce,
        address account,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory payloads,
        bytes32 descriptionHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                "ROBYN_SCHEMA17_UNANIMOUS_OPERATION",
                block.chainid,
                address(governor),
                nonce,
                account,
                targets,
                values,
                payloads,
                descriptionHash
            )
        );
    }
}
