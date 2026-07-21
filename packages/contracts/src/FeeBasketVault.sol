// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynLaunchToken } from "./RobynLaunchToken.sol";

interface IRobynConversionRouter {
    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 reportedAmountOut);
}

/// @notice Per-launch vault that isolates fee principal by immutable basket leg.
contract FeeBasketVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint8 public constant MAX_ASSETS = 3;
    string public constant CONTRACT_VERSION = "1.0.0";

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
    error InputAmountMismatch(uint256 expected, uint256 actual);
    error InsufficientOutput(uint256 minimum, uint256 actual);

    struct BasketLeg {
        IERC20 asset;
        uint16 weightBps;
        uint256 pendingBase;
        uint256 consumedBase;
        uint256 rewardsDeposited;
        uint256 pendingSince;
    }

    IERC20 public immutable baseAsset;
    IRobynConversionRouter public immutable conversionRouter;
    address public immutable factory;
    uint256 public immutable legCount;
    uint256 public immutable minimumConversionBase;
    uint256 public immutable maximumPendingDelay;
    RobynLaunchToken public launchToken;
    uint256 public totalFeesReceived;
    uint256 public totalBaseConsumed;
    BasketLeg[] private _legs;

    event LaunchTokenBound(address indexed launchToken);
    event FeesRecorded(address indexed payer, uint256 requested, uint256 received);
    event LegFunded(uint256 indexed legIndex, address indexed asset, uint256 amount);
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
        IERC20 baseAsset_,
        IRobynConversionRouter conversionRouter_,
        address factory_,
        address[] memory assets_,
        uint16[] memory weights_,
        uint256 minimumConversionBase_,
        uint256 maximumPendingDelay_
    ) {
        if (
            address(baseAsset_) == address(0) || address(conversionRouter_) == address(0)
                || factory_ == address(0)
        ) revert Unauthorized();
        uint256 count = assets_.length;
        if (count == 0 || count > MAX_ASSETS || weights_.length != count) {
            revert InvalidAssetCount();
        }
        uint256 weightTotal;
        for (uint256 i; i < count; ++i) {
            if (assets_[i] == address(0)) revert InvalidAsset(i);
            for (uint256 j; j < i; ++j) {
                if (assets_[i] == assets_[j]) revert DuplicateAsset(j, i);
            }
            weightTotal += weights_[i];
            _legs.push(BasketLeg(IERC20(assets_[i]), weights_[i], 0, 0, 0, 0));
        }
        if (weightTotal != BPS) revert InvalidWeightTotal(weightTotal);
        baseAsset = baseAsset_;
        conversionRouter = conversionRouter_;
        factory = factory_;
        legCount = count;
        minimumConversionBase = minimumConversionBase_;
        maximumPendingDelay = maximumPendingDelay_;
    }

    function bindLaunchToken(RobynLaunchToken launchToken_) external {
        if (msg.sender != factory) revert Unauthorized();
        if (address(launchToken) != address(0)) revert AlreadyBound();
        if (address(launchToken_) == address(0) || launchToken_.controller() != address(this)) {
            revert Unauthorized();
        }
        launchToken = launchToken_;
        emit LaunchTokenBound(address(launchToken_));
    }

    function leg(uint256 index) external view returns (BasketLeg memory) {
        _validateLeg(index);
        return _legs[index];
    }

    function totalPendingBase() public view returns (uint256 pending) {
        for (uint256 i; i < legCount; ++i) {
            pending += _legs[i].pendingBase;
        }
    }

    function recordFees(uint256 requestedAmount) external nonReentrant returns (uint256 received) {
        if (address(launchToken) == address(0)) revert NotBound();
        if (requestedAmount == 0) revert InvalidAmount();
        uint256 beforeBalance = baseAsset.balanceOf(address(this));
        baseAsset.safeTransferFrom(msg.sender, address(this), requestedAmount);
        received = baseAsset.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert InvalidAmount();
        uint256 assigned;
        for (uint256 i = 1; i < legCount; ++i) {
            uint256 allocation = (received * _legs[i].weightBps) / BPS;
            _fundLeg(i, allocation);
            assigned += allocation;
        }
        _fundLeg(0, received - assigned);
        totalFeesReceived += received;
        emit FeesRecorded(msg.sender, requestedAmount, received);
        assert(totalPendingBase() + totalBaseConsumed == totalFeesReceived);
    }

    /// @notice Executes one immutable leg. Any caller may submit a valid conversion.
    function convertLeg(uint256 index, uint256 amount, uint256 minimumOutput, uint256 deadline)
        external
        nonReentrant
        returns (uint256 actualOutput)
    {
        if (address(launchToken) == address(0)) revert NotBound();
        _validateLeg(index);
        if (amount == 0 || minimumOutput == 0) revert InvalidAmount();
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert InvalidDeadline();
        BasketLeg storage selected = _legs[index];
        uint256 available = selected.pendingBase;
        if (amount > available) revert InsufficientPending(available, amount);
        uint256 executableAt = selected.pendingSince + maximumPendingDelay;
        // forge-lint: disable-next-line(block-timestamp)
        if (amount < minimumConversionBase && block.timestamp < executableAt) {
            revert BelowThreshold(amount, minimumConversionBase, executableAt);
        }
        selected.pendingBase = available - amount;
        if (selected.pendingBase == 0) selected.pendingSince = 0;
        totalBaseConsumed += amount;
        uint256 baseBefore = baseAsset.balanceOf(address(this));
        uint256 rewardBefore = selected.asset.balanceOf(address(this));
        baseAsset.forceApprove(address(conversionRouter), amount);
        conversionRouter.swapExactInput(
            address(baseAsset),
            address(selected.asset),
            amount,
            minimumOutput,
            address(this),
            deadline
        );
        baseAsset.forceApprove(address(conversionRouter), 0);
        uint256 baseSpent = baseBefore - baseAsset.balanceOf(address(this));
        if (baseSpent != amount) revert InputAmountMismatch(amount, baseSpent);
        actualOutput = selected.asset.balanceOf(address(this)) - rewardBefore;
        if (actualOutput < minimumOutput) revert InsufficientOutput(minimumOutput, actualOutput);
        selected.consumedBase += amount;
        selected.asset.forceApprove(address(launchToken), actualOutput);
        uint256 rewardDeposited = launchToken.distributeReward(index, actualOutput);
        selected.asset.forceApprove(address(launchToken), 0);
        selected.rewardsDeposited += rewardDeposited;
        _emitConversion(index, amount, minimumOutput, actualOutput, rewardDeposited, deadline);
        assert(totalPendingBase() + totalBaseConsumed == totalFeesReceived);
    }

    function _emitConversion(
        uint256 index,
        uint256 amount,
        uint256 minimumOutput,
        uint256 actualOutput,
        uint256 rewardDeposited,
        uint256 deadline
    ) private {
        emit LegConverted(
            index,
            address(_legs[index].asset),
            msg.sender,
            amount,
            minimumOutput,
            actualOutput,
            rewardDeposited,
            deadline
        );
    }

    function _fundLeg(uint256 index, uint256 amount) private {
        if (amount == 0) return;
        BasketLeg storage selected = _legs[index];
        if (selected.pendingBase == 0) selected.pendingSince = block.timestamp;
        selected.pendingBase += amount;
        emit LegFunded(index, address(selected.asset), amount);
    }

    function _validateLeg(uint256 index) private view {
        if (index >= legCount) revert InvalidLeg(index);
    }
}
