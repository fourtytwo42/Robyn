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
        uint64 expectedGraduationProfileVersion;
    }

    struct CreatedLaunch {
        uint256 launchId;
        RobynLaunchToken token;
        RobynNativeBasketVaultV2 vault;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
    }

    struct LaunchSaltPreimage {
        uint256 chainId;
        address factory;
        address creator;
        bytes32 nameHash;
        bytes32 symbolHash;
        uint256 initialSupply;
        address[] assets;
        uint16[] weights;
        bytes32 metadataUriHash;
        bytes32 userSalt;
        uint64 expectedGraduationProfileVersion;
    }

    string public constant CONTRACT_VERSION = "7.0.0";
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
        _requireContract(address(assetRouter_));
        _requireContract(address(launchDeployer_));
        _requireContract(address(vaultDeployer_));
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
        created.launchSaltHash =
            _validateAndReserveLaunch(creator, supplyRecipient, initialSupply, request);
        (created.token, created.vault) =
            _deployLaunch(created.launchSaltHash, supplyRecipient, initialSupply, request);
        created.vault.bindLaunchToken(created.token);
        (created.launchId, created.configurationHash) =
            _recordLaunch(creator, created.token, created.vault, request);
        emit LaunchCreated(
            created.launchId,
            creator,
            address(created.token),
            address(created.vault),
            created.configurationHash
        );
    }

    function _validateAndReserveLaunch(
        address creator,
        address supplyRecipient,
        uint256 initialSupply,
        LaunchRequest calldata request
    ) private returns (bytes32 launchSaltHash) {
        if (creator == address(0) || supplyRecipient == address(0)) {
            revert InvalidAddress();
        }
        if (request.userSalt == bytes32(0)) revert InvalidSalt();
        requireBasketRoutes(request.assets);
        if (
            launchDeployer.controller() != address(this)
                || vaultDeployer.controller() != address(this)
        ) revert Unauthorized();
        launchSaltHash = _launchSaltHash(creator, initialSupply, request);
        if (usedLaunchSalt[launchSaltHash]) revert LaunchSaltAlreadyUsed(launchSaltHash);
        usedLaunchSalt[launchSaltHash] = true;
    }

    function _deployLaunch(
        bytes32 launchSaltHash,
        address supplyRecipient,
        uint256 initialSupply,
        LaunchRequest calldata request
    ) private returns (RobynLaunchToken token, RobynNativeBasketVaultV2 vault) {
        bytes32 vaultSalt =
            keccak256(abi.encode(launchSaltHash, keccak256("ROBYN_NATIVE_VAULT_V2")));
        vault = vaultDeployer.deployVault(
            vaultSalt,
            assetRouter,
            request.assets,
            request.weights,
            minimumConversionNative,
            maximumPendingDelay
        );
        RobynNativeLaunchDeployerV4.TokenRequest memory tokenRequest =
            _tokenRequest(request, supplyRecipient, initialSupply, address(vault));
        bytes32 tokenSalt =
            keccak256(abi.encode(launchSaltHash, keccak256("ROBYN_NATIVE_TOKEN_V4")));
        token = launchDeployer.deployToken(tokenSalt, tokenRequest);
    }

    function _recordLaunch(
        address creator,
        RobynLaunchToken token,
        RobynNativeBasketVaultV2 vault,
        LaunchRequest calldata request
    ) private returns (uint256 launchId, bytes32 configurationHash) {
        launchId = ++launchCount;
        launchTokenById[launchId] = address(token);
        vaultByToken[address(token)] = address(vault);
        creatorByToken[address(token)] = creator;
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(token),
                address(vault),
                request.assets,
                request.weights,
                keccak256(bytes(request.metadataUri)),
                request.expectedGraduationProfileVersion
            )
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
            _tokenRequest(request, supplyRecipient, initialSupply, predictedVault);
        predictedToken = launchDeployer.predictToken(tokenSalt, tokenRequest);
    }

    function _tokenRequest(
        LaunchRequest calldata request,
        address supplyRecipient,
        uint256 initialSupply,
        address vault
    ) private pure returns (RobynNativeLaunchDeployerV4.TokenRequest memory tokenRequest) {
        tokenRequest = RobynNativeLaunchDeployerV4.TokenRequest({
            name: request.name,
            symbol: request.symbol,
            supplyRecipient: supplyRecipient,
            initialSupply: initialSupply,
            vault: vault,
            assets: request.assets,
            tokenUri: request.metadataUri
        });
    }

    function _requireContract(address account) private view {
        if (account == address(0) || account.code.length == 0) revert InvalidAddress();
    }

    function _launchSaltHash(address creator, uint256 initialSupply, LaunchRequest calldata request)
        private
        view
        returns (bytes32)
    {
        LaunchSaltPreimage memory preimage;
        preimage.chainId = block.chainid;
        preimage.factory = address(this);
        preimage.creator = creator;
        preimage.nameHash = keccak256(bytes(request.name));
        preimage.symbolHash = keccak256(bytes(request.symbol));
        preimage.initialSupply = initialSupply;
        preimage.assets = request.assets;
        preimage.weights = request.weights;
        preimage.metadataUriHash = keccak256(bytes(request.metadataUri));
        preimage.userSalt = request.userSalt;
        preimage.expectedGraduationProfileVersion = request.expectedGraduationProfileVersion;
        // A dynamic tuple encoded as one struct starts with a 32-byte top-level
        // offset. Hashing the tuple payload preserves the legacy flat abi.encode
        // preimage while avoiding the compiler's unoptimized stack overflow.
        bytes memory encoded = abi.encode(preimage);
        bytes32 result;
        assembly ("memory-safe") {
            result := keccak256(add(encoded, 0x40), sub(mload(encoded), 0x20))
        }
        return result;
    }
}
