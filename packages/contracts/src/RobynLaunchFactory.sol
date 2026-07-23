// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchToken } from "./RobynLaunchToken.sol";
import { FeeBasketVault, IRobynConversionRouter } from "./FeeBasketVault.sol";

/// @notice Permissionless factory for fixed-supply community tokens and isolated fee vaults.
contract RobynLaunchFactory {
    string private constant LEGACY_METADATA_URI =
        "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q";
    error InvalidAddress();
    error Unauthorized();

    string public constant CONTRACT_VERSION = "1.0.0";
    uint256 public immutable chainId;
    IERC20 public immutable baseAsset;
    IRobynConversionRouter public immutable conversionRouter;
    uint256 public immutable minimumConversionBase;
    uint256 public immutable maximumPendingDelay;
    uint256 public launchCount;
    mapping(uint256 => address) public launchTokenById;
    mapping(address => address) public vaultByToken;
    mapping(address => address) public creatorByToken;

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
        uint256 minimumConversionBase_,
        uint256 maximumPendingDelay_
    ) {
        if (address(baseAsset_) == address(0) || address(conversionRouter_) == address(0)) {
            revert InvalidAddress();
        }
        baseAsset = baseAsset_;
        conversionRouter = conversionRouter_;
        minimumConversionBase = minimumConversionBase_;
        maximumPendingDelay = maximumPendingDelay_;
        chainId = block.chainid;
    }

    function createLaunch(
        string calldata name,
        string calldata symbol,
        uint256 initialSupply,
        address[] calldata assets,
        uint16[] calldata weights
    ) external returns (RobynLaunchToken token, FeeBasketVault vault) {
        vault = new FeeBasketVault(
            baseAsset,
            conversionRouter,
            address(this),
            assets,
            weights,
            minimumConversionBase,
            maximumPendingDelay
        );
        token = new RobynLaunchToken(
            name, symbol, msg.sender, initialSupply, address(vault), assets, LEGACY_METADATA_URI
        );
        vault.bindLaunchToken(token);
        uint256 launchId = ++launchCount;
        launchTokenById[launchId] = address(token);
        vaultByToken[address(token)] = address(vault);
        creatorByToken[address(token)] = msg.sender;
        bytes32 configurationHash =
            keccak256(abi.encode(block.chainid, address(token), address(vault), assets, weights));
        emit LaunchCreated(launchId, msg.sender, address(token), address(vault), configurationHash);
    }

    function sealLaunchExclusions(RobynLaunchToken token, address[] calldata accounts) external {
        if (creatorByToken[address(token)] != msg.sender) revert Unauthorized();
        token.sealExclusions(accounts);
        emit LaunchExclusionsSealed(address(token), accounts);
    }
}
