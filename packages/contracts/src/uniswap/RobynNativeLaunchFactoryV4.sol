// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { RobynNativeBasketVaultV2 } from "./RobynNativeBasketVaultV2.sol";
import { RobynNativeLaunchDeployerV4 } from "./RobynNativeLaunchDeployerV4.sol";
import { RobynNativeVaultDeployerV4 } from "./RobynNativeVaultDeployerV4.sol";
import { RobynV4AssetRouter } from "./RobynV4AssetRouter.sol";

/// @notice Coordinator-only CREATE2 factory for native-ETH Robyn launches.
contract RobynNativeLaunchFactoryV4 {
    error InvalidAddress();
    error InvalidSalt();
    error Unauthorized();
    error CoordinatorNotBound();
    error CoordinatorAlreadyBound();
    error LaunchSaltAlreadyUsed(bytes32 launchSaltHash);
    error AssetRouteUnavailable(uint256 index, address asset, bytes32 reason);

    struct LaunchRequest {
        string name;
        string symbol;
        address[] assets;
        uint16[] weights;
        string metadataUri;
        bytes32 userSalt;
    }

    struct CreatedLaunch {
        uint256 launchId;
        RobynLaunchToken token;
        RobynNativeBasketVaultV2 vault;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
    }

    string public constant CONTRACT_VERSION = "5.0.0";
    uint256 public immutable chainId;
    RobynV4AssetRouter public immutable assetRouter;
    RobynNativeLaunchDeployerV4 public immutable launchDeployer;
    RobynNativeVaultDeployerV4 public immutable vaultDeployer;
    uint256 public immutable minimumConversionNative;
    uint256 public immutable maximumPendingDelay;
    address public immutable initializer;
    address public coordinator;
    uint256 public launchCount;
    mapping(uint256 launchId => address token) public launchTokenById;
    mapping(address token => address vault) public vaultByToken;
    mapping(address token => address creator) public creatorByToken;
    mapping(bytes32 launchSaltHash => bool used) public usedLaunchSalt;

    event CoordinatorBound(address indexed coordinator);
    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        address vault,
        bytes32 configurationHash
    );
    event LaunchExclusionsSealed(address indexed token, address[] accounts);

    constructor(
        RobynV4AssetRouter assetRouter_,
        RobynNativeLaunchDeployerV4 launchDeployer_,
        RobynNativeVaultDeployerV4 vaultDeployer_,
        uint256 minimumConversionNative_,
        uint256 maximumPendingDelay_
    ) {
        if (
            address(assetRouter_) == address(0) || address(launchDeployer_) == address(0)
                || address(vaultDeployer_) == address(0) || address(assetRouter_).code.length == 0
                || address(launchDeployer_).code.length == 0
                || address(vaultDeployer_).code.length == 0
        ) revert InvalidAddress();
        assetRouter = assetRouter_;
        launchDeployer = launchDeployer_;
        vaultDeployer = vaultDeployer_;
        minimumConversionNative = minimumConversionNative_;
        maximumPendingDelay = maximumPendingDelay_;
        chainId = block.chainid;
        initializer = msg.sender;
    }

    modifier onlyCoordinator() {
        if (coordinator == address(0)) revert CoordinatorNotBound();
        if (msg.sender != coordinator) revert Unauthorized();
        _;
    }

    function bindCoordinator(address coordinator_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (coordinator != address(0)) revert CoordinatorAlreadyBound();
        if (coordinator_ == address(0) || coordinator_.code.length == 0) revert InvalidAddress();
        coordinator = coordinator_;
        emit CoordinatorBound(coordinator_);
    }

    function requireBasketRoutes(address[] calldata assets) public view {
        if (assets.length == 0 || assets.length > 3) revert InvalidAddress();
        for (uint256 index; index < assets.length; ++index) {
            RobynV4AssetRouter.RouteStatus memory status = assetRouter.routeStatus(assets[index]);
            if (!status.ready) {
                revert AssetRouteUnavailable(index, assets[index], status.reason);
            }
        }
    }

    function createLaunchFor(
        address creator,
        address supplyRecipient,
        uint256 initialSupply,
        LaunchRequest calldata request
    ) external onlyCoordinator returns (CreatedLaunch memory created) {
        if (creator == address(0) || supplyRecipient == address(0)) {
            revert InvalidAddress();
        }
        if (request.userSalt == bytes32(0)) revert InvalidSalt();
        requireBasketRoutes(request.assets);
        created.launchSaltHash = _launchSaltHash(creator, initialSupply, request);
        if (usedLaunchSalt[created.launchSaltHash]) {
            revert LaunchSaltAlreadyUsed(created.launchSaltHash);
        }
        usedLaunchSalt[created.launchSaltHash] = true;
        if (
            launchDeployer.controller() != address(this)
                || vaultDeployer.controller() != address(this)
        ) revert Unauthorized();
        bytes32 vaultSalt =
            keccak256(abi.encode(created.launchSaltHash, keccak256("ROBYN_NATIVE_VAULT_V2")));
        bytes32 tokenSalt =
            keccak256(abi.encode(created.launchSaltHash, keccak256("ROBYN_NATIVE_TOKEN_V4")));
        created.vault = vaultDeployer.deployVault(
            vaultSalt,
            assetRouter,
            request.assets,
            request.weights,
            minimumConversionNative,
            maximumPendingDelay
        );
        RobynNativeLaunchDeployerV4.TokenRequest memory tokenRequest =
            RobynNativeLaunchDeployerV4.TokenRequest({
                name: request.name,
                symbol: request.symbol,
                supplyRecipient: supplyRecipient,
                initialSupply: initialSupply,
                vault: address(created.vault),
                assets: request.assets,
                tokenUri: request.metadataUri
            });
        created.token = launchDeployer.deployToken(tokenSalt, tokenRequest);
        created.vault.bindLaunchToken(created.token);
        created.launchId = ++launchCount;
        launchTokenById[created.launchId] = address(created.token);
        vaultByToken[address(created.token)] = address(created.vault);
        creatorByToken[address(created.token)] = creator;
        created.configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(created.token),
                address(created.vault),
                request.assets,
                request.weights,
                keccak256(bytes(request.metadataUri))
            )
        );
        emit LaunchCreated(
            created.launchId,
            creator,
            address(created.token),
            address(created.vault),
            created.configurationHash
        );
    }

    function sealLaunchExclusionsFor(RobynLaunchToken token, address[] calldata accounts)
        external
        onlyCoordinator
    {
        if (creatorByToken[address(token)] == address(0)) revert InvalidAddress();
        launchDeployer.sealExclusions(token, accounts);
        emit LaunchExclusionsSealed(address(token), accounts);
    }

    function predictLaunchAddresses(
        address creator,
        address supplyRecipient,
        uint256 initialSupply,
        LaunchRequest calldata request
    )
        external
        view
        returns (address predictedToken, address predictedVault, bytes32 launchSaltHash)
    {
        launchSaltHash = _launchSaltHash(creator, initialSupply, request);
        bytes32 vaultSalt =
            keccak256(abi.encode(launchSaltHash, keccak256("ROBYN_NATIVE_VAULT_V2")));
        predictedVault = vaultDeployer.predictVault(
            vaultSalt,
            assetRouter,
            request.assets,
            request.weights,
            minimumConversionNative,
            maximumPendingDelay
        );
        bytes32 tokenSalt =
            keccak256(abi.encode(launchSaltHash, keccak256("ROBYN_NATIVE_TOKEN_V4")));
        RobynNativeLaunchDeployerV4.TokenRequest memory tokenRequest =
            RobynNativeLaunchDeployerV4.TokenRequest({
                name: request.name,
                symbol: request.symbol,
                supplyRecipient: supplyRecipient,
                initialSupply: initialSupply,
                vault: predictedVault,
                assets: request.assets,
                tokenUri: request.metadataUri
            });
        predictedToken = launchDeployer.predictToken(tokenSalt, tokenRequest);
    }

    function _launchSaltHash(address creator, uint256 initialSupply, LaunchRequest calldata request)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                creator,
                keccak256(bytes(request.name)),
                keccak256(bytes(request.symbol)),
                initialSupply,
                request.assets,
                request.weights,
                keccak256(bytes(request.metadataUri)),
                request.userSalt
            )
        );
    }
}
