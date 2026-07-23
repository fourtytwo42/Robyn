// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FeeBasketVault} from "../FeeBasketVault.sol";
import {INativeFeeConverter} from "./INativeFeeConverter.sol";
import {RobynDaoToken} from "./RobynDaoToken.sol";

/// @notice Immutable 50/25/20/5 fee policy with asynchronous native conversion.
contract RobynProtocolFeeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint16 public constant BPS = 10_000;
    uint16 public constant CREATOR_BPS = 2_500;
    uint16 public constant DAO_REWARD_BPS = 2_000;
    uint16 public constant TREASURY_BPS = 500;

    struct LaunchFeeAccount {
        address creator;
        FeeBasketVault vault;
        address market;
        address locker;
        uint256 pendingCreatorBase;
        uint256 pendingDaoRewardBase;
        uint256 pendingTreasuryBase;
        uint256 cumulativeBaseFees;
        uint256 cumulativeLaunchFeesConverted;
        uint256 cumulativeNativeConverted;
        bool registered;
    }

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyBound();
    error LaunchAlreadyRegistered();
    error UnknownLaunch();
    error InvalidSource();
    error NothingPending();
    error ConversionPaused();
    error NativeTransferFailed();

    IERC20 public immutable baseAsset;
    RobynDaoToken public immutable daoToken;
    address payable public immutable treasury;
    address public immutable guardian;
    address public immutable initializer;
    address public coordinator;
    INativeFeeConverter public converter;
    bool public paused;

    mapping(address => LaunchFeeAccount) private _launchAccounts;
    mapping(address => uint256) public creatorNativeClaims;
    uint256 public totalCreatorNativeLiability;
    uint256 public totalDaoNativeRewards;
    uint256 public totalTreasuryNative;

    event CoordinatorBound(address indexed coordinator);
    event ConverterUpdated(address indexed converter);
    event LaunchRegistered(
        address indexed token, address indexed creator, address indexed vault, address market, address locker
    );
    event BaseFeesRouted(
        address indexed token,
        address indexed source,
        uint256 total,
        uint256 basket,
        uint256 creator,
        uint256 daoReward,
        uint256 treasury
    );
    event LaunchFeesConverted(address indexed token, uint256 launchAmount, uint256 baseOutput);
    event NativeFeesConverted(
        address indexed token,
        uint256 baseInput,
        uint256 nativeOutput,
        uint256 creator,
        uint256 daoReward,
        uint256 treasury
    );
    event CreatorFeesClaimed(address indexed creator, address indexed recipient, uint256 amount);
    event ConversionPauseChanged(bool paused, address indexed caller);

    constructor(IERC20 baseAsset_, RobynDaoToken daoToken_, address payable treasury_, address guardian_) {
        if (
            address(baseAsset_) == address(0) || address(daoToken_) == address(0) || treasury_ == address(0)
                || guardian_ == address(0)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        daoToken = daoToken_;
        treasury = treasury_;
        guardian = guardian_;
        initializer = msg.sender;
    }

    receive() external payable {
        if (msg.sender != address(converter)) revert Unauthorized();
    }

    function bindCoordinator(address coordinator_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (coordinator != address(0)) revert AlreadyBound();
        if (coordinator_ == address(0) || coordinator_.code.length == 0) revert InvalidConfiguration();
        coordinator = coordinator_;
        emit CoordinatorBound(coordinator_);
    }

    function setConverter(INativeFeeConverter converter_) external {
        if (msg.sender != initializer && msg.sender != treasury) revert Unauthorized();
        if (address(converter_) == address(0) || address(converter_).code.length == 0) revert InvalidConfiguration();
        converter = converter_;
        emit ConverterUpdated(address(converter_));
    }

    function setPaused(bool paused_) external {
        if (paused_) {
            if (msg.sender != guardian && msg.sender != treasury) revert Unauthorized();
        } else if (msg.sender != treasury) {
            revert Unauthorized();
        }
        paused = paused_;
        emit ConversionPauseChanged(paused_, msg.sender);
    }

    function registerLaunch(IERC20 token, address creator, FeeBasketVault vault, address market, address locker)
        external
    {
        if (msg.sender != coordinator) revert Unauthorized();
        if (
            address(token) == address(0) || creator == address(0) || address(vault) == address(0)
                || market == address(0) || locker == address(0) || address(vault.baseAsset()) != address(baseAsset)
                || address(vault.launchToken()) != address(token)
        ) revert InvalidConfiguration();
        LaunchFeeAccount storage account = _launchAccounts[address(token)];
        if (account.registered) revert LaunchAlreadyRegistered();
        account.creator = creator;
        account.vault = vault;
        account.market = market;
        account.locker = locker;
        account.registered = true;
        emit LaunchRegistered(address(token), creator, address(vault), market, locker);
    }

    function launchAccount(address token) external view returns (LaunchFeeAccount memory) {
        return _launchAccounts[token];
    }

    function routeBaseFees(IERC20 token, uint256 amount) external nonReentrant {
        LaunchFeeAccount storage account = _authorizedAccount(address(token));
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        _allocateBase(address(token), account, msg.sender, amount);
    }

    function convertAndRouteLaunchFees(IERC20 token, uint256 amount, uint256 minimumBaseOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 baseOut)
    {
        LaunchFeeAccount storage account = _authorizedAccount(address(token));
        if (msg.sender != account.locker) revert InvalidSource();
        if (paused) revert ConversionPaused();
        if (address(converter) == address(0) || amount == 0 || minimumBaseOut == 0) revert InvalidConfiguration();
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(converter), amount);
        uint256 beforeBalance = baseAsset.balanceOf(address(this));
        baseOut = converter.convertLaunchToBase(token, baseAsset, amount, minimumBaseOut, deadline, address(this));
        token.forceApprove(address(converter), 0);
        uint256 delta = baseAsset.balanceOf(address(this)) - beforeBalance;
        if (baseOut != delta || baseOut < minimumBaseOut) revert InvalidConfiguration();
        account.cumulativeLaunchFeesConverted += amount;
        emit LaunchFeesConverted(address(token), amount, baseOut);
        _allocateBase(address(token), account, msg.sender, baseOut);
    }

    function convertPendingToNative(IERC20 token, uint256 maximumBaseInput, uint256 minimumNativeOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeOut)
    {
        LaunchFeeAccount storage account = _launchAccounts[address(token)];
        if (!account.registered) revert UnknownLaunch();
        if (paused) revert ConversionPaused();
        if (address(converter) == address(0) || maximumBaseInput == 0 || minimumNativeOut == 0) {
            revert InvalidConfiguration();
        }
        uint256 totalPending = account.pendingCreatorBase + account.pendingDaoRewardBase + account.pendingTreasuryBase;
        if (totalPending == 0) revert NothingPending();
        uint256 totalBase = maximumBaseInput < totalPending ? maximumBaseInput : totalPending;
        uint256 creatorBase = (totalBase * account.pendingCreatorBase) / totalPending;
        uint256 daoBase = (totalBase * account.pendingDaoRewardBase) / totalPending;
        uint256 treasuryBase = totalBase - creatorBase - daoBase;
        account.pendingCreatorBase -= creatorBase;
        account.pendingDaoRewardBase -= daoBase;
        account.pendingTreasuryBase -= treasuryBase;
        baseAsset.forceApprove(address(converter), totalBase);
        uint256 nativeBefore = address(this).balance;
        nativeOut =
            converter.convertBaseToNative(baseAsset, totalBase, minimumNativeOut, deadline, payable(address(this)));
        baseAsset.forceApprove(address(converter), 0);
        uint256 delta = address(this).balance - nativeBefore;
        if (nativeOut != delta || nativeOut < minimumNativeOut) revert InvalidConfiguration();
        _creditNative(account, address(token), totalBase, creatorBase, daoBase, nativeOut);
    }

    function _creditNative(
        LaunchFeeAccount storage account,
        address token,
        uint256 totalBase,
        uint256 creatorBase,
        uint256 daoBase,
        uint256 nativeOut
    ) private {
        uint256 creatorOut = (nativeOut * creatorBase) / totalBase;
        uint256 daoOut = (nativeOut * daoBase) / totalBase;
        uint256 treasuryOut = nativeOut - creatorOut - daoOut;
        creatorNativeClaims[account.creator] += creatorOut;
        totalCreatorNativeLiability += creatorOut;
        totalDaoNativeRewards += daoOut;
        totalTreasuryNative += treasuryOut;
        account.cumulativeNativeConverted += nativeOut;
        daoToken.depositRewards{value: daoOut}();
        (bool sent,) = treasury.call{value: treasuryOut}("");
        if (!sent) revert NativeTransferFailed();
        emit NativeFeesConverted(token, totalBase, nativeOut, creatorOut, daoOut, treasuryOut);
    }

    function claimCreatorFees() external returns (uint256 amount) {
        return _claimCreator(msg.sender, payable(msg.sender));
    }

    function claimCreatorFeesTo(address payable recipient) external returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidConfiguration();
        return _claimCreator(msg.sender, recipient);
    }

    function _claimCreator(address creator, address payable recipient) private nonReentrant returns (uint256 amount) {
        amount = creatorNativeClaims[creator];
        if (amount == 0) revert NothingPending();
        creatorNativeClaims[creator] = 0;
        totalCreatorNativeLiability -= amount;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
        emit CreatorFeesClaimed(creator, recipient, amount);
    }

    function _authorizedAccount(address token) private view returns (LaunchFeeAccount storage account) {
        account = _launchAccounts[token];
        if (!account.registered) revert UnknownLaunch();
        if (msg.sender != account.market && msg.sender != account.locker) revert InvalidSource();
    }

    function _allocateBase(address token, LaunchFeeAccount storage account, address source, uint256 amount) private {
        if (amount == 0) revert InvalidConfiguration();
        uint256 creatorAmount = (amount * CREATOR_BPS) / BPS;
        uint256 daoAmount = (amount * DAO_REWARD_BPS) / BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / BPS;
        uint256 basketAmount = amount - creatorAmount - daoAmount - treasuryAmount;
        account.pendingCreatorBase += creatorAmount;
        account.pendingDaoRewardBase += daoAmount;
        account.pendingTreasuryBase += treasuryAmount;
        account.cumulativeBaseFees += amount;
        baseAsset.forceApprove(address(account.vault), basketAmount);
        account.vault.recordFees(basketAmount);
        baseAsset.forceApprove(address(account.vault), 0);
        emit BaseFeesRouted(token, source, amount, basketAmount, creatorAmount, daoAmount, treasuryAmount);
    }
}
