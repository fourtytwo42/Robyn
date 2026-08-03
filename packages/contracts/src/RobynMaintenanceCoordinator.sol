// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynNativeProtocolFeeRouterV4 } from "./uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynNativeBasketVaultV2 } from "./uniswap/RobynNativeBasketVaultV2.sol";
import { RobynV4AssetRouter } from "./uniswap/RobynV4AssetRouter.sol";

interface ISchema19FeeLocker {
    function collectFees(uint128 minimumNative, uint128 minimumToken)
        external
        returns (uint256 nativeAmount, uint256 tokenAmount);
    function pendingCollectedNativeFees() external view returns (uint256);
    function pendingCollectedTokenFees() external view returns (uint256);
    function routeCollectedNative(uint256 amount) external;
    function convertCollectedToken(uint128 amount, uint256 minimumNativeOut, uint256 deadline)
        external
        returns (uint256 nativeOut);
}

interface ISchema19FeeHook {
    function pendingNativeFees(address token) external view returns (uint256);
    function pendingTokenFees(address token) external view returns (uint256);
    function settleNativeFees(IERC20 token, uint256 amount) external;
    function convertTokenFees(
        IERC20 token,
        uint128 amount,
        uint256 minimumNativeOut,
        uint256 deadline
    ) external returns (uint256 nativeOut);
}

interface ISchema19BasketVault {
    function processNextLeg() external returns (bool converted, uint256 legIndex, bool usedFallback);
}

/// @notice Deterministic one-task scheduler for launch-local fee and reward maintenance.
/// @dev Every call attempts no more than one task. The task executes in a bounded self-call so
/// failure is recorded and returned without reverting the user's primary transaction.
contract RobynMaintenanceCoordinator is ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    uint16 public constant QUOTE_MINIMUM_BPS = 9_900;
    uint8 public constant TASK_COUNT = 9;
    string public constant CONTRACT_VERSION = "1.0.0-schema19";

    enum Task {
        CollectLockerFees,
        RouteLockerNative,
        ConvertLockerToken,
        RouteHookNative,
        ConvertHookToken,
        SettleBasket,
        SettleDao,
        SettleTreasury,
        ConvertBasketLeg
    }

    enum Result {
        NoWork,
        Succeeded,
        Failed
    }

    error Unauthorized();
    error InvalidConfiguration();
    error UnknownLaunch();
    error AmountTooLarge();

    RobynNativeProtocolFeeRouterV4 public immutable feeRouter;
    RobynV4AssetRouter public immutable assetRouter;
    uint256 public immutable taskGasLimit;
    mapping(address token => uint8 cursor) public nextTask;
    mapping(address token => uint256 attempts) public attemptCount;
    mapping(address token => uint256 successes) public successCount;

    event MaintenanceAttempted(
        address indexed token,
        address indexed caller,
        Task indexed task,
        Result result,
        bytes4 failureSelector,
        bytes32 failureHash
    );

    constructor(
        RobynNativeProtocolFeeRouterV4 feeRouter_,
        RobynV4AssetRouter assetRouter_,
        uint256 taskGasLimit_
    ) {
        if (
            address(feeRouter_) == address(0) || address(assetRouter_) == address(0)
                || address(feeRouter_).code.length == 0 || address(assetRouter_).code.length == 0
                || address(feeRouter_.assetRouter()) != address(assetRouter_)
                || taskGasLimit_ < 100_000 || taskGasLimit_ > 2_000_000
        ) revert InvalidConfiguration();
        feeRouter = feeRouter_;
        assetRouter = assetRouter_;
        taskGasLimit = taskGasLimit_;
    }

    function processRewards(address token) external nonReentrant returns (bool succeeded) {
        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(token);
        if (!account.registered) {
            emit MaintenanceAttempted(
                token,
                msg.sender,
                Task(nextTask[token]),
                Result.Failed,
                UnknownLaunch.selector,
                keccak256(abi.encodeWithSelector(UnknownLaunch.selector))
            );
            return false;
        }

        Task task = Task(nextTask[token]);
        nextTask[token] = uint8((uint256(uint8(task)) + 1) % TASK_COUNT);
        attemptCount[token] += 1;
        (bool callSucceeded, bytes memory result) =
            address(this).call{ gas: taskGasLimit }(abi.encodeCall(this.executeTask, (token, task)));
        if (!callSucceeded) {
            bytes4 selector = _selector(result);
            emit MaintenanceAttempted(
                token, msg.sender, task, Result.Failed, selector, keccak256(result)
            );
            return false;
        }
        bool didWork = abi.decode(result, (bool));
        if (didWork) {
            successCount[token] += 1;
            succeeded = true;
        }
        emit MaintenanceAttempted(
            token,
            msg.sender,
            task,
            didWork ? Result.Succeeded : Result.NoWork,
            bytes4(0),
            bytes32(0)
        );
    }

    function executeTask(address token, Task task) external returns (bool didWork) {
        if (msg.sender != address(this)) revert Unauthorized();
        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(token);
        if (!account.registered) revert UnknownLaunch();

        if (task == Task.CollectLockerFees) {
            (uint256 nativeAmount, uint256 tokenAmount) =
                ISchema19FeeLocker(account.locker).collectFees(0, 0);
            return nativeAmount != 0 || tokenAmount != 0;
        }
        if (task == Task.RouteLockerNative) {
            uint256 amount = ISchema19FeeLocker(account.locker).pendingCollectedNativeFees();
            if (amount == 0) return false;
            ISchema19FeeLocker(account.locker).routeCollectedNative(amount);
            return true;
        }
        if (task == Task.ConvertLockerToken) {
            uint256 amount = ISchema19FeeLocker(account.locker).pendingCollectedTokenFees();
            if (amount == 0) return false;
            uint128 bounded = _toUint128(amount);
            uint256 minimumOutput = _assetToNativeMinimum(token, bounded);
            ISchema19FeeLocker(account.locker)
                .convertCollectedToken(bounded, minimumOutput, block.timestamp + 2 minutes);
            return true;
        }
        if (task == Task.RouteHookNative) {
            uint256 amount = ISchema19FeeHook(account.hook).pendingNativeFees(token);
            if (amount == 0) return false;
            ISchema19FeeHook(account.hook).settleNativeFees(IERC20(token), amount);
            return true;
        }
        if (task == Task.ConvertHookToken) {
            uint256 amount = ISchema19FeeHook(account.hook).pendingTokenFees(token);
            if (amount == 0) return false;
            uint128 bounded = _toUint128(amount);
            uint256 minimumOutput = _assetToNativeMinimum(token, bounded);
            ISchema19FeeHook(account.hook)
                .convertTokenFees(
                    IERC20(token), bounded, minimumOutput, block.timestamp + 2 minutes
                );
            return true;
        }
        if (task == Task.SettleBasket) {
            uint256 amount = account.pendingBasketNative;
            if (amount == 0) return false;
            feeRouter.settleBasketFees(token, amount);
            return true;
        }
        if (task == Task.SettleDao) {
            uint256 amount = account.pendingDaoNative;
            if (amount == 0) return false;
            feeRouter.settleDaoFees(token, amount);
            return true;
        }
        if (task == Task.SettleTreasury) {
            uint256 amount = account.pendingTreasuryNative;
            if (amount == 0) return false;
            feeRouter.settleTreasuryFees(token, amount);
            return true;
        }
        return _processBasketLeg(account.vault);
    }

    function _processBasketLeg(RobynNativeBasketVaultV2 vault) private returns (bool) {
        (bool converted,,) = ISchema19BasketVault(address(vault)).processNextLeg();
        return converted;
    }

    function _assetToNativeMinimum(address token, uint128 amount) private returns (uint256) {
        (uint256 quote,) = assetRouter.quoteAssetToNative(token, amount);
        if (quote == 0) revert InvalidConfiguration();
        return (quote * QUOTE_MINIMUM_BPS) / BPS;
    }

    function _toUint128(uint256 amount) private pure returns (uint128 bounded) {
        if (amount > type(uint128).max) revert AmountTooLarge();
        bounded = uint128(amount);
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
        }
    }
}
