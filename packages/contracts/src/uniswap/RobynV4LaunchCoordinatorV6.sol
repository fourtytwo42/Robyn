// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { RobynNativeBasketVaultV2 } from "./RobynNativeBasketVaultV2.sol";
import { RobynNativeLaunchFactoryV4 } from "./RobynNativeLaunchFactoryV4.sol";
import { RobynNativeProtocolFeeRouterV4 } from "./RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4BondingCurveMarket } from "./RobynV4BondingCurveMarket.sol";
import { RobynV4GraduationAdapter } from "./RobynV4GraduationAdapter.sol";
import { RobynV4MarketFactory } from "./RobynV4MarketFactory.sol";

/// @notice One-transaction native-ETH launch coordinator for Robyn v4 markets.
contract RobynV4LaunchCoordinatorV6 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "6.0.0";

    error InvalidConfiguration();
    error AtomicLaunchInvariant();
    error Unauthorized();
    error LaunchesPaused();
    error CanaryLauncherOnly(address expected, address actual);

    enum LaunchMode {
        Paused,
        Canary,
        Public
    }

    struct LaunchArtifacts {
        uint256 launchId;
        RobynLaunchToken token;
        RobynNativeBasketVaultV2 vault;
        RobynV4BondingCurveMarket market;
        RobynV4GraduationAdapter adapter;
        bytes32 poolId;
        address locker;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
        bytes32 metadataUriHash;
        RobynV4MarketFactory.GraduationProfile graduationProfile;
        bytes32 graduationProfileHash;
    }

    struct LaunchReceipt {
        address vault;
        address market;
        address adapter;
        address poolManager;
        bytes32 poolId;
        address positionManager;
        address hook;
        address locker;
        uint24 poolFeePips;
        int24 tickSpacing;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
        bytes32 metadataUriHash;
        RobynV4MarketFactory.GraduationProfile graduationProfile;
        bytes32 graduationProfileHash;
    }

    RobynNativeLaunchFactoryV4 public immutable launchFactory;
    RobynV4MarketFactory public immutable marketFactory;
    RobynNativeProtocolFeeRouterV4 public immutable feeRouter;
    uint256 public immutable initialSupply;
    address public immutable governor;
    address public immutable guardian;
    LaunchMode public launchMode;
    address public canaryLauncher;

    event LaunchModeChanged(
        LaunchMode indexed previousMode,
        LaunchMode indexed newMode,
        address indexed canaryLauncher,
        address actor
    );
    event AtomicV4LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        LaunchReceipt receipt
    );
    event AtomicInitialPurchase(
        address indexed token, address indexed creator, uint256 nativeInput, uint256 tokenOutput
    );

    constructor(
        RobynNativeLaunchFactoryV4 launchFactory_,
        RobynV4MarketFactory marketFactory_,
        RobynNativeProtocolFeeRouterV4 feeRouter_,
        address governor_,
        address guardian_
    ) {
        if (
            address(launchFactory_) == address(0) || address(marketFactory_) == address(0)
                || address(feeRouter_) == address(0) || address(launchFactory_).code.length == 0
                || address(marketFactory_).code.length == 0 || address(feeRouter_).code.length == 0
                || address(marketFactory_.launchFactory()) != address(launchFactory_)
                || address(marketFactory_.feeRouter()) != address(feeRouter_)
                || governor_ == address(0) || guardian_ == address(0) || governor_ == guardian_
                || marketFactory_.governor() != governor_
        ) revert InvalidConfiguration();
        launchFactory = launchFactory_;
        marketFactory = marketFactory_;
        feeRouter = feeRouter_;
        governor = governor_;
        guardian = guardian_;
        initialSupply = marketFactory_.requiredTokenSupply();
        if (initialSupply == 0) revert InvalidConfiguration();
        emit LaunchModeChanged(LaunchMode.Paused, LaunchMode.Paused, address(0), msg.sender);
    }

    function pauseLaunches() external {
        if (msg.sender != guardian && msg.sender != governor) revert Unauthorized();
        _setLaunchMode(LaunchMode.Paused, canaryLauncher);
    }

    function setCanaryMode(address launcher) external {
        if (msg.sender != governor) revert Unauthorized();
        if (launcher == address(0)) revert InvalidConfiguration();
        _setLaunchMode(LaunchMode.Canary, launcher);
    }

    function setPublicMode() external {
        if (msg.sender != governor) revert Unauthorized();
        _setLaunchMode(LaunchMode.Public, canaryLauncher);
    }

    function _setLaunchMode(LaunchMode newMode, address launcher) private {
        LaunchMode previousMode = launchMode;
        launchMode = newMode;
        canaryLauncher = launcher;
        emit LaunchModeChanged(previousMode, newMode, launcher, msg.sender);
    }

    function _requireLaunchAuthorized(address launcher) private view {
        if (launchMode == LaunchMode.Paused) revert LaunchesPaused();
        if (launchMode == LaunchMode.Canary && launcher != canaryLauncher) {
            revert CanaryLauncherOnly(canaryLauncher, launcher);
        }
    }

    function createLaunch(RobynNativeLaunchFactoryV4.LaunchRequest calldata request)
        external
        payable
        nonReentrant
        returns (
            RobynLaunchToken token,
            RobynNativeBasketVaultV2 vault,
            RobynV4BondingCurveMarket market
        )
    {
        _requireLaunchAuthorized(msg.sender);
        launchFactory.requireBasketRoutes(request.assets);
        LaunchArtifacts memory artifacts;
        RobynNativeLaunchFactoryV4.CreatedLaunch memory created =
            launchFactory.createLaunchFor(msg.sender, address(this), initialSupply, request);
        artifacts.launchId = created.launchId;
        artifacts.token = created.token;
        artifacts.vault = created.vault;
        artifacts.configurationHash = created.configurationHash;
        artifacts.launchSaltHash = created.launchSaltHash;
        artifacts.metadataUriHash = keccak256(bytes(request.metadataUri));
        artifacts.market = marketFactory.createMarketFor(
            artifacts.token, msg.sender, address(this), request.expectedGraduationProfileVersion
        );
        artifacts.graduationProfile =
            marketFactory.graduationProfileByToken(address(artifacts.token));
        artifacts.graduationProfileHash =
            marketFactory.graduationProfileHashByToken(address(artifacts.token));
        artifacts.configurationHash =
            keccak256(abi.encode(created.configurationHash, artifacts.graduationProfileHash));
        artifacts.adapter = artifacts.market.graduationAdapter();
        artifacts.poolId = artifacts.adapter.poolId();
        artifacts.locker = address(artifacts.adapter.locker());

        feeRouter.registerLaunch(
            IERC20(address(artifacts.token)),
            msg.sender,
            artifacts.vault,
            address(artifacts.market),
            artifacts.locker,
            address(marketFactory.oracleHook())
        );
        IERC20 launchAsset = IERC20(address(artifacts.token));
        launchAsset.forceApprove(address(artifacts.market), initialSupply);
        artifacts.market.seed(initialSupply);
        launchAsset.forceApprove(address(artifacts.market), 0);

        address[] memory exclusions = _exclusions(artifacts);
        launchFactory.sealLaunchExclusionsFor(artifacts.token, exclusions);
        uint256 initialPurchaseTokenOutput;
        if (msg.value != 0) {
            if (msg.value >= artifacts.market.graduationThresholdNative()) {
                revert InvalidConfiguration();
            }
            initialPurchaseTokenOutput = artifacts.market.buyFor{ value: msg.value }(msg.sender, 1);
            emit AtomicInitialPurchase(
                address(artifacts.token), msg.sender, msg.value, initialPurchaseTokenOutput
            );
        }
        _assertLaunch(artifacts, launchAsset, exclusions, initialPurchaseTokenOutput);
        _emitLaunch(artifacts);
        return (artifacts.token, artifacts.vault, artifacts.market);
    }

    function predictLaunchAddresses(
        address creator,
        RobynNativeLaunchFactoryV4.LaunchRequest calldata request
    )
        external
        view
        returns (address predictedToken, address predictedVault, bytes32 launchSaltHash)
    {
        return launchFactory.predictLaunchAddresses(creator, address(this), initialSupply, request);
    }

    function _exclusions(LaunchArtifacts memory artifacts)
        private
        view
        returns (address[] memory exclusions)
    {
        exclusions = new address[](10);
        exclusions[0] = address(artifacts.market);
        exclusions[1] = address(artifacts.adapter);
        exclusions[2] = artifacts.locker;
        exclusions[3] = address(this);
        exclusions[4] = address(feeRouter);
        exclusions[5] = address(marketFactory.assetRouter());
        exclusions[6] = address(marketFactory.oracleHook());
        exclusions[7] = address(marketFactory.poolManager());
        exclusions[8] = address(marketFactory.positionManager());
        exclusions[9] = marketFactory.tokenSink();
    }

    function _assertLaunch(
        LaunchArtifacts memory artifacts,
        IERC20 launchAsset,
        address[] memory exclusions,
        uint256 initialPurchaseTokenOutput
    ) private view {
        if (
            launchAsset.balanceOf(address(this)) != 0
                || launchAsset.allowance(address(this), address(artifacts.market)) != 0
                || launchAsset.balanceOf(address(artifacts.market))
                    != initialSupply - initialPurchaseTokenOutput
                || launchAsset.balanceOf(msg.sender) != initialPurchaseTokenOutput
                || !artifacts.market.seeded() || artifacts.market.graduated()
                || !artifacts.token.exclusionsSealed()
                || marketFactory.marketByToken(address(artifacts.token))
                    != address(artifacts.market)
                || marketFactory.adapterByToken(address(artifacts.token))
                    != address(artifacts.adapter)
                || marketFactory.poolIdByToken(address(artifacts.token)) != artifacts.poolId
                || artifacts.graduationProfile.version == 0
                || artifacts.market.initialVirtualNativeReserve()
                    != artifacts.graduationProfile.initialVirtualNativeReserve
                || artifacts.market.graduationThresholdNative()
                    != artifacts.graduationProfile.actualGraduationNative
                || artifacts.market.maximumCurvePurchase()
                    != artifacts.graduationProfile.maximumCurvePurchase
                || marketFactory.graduationProfileHashByToken(address(artifacts.token))
                    != artifacts.graduationProfileHash
        ) revert AtomicLaunchInvariant();
        for (uint256 index; index < exclusions.length; ++index) {
            if (!artifacts.token.isExcluded(exclusions[index])) revert AtomicLaunchInvariant();
        }
    }

    function _emitLaunch(LaunchArtifacts memory artifacts) private {
        LaunchReceipt memory receipt = LaunchReceipt({
            vault: address(artifacts.vault),
            market: address(artifacts.market),
            adapter: address(artifacts.adapter),
            poolManager: address(marketFactory.poolManager()),
            poolId: artifacts.poolId,
            positionManager: address(marketFactory.positionManager()),
            hook: address(marketFactory.oracleHook()),
            locker: artifacts.locker,
            poolFeePips: marketFactory.POOL_FEE_PIPS(),
            tickSpacing: marketFactory.TICK_SPACING(),
            configurationHash: artifacts.configurationHash,
            launchSaltHash: artifacts.launchSaltHash,
            metadataUriHash: artifacts.metadataUriHash,
            graduationProfile: artifacts.graduationProfile,
            graduationProfileHash: artifacts.graduationProfileHash
        });
        emit AtomicV4LaunchCreated(
            artifacts.launchId, msg.sender, address(artifacts.token), receipt
        );
    }
}
