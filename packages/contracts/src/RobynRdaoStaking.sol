// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynRdaoStakeEscrow } from "./RobynRdaoStakeEscrow.sol";

interface IRobynWrappedNative is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IRobynVotesToken is IVotes {
    function delegates(address account) external view returns (address);
}

/// @notice Vote-preserving RDAO staking with exact WETH-backed pull rewards.
contract RobynRdaoStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "1.0.0-schema20";
    uint256 private constant MAGNITUDE = 1 << 128;

    error Unauthorized();
    error InvalidConfiguration();
    error SourcesSealed();
    error SourcesNotSealed();
    error Paused();
    error NothingToActivate();
    error WarmupIncomplete(uint256 readyAt);
    error NothingToClaim();
    error InsufficientStake();
    error RewardAccountingInsolvent(uint256 required, uint256 available);

    struct Position {
        uint256 eligible;
        uint256 warming;
        uint64 activationTime;
        uint256 rewardPerTokenPaid;
        uint256 rewardRemainder;
        uint256 accrued;
    }

    struct Stream {
        uint64 start;
        uint64 end;
        uint64 lastUpdate;
        uint256 total;
        uint256 released;
    }

    struct WarmupLot {
        uint128 amount;
        uint64 readyAt;
    }

    IERC20 public immutable rdao;
    IRobynWrappedNative public immutable wrappedNative;
    address public immutable governance;
    address public immutable guardian;
    address public immutable initializer;
    address public immutable escrowImplementation;
    uint256 public immutable warmupDuration;
    uint256 public immutable rewardStreamDuration;
    uint256 public immutable zeroSupplyStreamDuration;

    bool public paused;
    bool public rewardSourcesSealed;
    uint256 public totalPrincipal;
    uint256 public totalEligibleStake;
    uint256 public totalWarmingStake;
    uint256 public queuedRewards;
    uint256 public rewardPerTokenStored;
    uint256 public distributionRemainder;
    uint256 public totalRewardsDeposited;
    uint256 public totalRewardsClaimed;
    uint256 public rewardDepositCount;
    Stream public ordinaryStream;
    Stream public zeroSupplyStream;

    mapping(address account => Position position) private _positions;
    mapping(address account => WarmupLot[] lots) private _warmupLots;
    mapping(address account => uint256 cursor) private _warmupCursor;
    mapping(address account => address escrow) public escrowOf;
    mapping(address source => bool allowed) public isRewardSource;

    event RewardSourceConfigured(address indexed source, bool allowed);
    event RewardSourcesSealed();
    event PauseChanged(bool paused, address indexed caller);
    event EscrowCreated(address indexed account, address indexed escrow, address indexed delegatee);
    event Staked(
        address indexed account,
        address indexed escrow,
        uint256 amount,
        uint256 activationTime,
        address delegatee
    );
    event StakeActivated(address indexed account, uint256 amount, uint256 totalEligibleStake);
    event Unstaked(
        address indexed account,
        address indexed recipient,
        uint256 amount,
        uint256 eligibleRemaining,
        uint256 warmingRemaining
    );
    event StakeDelegateChanged(address indexed account, address indexed delegatee);
    event RewardsDeposited(
        address indexed source,
        address indexed sourceToken,
        uint256 amount,
        bool queued,
        uint256 cumulativeDeposited
    );
    event QueuedRewardsActivated(uint256 amount, uint256 streamEnd);
    event RewardsClaimed(address indexed account, address indexed recipient, uint256 amount);
    event LegacyRewardsForwarded(address indexed account, address indexed recipient, uint256 amount);

    constructor(
        IERC20 rdao_,
        IRobynWrappedNative wrappedNative_,
        address governance_,
        address guardian_,
        uint256 warmupDuration_,
        uint256 rewardStreamDuration_,
        uint256 zeroSupplyStreamDuration_
    ) {
        if (
            address(rdao_) == address(0) || address(rdao_).code.length == 0
                || address(wrappedNative_) == address(0) || address(wrappedNative_).code.length == 0
                || governance_ == address(0) || guardian_ == address(0) || warmupDuration_ == 0
                || rewardStreamDuration_ == 0 || zeroSupplyStreamDuration_ == 0
                || warmupDuration_ > 30 days || rewardStreamDuration_ > 7 days
                || zeroSupplyStreamDuration_ > 30 days
        ) revert InvalidConfiguration();
        rdao = rdao_;
        wrappedNative = wrappedNative_;
        governance = governance_;
        guardian = guardian_;
        initializer = msg.sender;
        warmupDuration = warmupDuration_;
        rewardStreamDuration = rewardStreamDuration_;
        zeroSupplyStreamDuration = zeroSupplyStreamDuration_;
        escrowImplementation = address(new RobynRdaoStakeEscrow());
    }

    receive() external payable {
        if (msg.sender != address(wrappedNative)) revert Unauthorized();
    }

    function configureRewardSource(address source, bool allowed) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (rewardSourcesSealed) revert SourcesSealed();
        if (source == address(0) || source.code.length == 0) revert InvalidConfiguration();
        isRewardSource[source] = allowed;
        emit RewardSourceConfigured(source, allowed);
    }

    function sealRewardSources() external {
        if (msg.sender != initializer) revert Unauthorized();
        if (rewardSourcesSealed) revert SourcesSealed();
        rewardSourcesSealed = true;
        emit RewardSourcesSealed();
    }

    function setPaused(bool paused_) external {
        if (paused_) {
            if (msg.sender != guardian && msg.sender != governance) revert Unauthorized();
        } else if (msg.sender != governance) revert Unauthorized();
        paused = paused_;
        emit PauseChanged(paused_, msg.sender);
    }

    function predictEscrow(address account) public view returns (address) {
        if (account == address(0)) return address(0);
        return Clones.predictDeterministicAddress(
            escrowImplementation, keccak256(abi.encode(block.chainid, address(this), account))
        );
    }

    function position(address account)
        external
        view
        returns (
            address escrow,
            uint256 eligible,
            uint256 warming,
            uint256 activationTime,
            address delegatee,
            uint256 claimable
        )
    {
        Position memory selected = _positions[account];
        escrow = escrowOf[account];
        eligible = selected.eligible;
        warming = selected.warming;
        activationTime = selected.activationTime;
        delegatee = escrow == address(0)
            ? address(0)
            : IRobynVotesToken(address(rdao)).delegates(escrow);
        claimable = earned(account);
    }

    function warmupLotCount(address account) external view returns (uint256) {
        return _warmupLots[account].length - _warmupCursor[account];
    }

    function warmupLot(address account, uint256 index)
        external
        view
        returns (uint256 amount, uint256 readyAt)
    {
        WarmupLot memory lot = _warmupLots[account][_warmupCursor[account] + index];
        return (lot.amount, lot.readyAt);
    }

    function stake(uint256 amount, address delegatee) external nonReentrant {
        _stake(msg.sender, amount, delegatee);
    }

    function stakeWithPermit(
        uint256 amount,
        address delegatee,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        IERC20Permit(address(rdao)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _stake(msg.sender, amount, delegatee);
    }

    function activateFor(address account) public nonReentrant returns (uint256 amount) {
        amount = _activate(account, true);
    }

    function unstake(uint256 amount, address recipient) external nonReentrant {
        if (amount == 0 || recipient == address(0)) revert InvalidConfiguration();
        _updateAccount(msg.sender);
        _activate(msg.sender, false);
        Position storage selected = _positions[msg.sender];
        if (amount > selected.eligible + selected.warming) revert InsufficientStake();
        uint256 fromWarming = Math.min(amount, selected.warming);
        if (fromWarming != 0) {
            _removeWarmingFromNewest(msg.sender, fromWarming);
            selected.warming -= fromWarming;
            totalWarmingStake -= fromWarming;
        }
        uint256 fromEligible = amount - fromWarming;
        if (fromEligible != 0) {
            selected.eligible -= fromEligible;
            totalEligibleStake -= fromEligible;
            if (totalEligibleStake == 0) _queueRemainingStreams();
        }
        if (selected.warming == 0) selected.activationTime = 0;
        totalPrincipal -= amount;
        RobynRdaoStakeEscrow(escrowOf[msg.sender]).release(recipient, amount);
        emit Unstaked(
            msg.sender, recipient, amount, selected.eligible, selected.warming
        );
    }

    function setDelegate(address delegatee) external nonReentrant {
        if (delegatee == address(0)) revert InvalidConfiguration();
        address escrow = escrowOf[msg.sender];
        if (escrow == address(0)) revert InsufficientStake();
        RobynRdaoStakeEscrow(escrow).setDelegate(delegatee);
        emit StakeDelegateChanged(msg.sender, delegatee);
    }

    function depositRewards(address sourceToken)
        external
        payable
        nonReentrant
        returns (uint256 depositId)
    {
        if (!rewardSourcesSealed) revert SourcesNotSealed();
        if (paused) revert Paused();
        if (!isRewardSource[msg.sender]) revert Unauthorized();
        if (sourceToken == address(0) || msg.value == 0) revert InvalidConfiguration();
        _updateGlobal();
        wrappedNative.deposit{ value: msg.value }();
        depositId = rewardDepositCount++;
        totalRewardsDeposited += msg.value;
        bool queued = totalEligibleStake == 0;
        if (queued) queuedRewards += msg.value;
        else _startOrExtend(ordinaryStream, msg.value, rewardStreamDuration);
        emit RewardsDeposited(
            msg.sender, sourceToken, msg.value, queued, totalRewardsDeposited
        );
    }

    function depositWrappedRewards(address sourceToken, uint256 amount) external nonReentrant {
        if (!rewardSourcesSealed) revert SourcesNotSealed();
        if (paused) revert Paused();
        if (!isRewardSource[msg.sender]) revert Unauthorized();
        if (sourceToken == address(0) || amount == 0) revert InvalidConfiguration();
        _updateGlobal();
        IERC20(address(wrappedNative)).safeTransferFrom(msg.sender, address(this), amount);
        totalRewardsDeposited += amount;
        bool queued = totalEligibleStake == 0;
        if (queued) queuedRewards += amount;
        else _startOrExtend(ordinaryStream, amount, rewardStreamDuration);
        emit RewardsDeposited(msg.sender, sourceToken, amount, queued, totalRewardsDeposited);
    }

    function activateQueuedRewards() external nonReentrant returns (uint256 amount) {
        _updateGlobal();
        amount = _activateQueuedRewards();
    }

    function claim() external returns (uint256 amount) {
        return _claim(msg.sender, msg.sender);
    }

    function claimFor(address account) external returns (uint256 amount) {
        if (account == address(0)) revert InvalidConfiguration();
        return _claim(account, account);
    }

    function claimTo(address recipient) external returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidConfiguration();
        return _claim(msg.sender, recipient);
    }

    function forwardLegacyRewards(address payable recipient)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (recipient == address(0)) revert InvalidConfiguration();
        address escrow = escrowOf[msg.sender];
        if (escrow == address(0)) revert InsufficientStake();
        amount = RobynRdaoStakeEscrow(escrow).forwardLegacyRewards(recipient);
        emit LegacyRewardsForwarded(msg.sender, recipient, amount);
    }

    function earned(address account) public view returns (uint256 amount) {
        Position memory selected = _positions[account];
        uint256 current = currentRewardPerToken();
        uint256 numerator =
            selected.eligible * (current - selected.rewardPerTokenPaid) + selected.rewardRemainder;
        amount = selected.accrued + numerator / MAGNITUDE;
    }

    function currentRewardPerToken() public view returns (uint256) {
        if (totalEligibleStake == 0) return rewardPerTokenStored;
        uint256 newlyReleased = _newlyReleased(ordinaryStream) + _newlyReleased(zeroSupplyStream);
        return rewardPerTokenStored
            + (newlyReleased * MAGNITUDE + distributionRemainder) / totalEligibleStake;
    }

    function outstandingLiability() public view returns (uint256) {
        return totalRewardsDeposited - totalRewardsClaimed;
    }

    function rewardAccountingState()
        external
        view
        returns (
            uint256 deposited,
            uint256 claimed,
            uint256 queued,
            uint256 ordinaryUnvested,
            uint256 zeroSupplyUnvested,
            uint256 backing,
            uint256 outstanding,
            uint256 surplus,
            uint256 deficit,
            uint256 roundingCarry
        )
    {
        deposited = totalRewardsDeposited;
        claimed = totalRewardsClaimed;
        queued = queuedRewards;
        ordinaryUnvested = ordinaryStream.total - _vested(ordinaryStream);
        zeroSupplyUnvested = zeroSupplyStream.total - _vested(zeroSupplyStream);
        backing = wrappedNative.balanceOf(address(this));
        outstanding = outstandingLiability();
        if (backing >= outstanding) surplus = backing - outstanding;
        else deficit = outstanding - backing;
        roundingCarry = distributionRemainder;
    }

    function _stake(address account, uint256 amount, address delegatee) private {
        if (paused) revert Paused();
        if (amount == 0 || delegatee == address(0)) revert InvalidConfiguration();
        _updateAccount(account);
        _activate(account, false);
        address escrow = escrowOf[account];
        if (escrow == address(0)) {
            bytes32 salt = keccak256(abi.encode(block.chainid, address(this), account));
            escrow = Clones.cloneDeterministic(escrowImplementation, salt);
            RobynRdaoStakeEscrow(escrow).initialize(rdao, address(this), account, delegatee);
            escrowOf[account] = escrow;
            emit EscrowCreated(account, escrow, delegatee);
        } else {
            RobynRdaoStakeEscrow(escrow).setDelegate(delegatee);
        }
        rdao.safeTransferFrom(account, escrow, amount);
        Position storage selected = _positions[account];
        uint64 readyAt = uint64(block.timestamp + warmupDuration);
        _warmupLots[account].push(WarmupLot({ amount: uint128(amount), readyAt: readyAt }));
        selected.warming += amount;
        if (selected.activationTime == 0) selected.activationTime = readyAt;
        totalWarmingStake += amount;
        totalPrincipal += amount;
        emit Staked(account, escrow, amount, readyAt, delegatee);
    }

    function _activate(address account, bool strict) private returns (uint256 amount) {
        Position storage selected = _positions[account];
        if (selected.warming == 0) {
            if (strict) revert NothingToActivate();
            return 0;
        }
        if (block.timestamp < selected.activationTime) {
            if (strict) revert WarmupIncomplete(selected.activationTime);
            return 0;
        }
        _updateAccount(account);
        WarmupLot[] storage lots = _warmupLots[account];
        uint256 cursor = _warmupCursor[account];
        while (cursor < lots.length) {
            WarmupLot storage lot = lots[cursor];
            if (lot.amount == 0) {
                ++cursor;
                continue;
            }
            if (block.timestamp < lot.readyAt) break;
            amount += lot.amount;
            lot.amount = 0;
            ++cursor;
        }
        if (amount == 0) {
            if (strict) revert WarmupIncomplete(selected.activationTime);
            return 0;
        }
        _warmupCursor[account] = cursor;
        selected.warming -= amount;
        selected.activationTime = _nextActivationTime(account, cursor);
        selected.eligible += amount;
        totalWarmingStake -= amount;
        totalEligibleStake += amount;
        selected.rewardPerTokenPaid = rewardPerTokenStored;
        if (queuedRewards != 0 && zeroSupplyStream.total == zeroSupplyStream.released) {
            _activateQueuedRewards();
        }
        emit StakeActivated(account, amount, totalEligibleStake);
    }

    function _removeWarmingFromNewest(address account, uint256 amount) private {
        WarmupLot[] storage lots = _warmupLots[account];
        uint256 cursor = _warmupCursor[account];
        uint256 remaining = amount;
        for (uint256 i = lots.length; i > cursor && remaining != 0;) {
            unchecked { --i; }
            WarmupLot storage lot = lots[i];
            uint256 removed = Math.min(remaining, lot.amount);
            if (removed != 0) {
                lot.amount = uint128(uint256(lot.amount) - removed);
                remaining -= removed;
            }
        }
        if (remaining != 0) revert InsufficientStake();
    }

    function _nextActivationTime(address account, uint256 cursor)
        private
        view
        returns (uint64 readyAt)
    {
        WarmupLot[] storage lots = _warmupLots[account];
        for (uint256 i = cursor; i < lots.length; ++i) {
            if (lots[i].amount != 0) return lots[i].readyAt;
        }
    }

    function _activateQueuedRewards() private returns (uint256 amount) {
        if (totalEligibleStake == 0 || queuedRewards == 0) revert NothingToActivate();
        amount = queuedRewards;
        queuedRewards = 0;
        _startOrExtend(zeroSupplyStream, amount, zeroSupplyStreamDuration);
        emit QueuedRewardsActivated(amount, zeroSupplyStream.end);
    }

    function _claim(address account, address recipient)
        private
        nonReentrant
        returns (uint256 amount)
    {
        _updateAccount(account);
        _activate(account, false);
        Position storage selected = _positions[account];
        amount = selected.accrued;
        if (amount == 0) revert NothingToClaim();
        uint256 backing = wrappedNative.balanceOf(address(this));
        if (backing < amount) revert RewardAccountingInsolvent(amount, backing);
        selected.accrued = 0;
        totalRewardsClaimed += amount;
        IERC20(address(wrappedNative)).safeTransfer(recipient, amount);
        emit RewardsClaimed(account, recipient, amount);
    }

    function _updateAccount(address account) private {
        _updateGlobal();
        Position storage selected = _positions[account];
        uint256 delta = rewardPerTokenStored - selected.rewardPerTokenPaid;
        if (delta != 0 && selected.eligible != 0) {
            uint256 numerator = selected.eligible * delta + selected.rewardRemainder;
            selected.accrued += numerator / MAGNITUDE;
            selected.rewardRemainder = numerator % MAGNITUDE;
        }
        selected.rewardPerTokenPaid = rewardPerTokenStored;
    }

    function _updateGlobal() private {
        uint256 newlyReleased = _consumeReleased(ordinaryStream) + _consumeReleased(zeroSupplyStream);
        if (newlyReleased == 0) return;
        if (totalEligibleStake == 0) {
            queuedRewards += newlyReleased;
            return;
        }
        uint256 numerator = newlyReleased * MAGNITUDE + distributionRemainder;
        rewardPerTokenStored += numerator / totalEligibleStake;
        distributionRemainder = numerator % totalEligibleStake;
    }

    function _startOrExtend(Stream storage stream, uint256 amount, uint256 duration) private {
        uint256 remaining = stream.total - stream.released;
        stream.start = uint64(block.timestamp);
        stream.end = uint64(block.timestamp + duration);
        stream.lastUpdate = uint64(block.timestamp);
        stream.total = remaining + amount;
        stream.released = 0;
    }

    function _queueRemainingStreams() private {
        uint256 remaining = ordinaryStream.total - ordinaryStream.released
            + zeroSupplyStream.total - zeroSupplyStream.released;
        if (remaining != 0) queuedRewards += remaining;
        _resetStream(ordinaryStream);
        _resetStream(zeroSupplyStream);
    }

    function _resetStream(Stream storage stream) private {
        stream.start = uint64(block.timestamp);
        stream.end = uint64(block.timestamp);
        stream.lastUpdate = uint64(block.timestamp);
        stream.total = 0;
        stream.released = 0;
    }

    function _newlyReleased(Stream memory stream) private view returns (uint256) {
        return _vested(stream) - stream.released;
    }

    function _consumeReleased(Stream storage stream) private returns (uint256 amount) {
        uint256 vested = _vested(stream);
        amount = vested - stream.released;
        stream.released = vested;
        uint256 applicable = block.timestamp < stream.end ? block.timestamp : stream.end;
        if (applicable > stream.lastUpdate) stream.lastUpdate = uint64(applicable);
    }

    function _vested(Stream memory stream) private view returns (uint256) {
        if (stream.total == 0 || block.timestamp <= stream.start) return 0;
        if (block.timestamp >= stream.end) return stream.total;
        return Math.mulDiv(
            stream.total, block.timestamp - stream.start, stream.end - stream.start
        );
    }
}
