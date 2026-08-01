// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import {
    GovernorCountingSimple
} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {
    GovernorSettings
} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {
    GovernorTimelockControl
} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {
    GovernorVotesQuorumFraction
} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { RobynBootstrapTimelock } from "./RobynBootstrapTimelock.sol";

/// @notice Schema-17 hour-scale Governor with a Timelocked unanimous-owner fast lane.
contract RobynGovernorV2 is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    uint48 public constant INITIAL_VOTING_DELAY = 1 hours;
    uint32 public constant INITIAL_VOTING_PERIOD = 4 hours;
    uint256 public constant INITIAL_PROPOSAL_THRESHOLD = 10_000_000 ether;
    uint256 public constant INITIAL_QUORUM_NUMERATOR = 10;

    error UnanimousOwnershipRequired();
    error BootstrapStillActive();
    error InvalidUnanimousOperation();

    uint256 public unanimousNonce;
    mapping(bytes32 operationId => address owner) public unanimousOperationOwner;

    event UnanimousOperationScheduled(
        bytes32 indexed operationId,
        address indexed owner,
        uint48 indexed snapshot,
        uint256 nonce,
        bytes32 descriptionHash,
        bytes32 salt,
        uint256 delay
    );

    constructor(IVotes token_, RobynBootstrapTimelock timelock_)
        Governor("Robyn Governor")
        GovernorSettings(INITIAL_VOTING_DELAY, INITIAL_VOTING_PERIOD, INITIAL_PROPOSAL_THRESHOLD)
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(INITIAL_QUORUM_NUMERATOR)
        GovernorTimelockControl(timelock_)
    { }

    function scheduleUnanimous(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) external returns (bytes32 operationId) {
        if (
            targets.length == 0 || targets.length != values.length
                || targets.length != calldatas.length
        ) {
            revert InvalidUnanimousOperation();
        }
        RobynBootstrapTimelock controller = RobynBootstrapTimelock(payable(timelock()));
        if (!controller.bootstrapFinalized()) revert BootstrapStillActive();

        uint48 snapshot = _requireUnanimousOwner(msg.sender);
        uint256 nonce = unanimousNonce++;
        bytes32 salt =
            _unanimousSalt(nonce, msg.sender, targets, values, calldatas, descriptionHash);
        uint256 delay = controller.getMinDelay();
        controller.scheduleBatch(targets, values, calldatas, bytes32(0), salt, delay);
        operationId = controller.hashOperationBatch(targets, values, calldatas, bytes32(0), salt);
        unanimousOperationOwner[operationId] = msg.sender;
        emit UnanimousOperationScheduled(
            operationId, msg.sender, snapshot, nonce, descriptionHash, salt, delay
        );
    }

    function _requireUnanimousOwner(address account) private view returns (uint48 snapshot) {
        IERC20 dao = IERC20(address(token()));
        uint256 supply = dao.totalSupply();
        if (supply == 0 || dao.balanceOf(account) != supply) {
            revert UnanimousOwnershipRequired();
        }
        uint48 currentClock = clock();
        if (currentClock == 0) revert UnanimousOwnershipRequired();
        snapshot = currentClock - 1;
        if (
            token().getPastTotalSupply(snapshot) != supply
                || token().getPastVotes(account, snapshot) != supply
        ) revert UnanimousOwnershipRequired();
    }

    function _unanimousSalt(
        uint256 nonce,
        address account,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                "ROBYN_SCHEMA17_UNANIMOUS_OPERATION",
                block.chainid,
                address(this),
                nonce,
                account,
                targets,
                values,
                calldatas,
                descriptionHash
            )
        );
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId) public view override(Governor) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
