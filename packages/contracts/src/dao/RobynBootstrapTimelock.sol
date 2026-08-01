// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice One-hour governance timelock with two exact, deployment-only bootstrap batches.
contract RobynBootstrapTimelock is TimelockController, ReentrancyGuard {
    using Address for address;

    uint256 public constant STANDARD_MIN_DELAY = 1 hours;
    uint256 public constant BOOTSTRAP_WINDOW = 48 hours;

    bytes32 public constant REASON_PLAN_COMPLETE = keccak256("BOOTSTRAP_PLAN_COMPLETE");
    bytes32 public constant REASON_OWNER_FINALIZED = keccak256("BOOTSTRAP_OWNER_FINALIZED");
    bytes32 public constant REASON_GUARDIAN_ABORTED = keccak256("BOOTSTRAP_GUARDIAN_ABORTED");
    bytes32 public constant REASON_RDAO_DISTRIBUTED = keccak256("BOOTSTRAP_RDAO_DISTRIBUTED");
    bytes32 public constant REASON_EXPIRED = keccak256("BOOTSTRAP_EXPIRED");

    error Unauthorized();
    error InvalidConfiguration();
    error BootstrapInactive();
    error InvalidBootstrapStep(uint8 expected, uint8 supplied);
    error BootstrapPlanMismatch(bytes32 expected, bytes32 supplied);
    error BootstrapValueNotAllowed();

    IERC20 public immutable bootstrapToken;
    address public immutable bootstrapOwner;
    address public immutable guardian;
    bytes32 public immutable bootstrapDomain;
    uint48 public immutable bootstrapDeadline;
    bytes32[2] private _bootstrapPlanHashes;

    uint8 public nextBootstrapStep;
    bool public bootstrapFinalized;
    bytes32 public bootstrapFinalizationReason;

    event BootstrapStepExecuted(
        uint8 indexed step, bytes32 indexed planHash, address indexed caller
    );
    event BootstrapFinalized(bytes32 indexed reason, address indexed caller, uint8 completedSteps);

    constructor(
        IERC20 bootstrapToken_,
        address bootstrapOwner_,
        address guardian_,
        bytes32 bootstrapDomain_,
        bytes32[2] memory bootstrapPlanHashes_
    ) TimelockController(STANDARD_MIN_DELAY, new address[](0), new address[](0), bootstrapOwner_) {
        if (
            address(bootstrapToken_) == address(0) || address(bootstrapToken_).code.length == 0
                || bootstrapOwner_ == address(0) || guardian_ == address(0)
                || guardian_ == bootstrapOwner_ || bootstrapDomain_ == bytes32(0)
                || bootstrapPlanHashes_[0] == bytes32(0) || bootstrapPlanHashes_[1] == bytes32(0)
                || bootstrapPlanHashes_[0] == bootstrapPlanHashes_[1]
        ) revert InvalidConfiguration();
        bootstrapToken = bootstrapToken_;
        bootstrapOwner = bootstrapOwner_;
        guardian = guardian_;
        bootstrapDomain = bootstrapDomain_;
        bootstrapDeadline = uint48(block.timestamp + BOOTSTRAP_WINDOW);
        _bootstrapPlanHashes = bootstrapPlanHashes_;
    }

    function bootstrapPlanHash(uint8 step) external view returns (bytes32) {
        if (step > 1) revert InvalidBootstrapStep(nextBootstrapStep, step);
        return _bootstrapPlanHashes[step];
    }

    function hashBootstrapStep(
        uint8 step,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, bootstrapDomain, step, targets, values, payloads)
        );
    }

    function bootstrapActive() public view returns (bool) {
        uint256 supply = bootstrapToken.totalSupply();
        return !bootstrapFinalized && nextBootstrapStep < 2 && block.timestamp <= bootstrapDeadline
            && supply != 0 && bootstrapToken.balanceOf(bootstrapOwner) == supply;
    }

    function executeBootstrapStep(
        uint8 step,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads
    ) external nonReentrant {
        if (msg.sender != bootstrapOwner) revert Unauthorized();
        if (!bootstrapActive()) revert BootstrapInactive();
        if (step != nextBootstrapStep) revert InvalidBootstrapStep(nextBootstrapStep, step);
        if (
            targets.length == 0 || targets.length != values.length
                || targets.length != payloads.length
        ) {
            revert InvalidConfiguration();
        }
        bytes32 suppliedHash = hashBootstrapStep(step, targets, values, payloads);
        bytes32 expectedHash = _bootstrapPlanHashes[step];
        if (suppliedHash != expectedHash) revert BootstrapPlanMismatch(expectedHash, suppliedHash);

        nextBootstrapStep = step + 1;
        for (uint256 index; index < targets.length; ++index) {
            if (values[index] != 0) revert BootstrapValueNotAllowed();
            if (targets[index] == address(0) || targets[index] == address(this)) {
                revert InvalidConfiguration();
            }
            targets[index].functionCall(payloads[index]);
        }
        emit BootstrapStepExecuted(step, suppliedHash, msg.sender);
        if (nextBootstrapStep == 2) _finalize(REASON_PLAN_COMPLETE);
    }

    function finalizeBootstrap() external {
        if (msg.sender != bootstrapOwner) revert Unauthorized();
        _finalize(REASON_OWNER_FINALIZED);
    }

    function abortBootstrap() external {
        if (msg.sender != guardian) revert Unauthorized();
        _finalize(REASON_GUARDIAN_ABORTED);
    }

    function finalizeBootstrapFromToken() external {
        if (msg.sender != address(bootstrapToken)) revert Unauthorized();
        if (!bootstrapFinalized) _finalize(REASON_RDAO_DISTRIBUTED);
    }

    function finalizeExpiredBootstrap() external {
        if (block.timestamp <= bootstrapDeadline) revert BootstrapInactive();
        _finalize(REASON_EXPIRED);
    }

    function _finalize(bytes32 reason) private {
        if (bootstrapFinalized) revert BootstrapInactive();
        bootstrapFinalized = true;
        bootstrapFinalizationReason = reason;
        emit BootstrapFinalized(reason, msg.sender, nextBootstrapStep);
    }
}
