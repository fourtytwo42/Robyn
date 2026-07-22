// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchFactory } from "../RobynLaunchFactory.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { DevnetBondingCurveMarket } from "./DevnetBondingCurveMarket.sol";

/// @notice Permissionless bonding-curve market deployer for controlled-devnet launches only.
contract DevnetMarketFactory {
    string public constant DEVNET_ONLY = "robyn-devnet";

    error InvalidConfiguration();
    error Unauthorized();
    error MarketAlreadyExists();

    IERC20 public immutable baseAsset;
    RobynLaunchFactory public immutable launchFactory;
    uint256 public immutable curveTokenAllocation;
    uint256 public immutable graduationTokenAllocation;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualBaseReserve;
    uint256 public immutable graduationThresholdBase;
    uint16 public immutable feeBps;
    mapping(address => address) public marketByToken;

    event MarketCreated(address indexed creator, address indexed token, address indexed market);

    constructor(
        IERC20 baseAsset_,
        RobynLaunchFactory launchFactory_,
        uint256 curveTokenAllocation_,
        uint256 graduationTokenAllocation_,
        uint256 initialVirtualTokenReserve_,
        uint256 initialVirtualBaseReserve_,
        uint256 graduationThresholdBase_,
        uint16 feeBps_
    ) {
        if (
            address(baseAsset_) == address(0) || address(launchFactory_) == address(0)
                || curveTokenAllocation_ == 0 || graduationTokenAllocation_ == 0
                || initialVirtualTokenReserve_ <= curveTokenAllocation_
                || initialVirtualBaseReserve_ == 0 || graduationThresholdBase_ == 0 || feeBps_ == 0
                || feeBps_ > 1_000 || address(launchFactory_.baseAsset()) != address(baseAsset_)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchFactory = launchFactory_;
        curveTokenAllocation = curveTokenAllocation_;
        graduationTokenAllocation = graduationTokenAllocation_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        initialVirtualBaseReserve = initialVirtualBaseReserve_;
        graduationThresholdBase = graduationThresholdBase_;
        feeBps = feeBps_;
    }

    function createMarket(RobynLaunchToken token)
        external
        returns (DevnetBondingCurveMarket market)
    {
        if (launchFactory.creatorByToken(address(token)) != msg.sender) revert Unauthorized();
        if (marketByToken[address(token)] != address(0)) revert MarketAlreadyExists();
        address vaultAddress = launchFactory.vaultByToken(address(token));
        if (vaultAddress == address(0)) revert InvalidConfiguration();

        market = new DevnetBondingCurveMarket(
            baseAsset,
            token,
            FeeBasketVault(vaultAddress),
            msg.sender,
            curveTokenAllocation,
            graduationTokenAllocation,
            initialVirtualTokenReserve,
            initialVirtualBaseReserve,
            graduationThresholdBase,
            feeBps
        );
        marketByToken[address(token)] = address(market);
        emit MarketCreated(msg.sender, address(token), address(market));
    }
}
