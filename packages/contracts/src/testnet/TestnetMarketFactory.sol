// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchFactory } from "../RobynLaunchFactory.sol";
import { RobynLaunchToken } from "../RobynLaunchToken.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { TestnetFixedPriceMarket } from "./TestnetFixedPriceMarket.sol";

/// @notice Permissionless fixed-price market deployer for Robinhood testnet mock launches only.
contract TestnetMarketFactory {
    string public constant TESTNET_MOCK_ONLY = "robinhood-testnet-mock";

    error InvalidConfiguration();
    error Unauthorized();
    error MarketAlreadyExists();

    IERC20 public immutable baseAsset;
    RobynLaunchFactory public immutable launchFactory;
    uint256 public immutable basePerToken;
    uint16 public immutable feeBps;
    mapping(address => address) public marketByToken;

    event MarketCreated(address indexed creator, address indexed token, address indexed market);

    constructor(
        IERC20 baseAsset_,
        RobynLaunchFactory launchFactory_,
        uint256 basePerToken_,
        uint16 feeBps_
    ) {
        if (
            address(baseAsset_) == address(0) || address(launchFactory_) == address(0)
                || basePerToken_ == 0 || feeBps_ == 0 || feeBps_ > 1_000
                || address(launchFactory_.baseAsset()) != address(baseAsset_)
        ) revert InvalidConfiguration();
        baseAsset = baseAsset_;
        launchFactory = launchFactory_;
        basePerToken = basePerToken_;
        feeBps = feeBps_;
    }

    function createMarket(RobynLaunchToken token)
        external
        returns (TestnetFixedPriceMarket market)
    {
        if (launchFactory.creatorByToken(address(token)) != msg.sender) revert Unauthorized();
        if (marketByToken[address(token)] != address(0)) revert MarketAlreadyExists();
        address vaultAddress = launchFactory.vaultByToken(address(token));
        if (vaultAddress == address(0)) revert InvalidConfiguration();

        market = new TestnetFixedPriceMarket(
            baseAsset, token, FeeBasketVault(vaultAddress), msg.sender, basePerToken, feeBps
        );
        marketByToken[address(token)] = address(market);
        emit MarketCreated(msg.sender, address(token), address(market));
    }
}
