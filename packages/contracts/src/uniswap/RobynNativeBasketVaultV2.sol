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
    uint8 public constant MAX_ASSETS = 3;
    string public constant CONTRACT_VERSION = "3.0.0";

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

    struct BasketLeg {
        IERC20 asset;
        uint16 weightBps;
        uint256 pendingNative;
        uint256 consumedNative;
        uint256 rewardsDeposited;
        uint256 pendingSince;
    }

    RobynV4AssetRouter public immutable assetRouter;
    address public immutable factory;
    uint256 public immutable legCount;
    uint256 public immutable minimumConversionNative;
    uint256 public immutable maximumPendingDelay;
    RobynLaunchToken public launchToken;
    uint256 public totalFeesReceived;
    uint256 public totalNativeConsumed;
    BasketLeg[] private _legs;

    event LaunchTokenBound(address indexed launchToken);
    event FeesRecorded(address indexed payer, uint256 received);
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
            _legs.push(BasketLeg(IERC20(assets_[i]), weights_[i], 0, 0, 0, 0));
        }
        if (weightTotal != BPS) revert InvalidWeightTotal(weightTotal);
        assetRouter = assetRouter_;
        factory = factory_;
        legCount = count;
        minimumConversionNative = minimumConversionNative_;
        maximumPendingDelay = maximumPendingDelay_;
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
        launchToken = launchToken_;
        emit LaunchTokenBound(address(launchToken_));
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
        return _convertLeg(index, amount, minimumOutput, deadline, bytes(""));
    }

    function convertLegWithData(
        uint256 index,
        uint256 amount,
        uint256 minimumOutput,
        uint256 deadline,
        bytes calldata executionData
    ) external nonReentrant returns (uint256 actualOutput) {
        return _convertLeg(index, amount, minimumOutput, deadline, executionData);
    }

    function _convertLeg(
        uint256 index,
        uint256 amount,
        uint256 minimumOutput,
        uint256 deadline,
        bytes memory executionData
    ) private returns (uint256 actualOutput) {
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
        uint256 reported;
        if (executionData.length == 0) {
            reported = assetRouter.swapExactNativeForAsset{ value: amount }(
                address(selected.asset), minimumOutput, address(this), deadline
            );
        } else {
            reported = assetRouter.swapExactNativeForAssetWithData{ value: amount }(
                address(selected.asset), minimumOutput, address(this), deadline, executionData
            );
        }
        actualOutput = selected.asset.balanceOf(address(this)) - rewardBefore;
        if (reported != actualOutput || actualOutput < minimumOutput) {
            revert InsufficientOutput(minimumOutput, actualOutput);
        }
        selected.consumedNative += amount;
        selected.asset.forceApprove(address(launchToken), actualOutput);
        uint256 rewardDeposited = launchToken.distributeReward(index, actualOutput);
        selected.asset.forceApprove(address(launchToken), 0);
        _recordConversion(
            index, amount, minimumOutput, actualOutput, rewardDeposited, deadline
        );
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
