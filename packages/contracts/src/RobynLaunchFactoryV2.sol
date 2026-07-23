// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchToken } from "./RobynLaunchToken.sol";
import { FeeBasketVault, IRobynConversionRouter } from "./FeeBasketVault.sol";
import { RobynLaunchDeployerV2 } from "./RobynLaunchDeployerV2.sol";

/// @notice Coordinator-only factory for atomic fixed-supply Robyn launches.
contract RobynLaunchFactoryV2 {
    error InvalidAddress();
    error InvalidSalt();
    error Unauthorized();
    error CoordinatorNotBound();
    error CoordinatorAlreadyBound();
    error LaunchSaltAlreadyUsed(bytes32 launchSaltHash);

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
        FeeBasketVault vault;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
    }

    string public constant CONTRACT_VERSION = "3.0.0";
    uint256 public immutable chainId;
    IERC20 public immutable baseAsset;
    IRobynConversionRouter public immutable conversionRouter;
    RobynLaunchDeployerV2 public immutable launchDeployer;
    uint256 public immutable minimumConversionBase;
    uint256 public immutable maximumPendingDelay;
    address public immutable initializer;
    address public coordinator;
    uint256 public launchCount;
    mapping(uint256 => address) public launchTokenById;
    mapping(address => address) public vaultByToken;
    mapping(address => address) public creatorByToken;
    mapping(bytes32 => bool) public usedLaunchSalt;

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
        IERC20 baseAsset_,
        IRobynConversionRouter conversionRouter_,
        RobynLaunchDeployerV2 launchDeployer_,
        uint256 minimumConversionBase_,
        uint256 maximumPendingDelay_
    ) {
        if (
            address(baseAsset_) == address(0) || address(conversionRouter_) == address(0)
                || address(launchDeployer_) == address(0)
                || address(launchDeployer_).code.length == 0
        ) {
            revert InvalidAddress();
        }
        baseAsset = baseAsset_;
        conversionRouter = conversionRouter_;
        launchDeployer = launchDeployer_;
        minimumConversionBase = minimumConversionBase_;
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
        created.launchSaltHash = _launchSaltHash(creator, initialSupply, request);
        if (usedLaunchSalt[created.launchSaltHash]) {
            revert LaunchSaltAlreadyUsed(created.launchSaltHash);
        }
        usedLaunchSalt[created.launchSaltHash] = true;

        if (launchDeployer.controller() != address(this)) revert Unauthorized();
        bytes32 vaultSalt =
            keccak256(abi.encode(created.launchSaltHash, keccak256("ROBYN_VAULT_V2")));
        bytes32 tokenSalt =
            keccak256(abi.encode(created.launchSaltHash, keccak256("ROBYN_TOKEN_V2")));
        created.vault = launchDeployer.deployVault(
            vaultSalt,
            baseAsset,
            conversionRouter,
            request.assets,
            request.weights,
            minimumConversionBase,
            maximumPendingDelay
        );
        RobynLaunchDeployerV2.TokenRequest memory tokenRequest = RobynLaunchDeployerV2.TokenRequest({
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
                request.weights
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
        bytes32 vaultSalt = keccak256(abi.encode(launchSaltHash, keccak256("ROBYN_VAULT_V2")));
        predictedVault = launchDeployer.predictVault(
            vaultSalt,
            baseAsset,
            conversionRouter,
            request.assets,
            request.weights,
            minimumConversionBase,
            maximumPendingDelay
        );
        bytes32 tokenSalt = keccak256(abi.encode(launchSaltHash, keccak256("ROBYN_TOKEN_V2")));
        RobynLaunchDeployerV2.TokenRequest memory tokenRequest = RobynLaunchDeployerV2.TokenRequest({
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
