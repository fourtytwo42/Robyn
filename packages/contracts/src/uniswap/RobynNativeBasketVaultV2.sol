// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";

/// @notice Per-launch vault that converts native ETH fee allocations into immutable basket rewards.
contract RobynNativeBasketVaultV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant QUOTE_MINIMUM_BPS = 9_900;
    uint8 public constant MAX_ASSETS = 3;
    uint8 public constant REQUIRED_FAILURE_OBSERVATIONS = 3;
    string public constant CONTRACT_VERSION = "4.0.0-schema19";

    bytes32 private constant REASON_POOL_UNINITIALIZED = keccak256("POOL_UNINITIALIZED");
    bytes32 private constant REASON_THIN_LIQUIDITY = keccak256("INSUFFICIENT_LIQUIDITY");
    bytes32 private constant REASON_REFERENCE_DEVIATION = keccak256("REFERENCE_PRICE_DEVIATION");
    bytes32 private constant REASON_PROTECTED_QUOTE = keccak256("PROTECTED_QUOTE_FAILURE");

    error Unauthorized();
    error AlreadyBound();
    error NotBound();
    error InvalidAssetCount();
    error InvalidAsset(uint256 index);
    error DuplicateAsset(uint256 firstIndex, uint256 secondIndex);
    error InvalidWeightTotal(uint256 total);
    error InvalidAmount();
    error InvalidLeg(uint256 index);
    error InvalidDeadline();
    error BelowThreshold(uint256 amount, uint256 threshold, uint256 executableAt);
    error InsufficientPending(uint256 available, uint256 requested);
    error InsufficientOutput(uint256 minimum, uint256 actual);
    error InvalidRewardConfiguration();

    struct BasketLeg {
        IERC20 asset;
        uint16 weightBps;
        uint256 pendingNative;
        uint256 consumedNative;
        uint256 rewardsDeposited;
        uint256 pendingSince;
        uint256 fallbackNativeConsumed;
        uint256 fallbackRewardsDeposited;
        uint8 failureObservations;
        uint64 firstFailureAt;
        uint64 lastFailureAt;
        bytes32 lastFailureReason;
    }

    RobynV4AssetRouter public immutable assetRouter;
    IERC20 public immutable fallbackAsset;
    address public immutable factory;
    uint256 public immutable legCount;
    uint256 public immutable minimumConversionNative;
    uint256 public immutable maximumPendingDelay;
    uint256 public failureObservationSpacing;
    uint256 public fallbackDelay;
    RobynLaunchToken public launchToken;
    uint8 public fallbackRewardIndex;
    event FallbackPolicyConfigured(uint256 failureObservationSpacing, uint256 fallbackDelay);
    uint8 public nextLegCursor;
    uint256 public totalFeesReceived;
    uint256 public totalNativeConsumed;
    BasketLeg[] private _legs;

    event LaunchTokenBound(
        address indexed launchToken, address indexed fallbackAsset, uint8 fallbackRewardIndex
    );
    event FeesRecorded(address indexed payer, uint256 received);
    event LegFunded(uint256 indexed legIndex, address indexed asset, uint256 amount);
    event LegFailureObserved(
        uint256 indexed legIndex,
        address indexed primaryAsset,
        uint8 observationCount,
        uint256 firstFailureAt,
        uint256 lastFailureAt,
        bytes32 reason
    );
    event LegFailureHistoryReset(uint256 indexed legIndex, address indexed primaryAsset);
    event LegFallbackConverted(
        uint256 indexed legIndex,
        address indexed fallbackAsset,
        uint256 inputAmount,
        uint256 actualOutput,
        uint256 rewardDeposited
    );
    event LegConverted(
        uint256 indexed legIndex,
        address indexed asset,
        address indexed caller,
        uint256 inputAmount,
        uint256 minimumOutput,
        uint256 actualOutput,
        uint256 rewardDeposited,
        uint256 deadline
    );

    constructor(
        RobynV4AssetRouter assetRouter_,
        address factory_,
        address[] memory assets_,
        uint16[] memory weights_,
        uint256 minimumConversionNative_,
        uint256 maximumPendingDelay_
    ) {
        if (address(assetRouter_) == address(0) || factory_ == address(0)) {
            revert Unauthorized();
        }
        uint256 count = assets_.length;
        if (count == 0 || count > MAX_ASSETS || weights_.length != count) {
            revert InvalidAssetCount();
        }
        uint256 weightTotal;
        for (uint256 i; i < count; ++i) {
            if (assets_[i] == address(0)) revert InvalidAsset(i);
            RobynV4AssetRouter.RouteStatus memory status = assetRouter_.routeStatus(assets_[i]);
            if (!status.ready) revert InvalidAsset(i);
            for (uint256 j; j < i; ++j) {
                if (assets_[i] == assets_[j]) revert DuplicateAsset(j, i);
            }
            weightTotal += weights_[i];
            _legs.push(
                BasketLeg(IERC20(assets_[i]), weights_[i], 0, 0, 0, 0, 0, 0, 0, 0, 0, bytes32(0))
            );
        }
        if (weightTotal != BPS) revert InvalidWeightTotal(weightTotal);
        address wrappedNative = address(assetRouter_.wrappedNative());
        if (wrappedNative == address(0) || wrappedNative.code.length == 0) {
            revert InvalidRewardConfiguration();
        }
        assetRouter = assetRouter_;
        fallbackAsset = IERC20(wrappedNative);
        factory = factory_;
        legCount = count;
        minimumConversionNative = minimumConversionNative_;
        maximumPendingDelay = maximumPendingDelay_;
        failureObservationSpacing = 24 hours;
        fallbackDelay = 72 hours;
    }

    function configureFallbackPolicy(uint256 observationSpacing, uint256 fallbackDelay_) external {
        if (msg.sender != factory) revert Unauthorized();
        if (address(launchToken) != address(0)) revert AlreadyBound();
        if (observationSpacing == 0 || fallbackDelay_ < observationSpacing * 3) {
            revert InvalidRewardConfiguration();
        }
        failureObservationSpacing = observationSpacing;
        fallbackDelay = fallbackDelay_;
        emit FallbackPolicyConfigured(observationSpacing, fallbackDelay_);
    }

    receive() external payable {
        revert Unauthorized();
    }

    function bindLaunchToken(RobynLaunchToken launchToken_) external {
        if (msg.sender != factory) revert Unauthorized();
        if (address(launchToken) != address(0)) revert AlreadyBound();
        if (address(launchToken_) == address(0) || launchToken_.controller() != address(this)) {
            revert Unauthorized();
        }
        for (uint256 index; index < legCount; ++index) {
            if (launchToken_.rewardAsset(index) != address(_legs[index].asset)) {
                revert InvalidRewardConfiguration();
            }
        }
        uint256 rewardCount = launchToken_.rewardAssetCount();
        bool foundFallback;
        for (uint256 index; index < rewardCount; ++index) {
            if (launchToken_.rewardAsset(index) == address(fallbackAsset)) {
                fallbackRewardIndex = uint8(index);
                foundFallback = true;
                break;
            }
        }
        if (!foundFallback) revert InvalidRewardConfiguration();
        launchToken = launchToken_;
        emit LaunchTokenBound(address(launchToken_), address(fallbackAsset), fallbackRewardIndex);
    }

    function leg(uint256 index) external view returns (BasketLeg memory) {
        _validateLeg(index);
        return _legs[index];
    }

    function totalPendingNative() public view returns (uint256 pending) {
        for (uint256 i; i < legCount; ++i) {
            pending += _legs[i].pendingNative;
        }
    }

    function recordFees() external payable nonReentrant returns (uint256 received) {
        if (address(launchToken) == address(0)) revert NotBound();
        received = msg.value;
        if (received == 0) revert InvalidAmount();
        uint256 assigned;
        for (uint256 i = 1; i < legCount; ++i) {
            uint256 allocation = (received * _legs[i].weightBps) / BPS;
            _fundLeg(i, allocation);
            assigned += allocation;
        }
        _fundLeg(0, received - assigned);
        totalFeesReceived += received;
        emit FeesRecorded(msg.sender, received);
        assert(totalPendingNative() + totalNativeConsumed == totalFeesReceived);
    }

    // The permissionless conversion is non-reentrant, debits pending value
    // before interaction, and verifies observed token deltas before accounting.
    // slither-disable-next-line reentrancy-balance,reentrancy-eth
    function convertLeg(uint256 index, uint256 amount, uint256 minimumOutput, uint256 deadline)
        external
        nonReentrant
        returns (uint256 actualOutput)
    {
        return _convertLeg(index, amount, minimumOutput, deadline);
    }

    function _convertLeg(uint256 index, uint256 amount, uint256 minimumOutput, uint256 deadline)
        private
        returns (uint256 actualOutput)
    {
        if (address(launchToken) == address(0)) revert NotBound();
        _validateLeg(index);
        if (amount == 0 || amount > type(uint128).max || minimumOutput == 0) {
            revert InvalidAmount();
        }
        if (deadline < block.timestamp) revert InvalidDeadline();
        BasketLeg storage selected = _legs[index];
        uint256 available = selected.pendingNative;
        if (amount > available) revert InsufficientPending(available, amount);
        uint256 executableAt = selected.pendingSince + maximumPendingDelay;
        if (amount < minimumConversionNative && block.timestamp < executableAt) {
            revert BelowThreshold(amount, minimumConversionNative, executableAt);
        }
        selected.pendingNative = available - amount;
        if (selected.pendingNative == 0) selected.pendingSince = 0;
        totalNativeConsumed += amount;
        uint256 rewardBefore = selected.asset.balanceOf(address(this));
        uint256 reported = assetRouter.swapExactNativeForAsset{ value: amount }(
            address(selected.asset), minimumOutput, address(this), deadline
        );
        actualOutput = selected.asset.balanceOf(address(this)) - rewardBefore;
        if (reported != actualOutput || actualOutput < minimumOutput) {
            revert InsufficientOutput(minimumOutput, actualOutput);
        }
        selected.consumedNative += amount;
        selected.asset.forceApprove(address(launchToken), actualOutput);
        uint256 rewardDeposited = launchToken.distributeReward(index, actualOutput);
        selected.asset.forceApprove(address(launchToken), 0);
        _recordConversion(index, amount, minimumOutput, actualOutput, rewardDeposited, deadline);
        assert(totalPendingNative() + totalNativeConsumed == totalFeesReceived);
    }

    function _recordConversion(
        uint256 index,
        uint256 amount,
        uint256 minimumOutput,
        uint256 actualOutput,
        uint256 rewardDeposited,
        uint256 deadline
    ) private {
        BasketLeg storage selected = _legs[index];
        selected.rewardsDeposited += rewardDeposited;
        emit LegConverted(
            index,
            address(selected.asset),
            msg.sender,
            amount,
            minimumOutput,
            actualOutput,
            rewardDeposited,
            deadline
        );
    }

    /// @notice Attempts one deterministic leg. Route failure is recorded rather than reverted.
    function processNextLeg()
        external
        nonReentrant
        returns (bool converted, uint256 legIndex, bool usedFallback)
    {
        if (address(launchToken) == address(0)) revert NotBound();
        legIndex = nextLegCursor;
        nextLegCursor = uint8((uint256(nextLegCursor) + 1) % legCount);
        BasketLeg storage selected = _legs[legIndex];
        uint256 amount = selected.pendingNative;
        if (amount == 0) return (false, legIndex, false);
        if (
            amount < minimumConversionNative
                && block.timestamp < selected.pendingSince + maximumPendingDelay
        ) {
            return (false, legIndex, false);
        }

        // Administrative state is never evidence that the underlying route
        // objectively failed. In particular, a guardian-supplied disable
        // reason must not be able to imitate a pool, quote, or oracle failure
        // and advance the irreversible fallback clock.
        if (assetRouter.conversionsPaused()) return (false, legIndex, false);
        RobynV4AssetRouter.ExecutionRoute memory execution =
            assetRouter.executionRoute(address(selected.asset));
        if (!execution.enabled) return (false, legIndex, false);

        RobynV4AssetRouter.RouteStatus memory status =
            assetRouter.routeStatus(address(selected.asset));
        if (!status.ready) {
            if (_isObjectiveRouteFailure(status.reason)) {
                if (_fallbackEligible(selected)) return _attemptFallback(legIndex, amount);
                _recordFailure(legIndex, status.reason);
            }
            return (false, legIndex, false);
        }
        if (status.maximumNativeInput != 0 && amount > status.maximumNativeInput) {
            amount = status.maximumNativeInput;
        }
        try assetRouter.quoteNativeToAsset(address(selected.asset), uint128(amount)) returns (
            uint256 quote, uint256
        ) {
            if (quote == 0) {
                _recordFailure(legIndex, REASON_PROTECTED_QUOTE);
                return (false, legIndex, false);
            }
            uint256 minimumOutput = (quote * QUOTE_MINIMUM_BPS) / BPS;
            _resetFailureHistory(legIndex);
            try this.executePrimaryConversion(
                legIndex, amount, minimumOutput, block.timestamp + 2 minutes
            ) returns (
                uint256
            ) {
                return (true, legIndex, false);
            } catch {
                _recordFailure(legIndex, REASON_PROTECTED_QUOTE);
                return (false, legIndex, false);
            }
        } catch {
            if (_fallbackEligible(selected)) return _attemptFallback(legIndex, amount);
            _recordFailure(legIndex, REASON_PROTECTED_QUOTE);
            return (false, legIndex, false);
        }
    }

    function executePrimaryConversion(
        uint256 index,
        uint256 amount,
        uint256 minimumOutput,
        uint256 deadline
    ) external returns (uint256 actualOutput) {
        if (msg.sender != address(this)) revert Unauthorized();
        return _convertLeg(index, amount, minimumOutput, deadline);
    }

    function executeFallbackConversion(
        uint256 index,
        uint256 amount,
        uint256 minimumOutput,
        uint256 deadline
    ) external returns (uint256 actualOutput) {
        if (msg.sender != address(this)) revert Unauthorized();
        _validateLeg(index);
        BasketLeg storage selected = _legs[index];
        uint256 available = selected.pendingNative;
        if (amount == 0 || amount > available || minimumOutput == 0) revert InvalidAmount();
        selected.pendingNative = available - amount;
        if (selected.pendingNative == 0) selected.pendingSince = 0;
        totalNativeConsumed += amount;
        uint256 beforeBalance = fallbackAsset.balanceOf(address(this));
        uint256 reported = assetRouter.swapExactNativeForAsset{ value: amount }(
            address(fallbackAsset), minimumOutput, address(this), deadline
        );
        actualOutput = fallbackAsset.balanceOf(address(this)) - beforeBalance;
        if (reported != actualOutput || actualOutput < minimumOutput) {
            revert InsufficientOutput(minimumOutput, actualOutput);
        }
        selected.consumedNative += amount;
        selected.fallbackNativeConsumed += amount;
        fallbackAsset.forceApprove(address(launchToken), actualOutput);
        uint256 deposited = launchToken.distributeReward(fallbackRewardIndex, actualOutput);
        fallbackAsset.forceApprove(address(launchToken), 0);
        selected.fallbackRewardsDeposited += deposited;
        emit LegFallbackConverted(index, address(fallbackAsset), amount, actualOutput, deposited);
        assert(totalPendingNative() + totalNativeConsumed == totalFeesReceived);
    }

    function _attemptFallback(uint256 index, uint256 amount) private returns (bool, uint256, bool) {
        RobynV4AssetRouter.RouteStatus memory status =
            assetRouter.routeStatus(address(fallbackAsset));
        if (!status.ready) return (false, index, false);
        if (status.maximumNativeInput != 0 && amount > status.maximumNativeInput) {
            amount = status.maximumNativeInput;
        }
        try assetRouter.quoteNativeToAsset(address(fallbackAsset), uint128(amount)) returns (
            uint256 quote, uint256
        ) {
            if (quote == 0) return (false, index, false);
            uint256 minimumOutput = (quote * QUOTE_MINIMUM_BPS) / BPS;
            try this.executeFallbackConversion(
                index, amount, minimumOutput, block.timestamp + 2 minutes
            ) returns (
                uint256
            ) {
                _resetFailureHistory(index);
                return (true, index, true);
            } catch {
                return (false, index, false);
            }
        } catch {
            return (false, index, false);
        }
    }

    function _recordFailure(uint256 index, bytes32 reason) private {
        BasketLeg storage selected = _legs[index];
        if (selected.failureObservations == 0) {
            selected.failureObservations = 1;
            selected.firstFailureAt = uint64(block.timestamp);
            selected.lastFailureAt = uint64(block.timestamp);
        } else if (
            selected.failureObservations < REQUIRED_FAILURE_OBSERVATIONS
                && block.timestamp >= uint256(selected.lastFailureAt) + failureObservationSpacing
        ) {
            selected.failureObservations += 1;
            selected.lastFailureAt = uint64(block.timestamp);
        }
        selected.lastFailureReason = reason;
        emit LegFailureObserved(
            index,
            address(selected.asset),
            selected.failureObservations,
            selected.firstFailureAt,
            selected.lastFailureAt,
            reason
        );
    }

    function _resetFailureHistory(uint256 index) private {
        BasketLeg storage selected = _legs[index];
        if (selected.failureObservations == 0 && selected.lastFailureReason == bytes32(0)) return;
        selected.failureObservations = 0;
        selected.firstFailureAt = 0;
        selected.lastFailureAt = 0;
        selected.lastFailureReason = bytes32(0);
        emit LegFailureHistoryReset(index, address(selected.asset));
    }

    function _fallbackEligible(BasketLeg memory selected) private view returns (bool) {
        return selected.failureObservations == REQUIRED_FAILURE_OBSERVATIONS
            && block.timestamp >= uint256(selected.firstFailureAt) + fallbackDelay;
    }

    function _isObjectiveRouteFailure(bytes32 reason) private pure returns (bool) {
        return reason == REASON_POOL_UNINITIALIZED || reason == REASON_THIN_LIQUIDITY
            || reason == REASON_REFERENCE_DEVIATION || reason == REASON_PROTECTED_QUOTE;
    }

    function _fundLeg(uint256 index, uint256 amount) private {
        if (amount == 0) return;
        BasketLeg storage selected = _legs[index];
        if (selected.pendingNative == 0) selected.pendingSince = block.timestamp;
        selected.pendingNative += amount;
        emit LegFunded(index, address(selected.asset), amount);
    }

    function _validateLeg(uint256 index) private view {
        if (index >= legCount) revert InvalidLeg(index);
    }
}
