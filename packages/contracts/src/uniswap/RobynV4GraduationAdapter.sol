// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {RobynNativeProtocolFeeRouterV3} from "./RobynNativeProtocolFeeRouterV3.sol";
import {RobynV4AssetRouter} from "./RobynV4AssetRouter.sol";
import {IPositionManagerPermit2, RobynV4FeePositionLocker} from "./RobynV4FeePositionLocker.sol";

/// @notice Market-bound adapter for native v4 graduation and post-graduation execution.
contract RobynV4GraduationAdapter is ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE_PIPS = 10_000;
    int24 public constant TICK_SPACING = 200;
    uint16 public constant BPS = 10_000;
    string public constant CONTRACT_VERSION = "1.0.0";

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyBound();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidAmount();
    error NativeTransferFailed();

    IERC20 public immutable launchToken;
    IPoolManager public immutable poolManager;
    IPositionManagerPermit2 public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    IStateView public immutable stateView;
    RobynV4AssetRouter public immutable assetRouter;
    address public immutable marketBindingAuthority;
    uint160 public immutable initialSqrtPriceX96;
    uint16 public immutable minimumUseBps;
    uint128 public immutable maximumNativeSwap;
    PoolKey private _poolKey;
    bytes32 public immutable poolId;
    RobynV4FeePositionLocker public locker;

    address public bondingMarket;
    bool public initialized;

    event MarketBound(address indexed market);
    event LockerBound(address indexed locker);
    event FeeRouterBound(address indexed feeRouter);
    event LiquidityGraduated(
        bytes32 indexed poolId,
        address indexed locker,
        uint256 indexed positionTokenId,
        uint128 liquidity,
        uint256 tokenUsed,
        uint256 nativeUsed
    );
    event PoolTrade(address indexed recipient, address indexed inputToken, uint256 inputAmount, uint256 outputAmount);

    constructor(
        IERC20 launchToken_,
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        IStateView stateView_,
        RobynV4AssetRouter assetRouter_,
        IHooks hook_,
        address marketBindingAuthority_,
        uint160 initialSqrtPriceX96_,
        uint16 minimumUseBps_,
        uint128 maximumNativeSwap_
    ) {
        if (
            address(launchToken_) == address(0) || address(poolManager_) == address(0)
                || address(positionManager_) == address(0) || address(permit2_) == address(0)
                || address(stateView_) == address(0) || address(assetRouter_) == address(0)
                || address(hook_) == address(0) || marketBindingAuthority_ == address(0)
                || address(launchToken_).code.length == 0 || address(poolManager_).code.length == 0
                || address(positionManager_).code.length == 0 || address(permit2_).code.length == 0
                || address(stateView_).code.length == 0 || address(assetRouter_).code.length == 0
                || address(hook_).code.length == 0 || initialSqrtPriceX96_ == 0 || minimumUseBps_ == 0
                || minimumUseBps_ > BPS || maximumNativeSwap_ == 0
        ) revert InvalidConfiguration();
        launchToken = launchToken_;
        poolManager = poolManager_;
        positionManager = IPositionManagerPermit2(address(positionManager_));
        permit2 = permit2_;
        stateView = stateView_;
        assetRouter = assetRouter_;
        marketBindingAuthority = marketBindingAuthority_;
        initialSqrtPriceX96 = initialSqrtPriceX96_;
        minimumUseBps = minimumUseBps_;
        maximumNativeSwap = maximumNativeSwap_;
        _poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(launchToken_)),
            fee: POOL_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: hook_
        });
        poolId = PoolId.unwrap(_poolKey.toId());
    }

    receive() external payable {}

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function bindMarket(address market) external {
        if (msg.sender != marketBindingAuthority) revert Unauthorized();
        if (bondingMarket != address(0)) revert AlreadyBound();
        if (market == address(0) || market.code.length == 0) revert InvalidConfiguration();
        bondingMarket = market;
        emit MarketBound(market);
    }

    function bindLocker(RobynV4FeePositionLocker locker_) external {
        if (msg.sender != marketBindingAuthority) revert Unauthorized();
        if (address(locker) != address(0)) revert AlreadyBound();
        if (
            address(locker_) == address(0) || address(locker_).code.length == 0
                || address(locker_.launchToken()) != address(launchToken) || locker_.adapter() != address(this)
        ) revert InvalidConfiguration();
        locker = locker_;
        emit LockerBound(address(locker_));
    }

    function bindFeeRouter(RobynNativeProtocolFeeRouterV3 feeRouter) external {
        if (msg.sender != marketBindingAuthority) revert Unauthorized();
        if (address(locker) == address(0)) revert InvalidConfiguration();
        locker.bindFeeRouter(feeRouter);
        emit FeeRouterBound(address(feeRouter));
    }

    // Only the immutable bonding market can call this guarded one-shot path;
    // any refund returns to that same canonical market before initialization.
    // slither-disable-next-line reentrancy-eth
    function graduate(uint256 tokenAmount)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 tokenUsed, uint256 nativeUsed)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        if (address(locker) == address(0)) revert InvalidConfiguration();
        if (tokenAmount == 0 || msg.value == 0) revert InvalidAmount();
        uint256 nativeBefore = address(this).balance - msg.value;
        launchToken.safeTransferFrom(msg.sender, address(locker), tokenAmount);
        (tokenId, liquidity, tokenUsed, nativeUsed) = locker.mintAndLock{value: msg.value}(tokenAmount, minimumUseBps);
        uint256 nativeRefund = address(this).balance - nativeBefore;
        if (nativeRefund != 0) {
            (bool sent,) = payable(bondingMarket).call{value: nativeRefund}("");
            if (!sent) revert NativeTransferFailed();
        }
        initialized = true;
        emit LiquidityGraduated(poolId, address(locker), tokenId, liquidity, tokenUsed, nativeUsed);
    }

    function buyFor(address recipient, uint256 minimumTokenOutput)
        external
        payable
        nonReentrant
        returns (uint256 tokenOutput)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (!initialized) revert NotInitialized();
        if (recipient == address(0) || msg.value == 0 || minimumTokenOutput == 0) {
            revert InvalidAmount();
        }
        tokenOutput = assetRouter.swapExactNativeForAsset{value: msg.value}(
            address(launchToken), minimumTokenOutput, recipient, block.timestamp
        );
        emit PoolTrade(recipient, address(0), msg.value, tokenOutput);
    }

    function sellFor(address payable recipient, uint128 tokenInput, uint256 minimumNativeOutput)
        external
        nonReentrant
        returns (uint256 nativeOutput)
    {
        if (msg.sender != bondingMarket) revert Unauthorized();
        if (!initialized) revert NotInitialized();
        if (recipient == address(0) || tokenInput == 0 || minimumNativeOutput == 0) {
            revert InvalidAmount();
        }
        launchToken.safeTransferFrom(msg.sender, address(this), tokenInput);
        launchToken.forceApprove(address(assetRouter), tokenInput);
        nativeOutput = assetRouter.swapExactAssetForNative(
            address(launchToken), tokenInput, minimumNativeOutput, recipient, block.timestamp
        );
        launchToken.forceApprove(address(assetRouter), 0);
        emit PoolTrade(recipient, address(launchToken), tokenInput, nativeOutput);
    }

    function quoteBuy(uint128 nativeInput) external returns (uint256 nominalFee, uint256 tokenOutput) {
        if (!initialized) revert NotInitialized();
        (tokenOutput,) = assetRouter.quoteNativeToAsset(address(launchToken), nativeInput);
        nominalFee = Math.mulDiv(nativeInput, POOL_FEE_PIPS, 1_000_000);
    }

    function quoteSell(uint128 tokenInput) external returns (uint256 nominalFeeNative, uint256 nativeOutput) {
        if (!initialized) revert NotInitialized();
        (nativeOutput,) = assetRouter.quoteAssetToNative(address(launchToken), tokenInput);
        uint256 tokenFee = Math.mulDiv(tokenInput, POOL_FEE_PIPS, 1_000_000);
        nominalFeeNative = Math.mulDiv(tokenFee, spotNativePerTokenX18(), 1e18);
    }

    function spotNativePerTokenX18() public view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = stateView.getSlot0(PoolId.wrap(poolId));
        if (sqrtPriceX96 == 0) revert NotInitialized();
        uint256 ratioX96 = Math.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96);
        return Math.mulDiv(1e18, 1 << 96, ratioX96);
    }
}
