// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRobynExecutionAdapter} from "./IRobynExecutionAdapter.sol";

interface IAllowanceHolder {
    function exec(address operator, address token, uint256 amount, address payable target, bytes calldata data)
        external
        payable
        returns (bytes memory result);
}

/// @notice Bounded adapter for 0x AllowanceHolder ERC20-to-ERC20 firm quotes.
/// @dev Native conversions are normalized to WETH by the parent asset router so
/// this contract never approves Settler and never executes a native-sell quote.
contract RobynZeroExAllowanceHolderAdapter is IRobynExecutionAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "1.0.0";

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidPair();
    error InvalidAmount();
    error InvalidCalldata();
    error RuntimeHashMismatch(address target);
    error DeadlineExpired();
    error InsufficientOutput(uint256 minimum, uint256 actual);
    error ResidualBalance(address token, uint256 amount);

    address public immutable router;
    address public immutable asset;
    address public immutable wrappedNative;
    address public immutable allowanceHolder;
    address public immutable settlementOperator;
    address payable public immutable settlementTarget;
    address public immutable unattributedSink;
    bytes4 public immutable settlementSelector;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable allowanceHolderRuntimeHash;
    bytes32 public immutable settlementOperatorRuntimeHash;
    bytes32 public immutable settlementRuntimeHash;

    struct ExecuteRequest {
        address sellToken;
        address buyToken;
        uint256 amountIn;
        uint256 minimumOutput;
        address recipient;
        bytes providerCalldata;
    }

    event ProviderSwap(
        address indexed sellToken,
        address indexed buyToken,
        address indexed recipient,
        uint256 inputAmount,
        uint256 outputAmount
    );
    event UnattributedTokenSwept(address indexed token, uint256 amount);

    constructor(
        address router_,
        address asset_,
        address wrappedNative_,
        address allowanceHolder_,
        address settlementOperator_,
        address payable settlementTarget_,
        address unattributedSink_,
        bytes4 settlementSelector_,
        uint256 chainId_,
        bytes32 allowanceHolderRuntimeHash_,
        bytes32 settlementOperatorRuntimeHash_,
        bytes32 settlementRuntimeHash_
    ) {
        if (
            router_ == address(0) || asset_ == address(0) || wrappedNative_ == address(0) || asset_ == wrappedNative_
                || allowanceHolder_ == address(0) || settlementOperator_ == address(0)
                || settlementTarget_ == address(0) || unattributedSink_ == address(0)
                || settlementSelector_ == bytes4(0) || chainId_ != block.chainid
                || allowanceHolderRuntimeHash_ == bytes32(0) || settlementOperatorRuntimeHash_ == bytes32(0)
                || settlementRuntimeHash_ == bytes32(0) || router_.code.length == 0 || asset_.code.length == 0
                || wrappedNative_.code.length == 0 || allowanceHolder_.code.length == 0
                || settlementOperator_.code.length == 0 || settlementTarget_.code.length == 0
        ) revert InvalidConfiguration();
        if (allowanceHolder_.codehash != allowanceHolderRuntimeHash_) {
            revert RuntimeHashMismatch(allowanceHolder_);
        }
        if (settlementOperator_.codehash != settlementOperatorRuntimeHash_) {
            revert RuntimeHashMismatch(settlementOperator_);
        }
        if (settlementTarget_.codehash != settlementRuntimeHash_) {
            revert RuntimeHashMismatch(settlementTarget_);
        }
        router = router_;
        asset = asset_;
        wrappedNative = wrappedNative_;
        allowanceHolder = allowanceHolder_;
        settlementOperator = settlementOperator_;
        settlementTarget = settlementTarget_;
        unattributedSink = unattributedSink_;
        settlementSelector = settlementSelector_;
        deploymentChainId = chainId_;
        allowanceHolderRuntimeHash = allowanceHolderRuntimeHash_;
        settlementOperatorRuntimeHash = settlementOperatorRuntimeHash_;
        settlementRuntimeHash = settlementRuntimeHash_;
    }

    function execute(
        address sellToken,
        address buyToken,
        uint256 amountIn,
        uint256 minimumOutput,
        address recipient,
        uint256 deadline,
        bytes calldata providerCalldata
    ) external nonReentrant returns (uint256 amountOut) {
        if (msg.sender != router) revert Unauthorized();
        if (block.chainid != deploymentChainId) revert InvalidConfiguration();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0 || minimumOutput == 0 || recipient == address(0)) {
            revert InvalidAmount();
        }
        if (!((sellToken == wrappedNative && buyToken == asset) || (sellToken == asset && buyToken == wrappedNative))) {
            revert InvalidPair();
        }
        if (allowanceHolder.codehash != allowanceHolderRuntimeHash) {
            revert RuntimeHashMismatch(allowanceHolder);
        }
        if (settlementOperator.codehash != settlementOperatorRuntimeHash) {
            revert RuntimeHashMismatch(settlementOperator);
        }
        if (settlementTarget.codehash != settlementRuntimeHash) {
            revert RuntimeHashMismatch(settlementTarget);
        }
        _validateProviderCalldata(sellToken, amountIn, providerCalldata);
        return _executeProvider(
            ExecuteRequest({
                sellToken: sellToken,
                buyToken: buyToken,
                amountIn: amountIn,
                minimumOutput: minimumOutput,
                recipient: recipient,
                providerCalldata: providerCalldata
            })
        );
    }

    function _executeProvider(ExecuteRequest memory request) private returns (uint256 amountOut) {
        IERC20 sell = IERC20(request.sellToken);
        IERC20 buy = IERC20(request.buyToken);
        uint256 sellBefore = sell.balanceOf(address(this));
        uint256 buyBefore = buy.balanceOf(address(this));
        if (sellBefore < request.amountIn) revert ResidualBalance(request.sellToken, sellBefore);
        if (sellBefore > request.amountIn) {
            uint256 excessSell = sellBefore - request.amountIn;
            sell.safeTransfer(unattributedSink, excessSell);
            emit UnattributedTokenSwept(request.sellToken, excessSell);
        }
        if (buyBefore != 0) {
            buy.safeTransfer(unattributedSink, buyBefore);
            emit UnattributedTokenSwept(request.buyToken, buyBefore);
        }
        sell.forceApprove(allowanceHolder, request.amountIn);
        (bool success, bytes memory result) = allowanceHolder.call(request.providerCalldata);
        sell.forceApprove(allowanceHolder, 0);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        uint256 sellAfter = sell.balanceOf(address(this));
        if (sellAfter != 0) revert ResidualBalance(request.sellToken, sellAfter);
        amountOut = buy.balanceOf(address(this));
        if (amountOut < request.minimumOutput) {
            revert InsufficientOutput(request.minimumOutput, amountOut);
        }
        buy.safeTransfer(request.recipient, amountOut);
        if (buy.balanceOf(address(this)) != 0) {
            revert ResidualBalance(request.buyToken, buy.balanceOf(address(this)));
        }
        emit ProviderSwap(request.sellToken, request.buyToken, request.recipient, request.amountIn, amountOut);
    }

    function _validateProviderCalldata(address sellToken, uint256 amountIn, bytes calldata providerCalldata)
        private
        view
    {
        if (providerCalldata.length < 4 || bytes4(providerCalldata[:4]) != IAllowanceHolder.exec.selector) {
            revert InvalidCalldata();
        }
        (
            address quotedOperator,
            address quotedToken,
            uint256 quotedAmount,
            address payable quotedTarget,
            bytes memory settlementData
        ) = abi.decode(providerCalldata[4:], (address, address, uint256, address, bytes));
        if (
            quotedOperator != settlementOperator || quotedToken != sellToken || quotedAmount != amountIn
                || quotedTarget != settlementTarget || settlementData.length < 4
                || bytes4(settlementData) != settlementSelector
        ) revert InvalidCalldata();
    }
}
