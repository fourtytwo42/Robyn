// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { FeeBasketVault } from "./FeeBasketVault.sol";
import { RobynLaunchFactoryV2 } from "./RobynLaunchFactoryV2.sol";
import { RobynLaunchToken } from "./RobynLaunchToken.sol";
import { UniswapV3BondingCurveMarket } from "./uniswap/UniswapV3BondingCurveMarket.sol";
import { UniswapV3GraduationAdapter } from "./uniswap/UniswapV3GraduationAdapter.sol";
import { UniswapV3MarketFactoryV2 } from "./uniswap/UniswapV3MarketFactoryV2.sol";

/// @notice Single-transaction launch, market creation, inventory seeding, and exclusion sealing.
contract RobynAtomicLaunchCoordinator is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "2.0.0";

    error InvalidConfiguration();
    error AtomicLaunchInvariant();

    struct LaunchArtifacts {
        uint256 launchId;
        RobynLaunchToken token;
        FeeBasketVault vault;
        UniswapV3BondingCurveMarket market;
        UniswapV3GraduationAdapter adapter;
        address pool;
        address locker;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
    }

    RobynLaunchFactoryV2 public immutable launchFactory;
    UniswapV3MarketFactoryV2 public immutable marketFactory;
    uint256 public immutable initialSupply;

    event AtomicLaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        address vault,
        address market,
        address adapter,
        address pool,
        address locker,
        bytes32 configurationHash,
        bytes32 launchSaltHash
    );

    constructor(RobynLaunchFactoryV2 launchFactory_, UniswapV3MarketFactoryV2 marketFactory_) {
        if (
            address(launchFactory_) == address(0) || address(marketFactory_) == address(0)
                || address(launchFactory_).code.length == 0
                || address(marketFactory_).code.length == 0
                || address(marketFactory_.launchFactory()) != address(launchFactory_)
        ) revert InvalidConfiguration();
        launchFactory = launchFactory_;
        marketFactory = marketFactory_;
        initialSupply =
            marketFactory_.curveTokenAllocation() + marketFactory_.graduationTokenAllocation();
        if (initialSupply == 0) revert InvalidConfiguration();
    }

    function createLaunch(RobynLaunchFactoryV2.LaunchRequest calldata request)
        external
        nonReentrant
        returns (RobynLaunchToken token, FeeBasketVault vault, UniswapV3BondingCurveMarket market)
    {
        LaunchArtifacts memory artifacts;
        RobynLaunchFactoryV2.CreatedLaunch memory created =
            launchFactory.createLaunchFor(msg.sender, address(this), initialSupply, request);
        artifacts.launchId = created.launchId;
        artifacts.token = created.token;
        artifacts.vault = created.vault;
        artifacts.configurationHash = created.configurationHash;
        artifacts.launchSaltHash = created.launchSaltHash;
        artifacts.market = marketFactory.createMarketFor(artifacts.token, msg.sender, address(this));
        artifacts.adapter = artifacts.market.graduationAdapter();
        artifacts.pool = artifacts.market.graduatedPool();
        artifacts.locker = artifacts.market.positionLocker();

        IERC20 launchAsset = IERC20(address(artifacts.token));
        launchAsset.forceApprove(address(artifacts.market), initialSupply);
        artifacts.market.seed(initialSupply, 0);
        launchAsset.forceApprove(address(artifacts.market), 0);

        address[] memory exclusions = new address[](5);
        exclusions[0] = address(artifacts.market);
        exclusions[1] = address(artifacts.adapter);
        exclusions[2] = artifacts.locker;
        exclusions[3] = artifacts.pool;
        exclusions[4] = address(this);
        launchFactory.sealLaunchExclusionsFor(artifacts.token, exclusions);

        if (
            launchAsset.balanceOf(address(this)) != 0
                || launchAsset.allowance(address(this), address(artifacts.market)) != 0
                || launchAsset.balanceOf(address(artifacts.market)) != initialSupply
                || !artifacts.market.seeded() || !artifacts.token.exclusionsSealed()
                || !artifacts.token.isExcluded(address(artifacts.market))
                || !artifacts.token.isExcluded(address(artifacts.adapter))
                || !artifacts.token.isExcluded(artifacts.locker)
                || !artifacts.token.isExcluded(artifacts.pool)
                || !artifacts.token.isExcluded(address(this))
        ) revert AtomicLaunchInvariant();

        emit AtomicLaunchCreated(
            artifacts.launchId,
            msg.sender,
            address(artifacts.token),
            address(artifacts.vault),
            address(artifacts.market),
            address(artifacts.adapter),
            artifacts.pool,
            artifacts.locker,
            artifacts.configurationHash,
            artifacts.launchSaltHash
        );
        return (artifacts.token, artifacts.vault, artifacts.market);
    }

    function predictLaunchAddresses(
        address creator,
        RobynLaunchFactoryV2.LaunchRequest calldata request
    )
        external
        view
        returns (address predictedToken, address predictedVault, bytes32 launchSaltHash)
    {
        return launchFactory.predictLaunchAddresses(creator, address(this), initialSupply, request);
    }
}
