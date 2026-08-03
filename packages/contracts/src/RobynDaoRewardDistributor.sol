// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

interface IRobynCheckpointVotes is IVotes {
    function clock() external view returns (uint48);
}

/// @notice Pull-based Schema-19 DAO rewards for the reused, checkpointed RDAO token.
contract RobynDaoRewardDistributor is ReentrancyGuard {
    string public constant CONTRACT_VERSION = "1.0.0-schema19";

    error Unauthorized();
    error AlreadyBound();
    error InvalidConfiguration();
    error NothingToClaim();
    error RewardAccountingInsolvent(uint256 required, uint256 available);
    error NativeTransferFailed();

    struct Epoch {
        address sourceToken;
        uint64 snapshotBlock;
        uint64 streamStart;
        uint64 streamEnd;
        uint256 amount;
        uint256 claimed;
    }

    IRobynCheckpointVotes public immutable daoToken;
    address public immutable initializer;
    uint256 public immutable rewardStreamDuration;
    address public rewardDepositor;
    uint256 public epochCount;
    uint256 public totalRewardsDeposited;
    uint256 public totalRewardsClaimed;
    mapping(uint256 epochId => Epoch epoch) private _epochs;
    mapping(address account => uint256 epochId) public nextClaimEpoch;
    mapping(uint256 epochId => mapping(address account => uint256 amount)) public claimedByEpoch;

    event RewardDepositorBound(address indexed depositor);
    event RewardsDeposited(
        uint256 indexed epochId,
        address indexed sourceToken,
        uint256 amount,
        uint256 snapshotBlock,
        uint256 streamEnd
    );
    event RewardsClaimed(
        address indexed account, address indexed recipient, uint256 amount, uint256 nextEpoch
    );

    constructor(IVotes daoToken_, uint256 rewardStreamDuration_) {
        if (
            address(daoToken_) == address(0) || address(daoToken_).code.length == 0
                || rewardStreamDuration_ == 0
        ) {
            revert InvalidConfiguration();
        }
        daoToken = IRobynCheckpointVotes(address(daoToken_));
        rewardStreamDuration = rewardStreamDuration_;
        initializer = msg.sender;
    }

    function bindRewardDepositor(address depositor) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (rewardDepositor != address(0)) revert AlreadyBound();
        if (depositor == address(0) || depositor.code.length == 0) revert InvalidConfiguration();
        rewardDepositor = depositor;
        emit RewardDepositorBound(depositor);
    }

    function depositRewards(address sourceToken)
        external
        payable
        nonReentrant
        returns (uint256 epochId)
    {
        if (msg.sender != rewardDepositor) revert Unauthorized();
        if (sourceToken == address(0) || msg.value == 0 || block.number == 0) {
            revert InvalidConfiguration();
        }
        uint256 currentClock = daoToken.clock();
        if (currentClock == 0) revert InvalidConfiguration();
        uint256 snapshotBlock = currentClock - 1;
        epochId = epochCount++;
        _epochs[epochId] = Epoch({
            sourceToken: sourceToken,
            snapshotBlock: uint64(snapshotBlock),
            streamStart: uint64(block.timestamp),
            streamEnd: uint64(block.timestamp + rewardStreamDuration),
            amount: msg.value,
            claimed: 0
        });
        totalRewardsDeposited += msg.value;
        emit RewardsDeposited(
            epochId, sourceToken, msg.value, snapshotBlock, block.timestamp + rewardStreamDuration
        );
    }

    function epoch(uint256 epochId) external view returns (Epoch memory) {
        if (epochId >= epochCount) revert InvalidConfiguration();
        return _epochs[epochId];
    }

    function claim(uint256 maximumEpochs) external returns (uint256 amount) {
        return _claim(msg.sender, payable(msg.sender), maximumEpochs);
    }

    function claimFor(address account, uint256 maximumEpochs) external returns (uint256 amount) {
        if (account == address(0)) revert InvalidConfiguration();
        return _claim(account, payable(account), maximumEpochs);
    }

    function claimable(address account, uint256 maximumEpochs)
        external
        view
        returns (uint256 amount, uint256 nextEpoch)
    {
        if (account == address(0) || maximumEpochs == 0) return (0, nextClaimEpoch[account]);
        (amount, nextEpoch) = _scan(account, maximumEpochs);
    }

    function outstandingLiability() public view returns (uint256) {
        return totalRewardsDeposited - totalRewardsClaimed;
    }

    function _claim(address account, address payable recipient, uint256 maximumEpochs)
        private
        nonReentrant
        returns (uint256 amount)
    {
        if (maximumEpochs == 0) revert InvalidConfiguration();
        uint256 nextEpoch;
        (amount, nextEpoch) = _scan(account, maximumEpochs);
        if (amount == 0) revert NothingToClaim();
        uint256 cursor = nextClaimEpoch[account];
        uint256 stop = cursor + maximumEpochs;
        if (stop > epochCount) stop = epochCount;
        for (uint256 epochId = cursor; epochId < stop; ++epochId) {
            Epoch storage selected = _epochs[epochId];
            uint256 entitlement = _vestedEntitlement(selected, account);
            uint256 previouslyClaimed = claimedByEpoch[epochId][account];
            if (entitlement > previouslyClaimed) {
                uint256 delta = entitlement - previouslyClaimed;
                claimedByEpoch[epochId][account] = entitlement;
                selected.claimed += delta;
            }
            if (block.timestamp < selected.streamEnd) break;
        }
        nextClaimEpoch[account] = nextEpoch;
        totalRewardsClaimed += amount;
        uint256 available = address(this).balance;
        if (available < amount) revert RewardAccountingInsolvent(amount, available);
        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
        emit RewardsClaimed(account, recipient, amount, nextEpoch);
    }

    function _scan(address account, uint256 maximumEpochs)
        private
        view
        returns (uint256 amount, uint256 nextEpoch)
    {
        nextEpoch = nextClaimEpoch[account];
        uint256 stop = nextEpoch + maximumEpochs;
        if (stop > epochCount) stop = epochCount;
        for (uint256 epochId = nextEpoch; epochId < stop; ++epochId) {
            Epoch memory selected = _epochs[epochId];
            uint256 entitlement = _vestedEntitlement(selected, account);
            uint256 previouslyClaimed = claimedByEpoch[epochId][account];
            if (entitlement > previouslyClaimed) amount += entitlement - previouslyClaimed;
            if (block.timestamp < selected.streamEnd) return (amount, epochId);
            nextEpoch = epochId + 1;
        }
    }

    function _vestedEntitlement(Epoch memory selected, address account)
        private
        view
        returns (uint256)
    {
        uint256 elapsed = block.timestamp >= selected.streamEnd
            ? rewardStreamDuration
            : block.timestamp - selected.streamStart;
        uint256 vested = (selected.amount * elapsed) / rewardStreamDuration;
        uint256 supply = daoToken.getPastTotalSupply(selected.snapshotBlock);
        uint256 votes = daoToken.getPastVotes(account, selected.snapshotBlock);
        return supply == 0 ? 0 : (vested * votes) / supply;
    }
}
