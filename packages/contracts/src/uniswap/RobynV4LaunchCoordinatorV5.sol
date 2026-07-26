// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { RobynNativeBasketVaultV2 } from "./RobynNativeBasketVaultV2.sol";
import { RobynNativeLaunchFactoryV4 } from "./RobynNativeLaunchFactoryV4.sol";
import { RobynNativeProtocolFeeRouterV3 } from "./RobynNativeProtocolFeeRouterV3.sol";
import { RobynV4BondingCurveMarket } from "./RobynV4BondingCurveMarket.sol";
import { RobynV4GraduationAdapter } from "./RobynV4GraduationAdapter.sol";
import { RobynV4MarketFactory } from "./RobynV4MarketFactory.sol";

/// @notice One-transaction native-ETH launch coordinator for Robyn v4 markets.
contract RobynV4LaunchCoordinatorV5 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "5.1.0";

    error InvalidConfiguration();
    error AtomicLaunchInvariant();

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
    }

    RobynNativeLaunchFactoryV4 public immutable launchFactory;
    RobynV4MarketFactory public immutable marketFactory;
    RobynNativeProtocolFeeRouterV3 public immutable feeRouter;
    uint256 public immutable initialSupply;

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
        RobynNativeProtocolFeeRouterV3 feeRouter_
    ) {
        if (
            address(launchFactory_) == address(0) || address(marketFactory_) == address(0)
                || address(feeRouter_) == address(0) || address(launchFactory_).code.length == 0
                || address(marketFactory_).code.length == 0 || address(feeRouter_).code.length == 0
                || address(marketFactory_.launchFactory()) != address(launchFactory_)
                || address(marketFactory_.feeRouter()) != address(feeRouter_)
        ) revert InvalidConfiguration();
        launchFactory = launchFactory_;
        marketFactory = marketFactory_;
        feeRouter = feeRouter_;
        initialSupply = marketFactory_.requiredTokenSupply();
        if (initialSupply == 0) revert InvalidConfiguration();
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
        artifacts.market = marketFactory.createMarketFor(artifacts.token, msg.sender, address(this));
        artifacts.adapter = artifacts.market.graduationAdapter();
        artifacts.poolId = artifacts.adapter.poolId();
        artifacts.locker = address(artifacts.adapter.locker());

        feeRouter.registerLaunch(
            IERC20(address(artifacts.token)),
            msg.sender,
            artifacts.vault,
            address(artifacts.market),
            artifacts.locker
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
        exclusions = new address[](9);
        exclusions[0] = address(artifacts.market);
        exclusions[1] = address(artifacts.adapter);
        exclusions[2] = artifacts.locker;
        exclusions[3] = address(this);
        exclusions[4] = address(feeRouter);
        exclusions[5] = address(marketFactory.assetRouter());
        exclusions[6] = address(marketFactory.oracleHook());
        exclusions[7] = address(marketFactory.poolManager());
        exclusions[8] = address(marketFactory.positionManager());
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
            metadataUriHash: artifacts.metadataUriHash
        });
        emit AtomicV4LaunchCreated(
            artifacts.launchId, msg.sender, address(artifacts.token), receipt
        );
    }
}
