// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchToken as LaunchAsset } from "../src/RobynLaunchToken.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4AssetRouter } from "../src/uniswap/RobynV4AssetRouter.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4GraduationAdapter } from "../src/uniswap/RobynV4GraduationAdapter.sol";
import { RobynV4NativeProtocolTest } from "./RobynV4NativeProtocol.t.sol";

contract NativeV4InvariantActor {
    receive() external payable { }

    function buy(RobynV4BondingCurveMarket market, uint256 amount) external {
        market.buy{ value: amount }(1);
    }

    function sell(LaunchAsset launchAsset, RobynV4BondingCurveMarket market, uint256 amount)
        external
    {
        launchAsset.approve(address(market), amount);
        market.sell(amount, 1);
        launchAsset.approve(address(market), 0);
    }

    function transferToken(LaunchAsset token, address recipient, uint256 amount) external {
        token.transfer(recipient, amount);
    }

    function claimAll(LaunchAsset token) external {
        token.claimAll();
    }
}

contract NativeV4InvariantHandler {
    uint256 private constant MAX_BUY = 0.01 ether;
    uint256 private constant MAX_CONVERSION = 0.005 ether;

    LaunchAsset public immutable token;
    RobynNativeBasketVaultV2 public immutable vault;
    RobynV4BondingCurveMarket public immutable market;
    RobynV4AssetRouter public immutable assetRouter;
    NativeV4InvariantActor[] private _actors;

    constructor(
        LaunchAsset token_,
        RobynNativeBasketVaultV2 vault_,
        RobynV4BondingCurveMarket market_,
        RobynV4AssetRouter assetRouter_,
        NativeV4InvariantActor[] memory actors_
    ) {
        token = token_;
        vault = vault_;
        market = market_;
        assetRouter = assetRouter_;
        for (uint256 i; i < actors_.length; ++i) {
            _actors.push(actors_[i]);
        }
    }

    function buy(uint8 actorSeed, uint96 amountSeed) external {
        NativeV4InvariantActor selected = _actor(actorSeed);
        uint256 available = address(selected).balance;
        if (available == 0) return;
        uint256 ceiling = available < MAX_BUY ? available : MAX_BUY;
        uint256 amount = (uint256(amountSeed) % ceiling) + 1;
        try selected.buy(market, amount) { } catch { }
    }

    function sell(uint8 actorSeed, uint96 amountSeed) external {
        NativeV4InvariantActor selected = _actor(actorSeed);
        uint256 available = token.balanceOf(address(selected));
        if (available == 0) return;
        uint256 amount = (uint256(amountSeed) % available) + 1;
        try selected.sell(token, market, amount) { } catch { }
    }

    function transfer(uint8 fromSeed, uint8 toSeed, uint96 amountSeed) external {
        uint256 fromIndex = uint256(fromSeed) % _actors.length;
        uint256 toIndex = uint256(toSeed) % _actors.length;
        if (fromIndex == toIndex) toIndex = (toIndex + 1) % _actors.length;
        uint256 available = token.balanceOf(address(_actors[fromIndex]));
        if (available == 0) return;
        uint256 amount = (uint256(amountSeed) % available) + 1;
        _actors[fromIndex].transferToken(token, address(_actors[toIndex]), amount);
    }

    function convert(uint96 amountSeed) external {
        RobynNativeBasketVaultV2.BasketLeg memory selected = vault.leg(0);
        if (selected.pendingNative == 0) return;
        uint256 ceiling =
            selected.pendingNative < MAX_CONVERSION ? selected.pendingNative : MAX_CONVERSION;
        uint256 amount = (uint256(amountSeed) % ceiling) + 1;
        try assetRouter.quoteNativeToAsset(address(selected.asset), uint128(amount)) returns (
            uint256 quote, uint256
        ) {
            if (quote == 0) return;
            try vault.convertLeg(0, amount, (quote * 99) / 100, block.timestamp + 1) { } catch { }
        } catch { }
    }

    function claim(uint8 actorSeed) external {
        try _actor(actorSeed).claimAll(token) { } catch { }
    }

    function actor(uint256 index) external view returns (address) {
        return address(_actors[index]);
    }

    function actorCount() external view returns (uint256) {
        return _actors.length;
    }

    function _actor(uint8 seed) private view returns (NativeV4InvariantActor) {
        return _actors[uint256(seed) % _actors.length];
    }
}

contract RobynV4ProtocolInvariantTest is RobynV4NativeProtocolTest {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant ACTOR_COUNT = 6;

    LaunchAsset private invariantToken;
    RobynNativeBasketVaultV2 private invariantVault;
    RobynV4BondingCurveMarket private invariantMarket;
    NativeV4InvariantHandler private invariantHandler;
    NativeV4InvariantActor[] private invariantActors;

    function setUp() public override {
        super.setUp();
        (invariantToken, invariantVault, invariantMarket) =
            coordinator.createLaunch(_request(keccak256("invariant")));
        NativeV4InvariantActor[] memory actors = new NativeV4InvariantActor[](ACTOR_COUNT);
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            NativeV4InvariantActor actor = new NativeV4InvariantActor();
            vm.deal(address(actor), 10 ether);
            actors[i] = actor;
            invariantActors.push(actor);
        }
        invariantHandler = new NativeV4InvariantHandler(
            invariantToken, invariantVault, invariantMarket, assetRouter, actors
        );
        targetContract(address(invariantHandler));
    }

    function invariantNativeFeePolicyIsConserved() public view {
        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(address(invariantToken));
        assertEq(
            account.cumulativeNativeFees,
            feeRouter.totalBasketNative() + account.cumulativeCreatorNative
                + feeRouter.totalDaoNativeRewards() + feeRouter.totalTreasuryNative()
        );
        assertEq(account.claimableCreatorNative, feeRouter.totalCreatorNativeLiability());
        assertGe(address(feeRouter).balance, feeRouter.totalNativeLiabilities());
        assertEq(
            invariantVault.totalFeesReceived() + account.pendingBasketNative,
            feeRouter.totalBasketNative()
        );
    }

    function invariantBasketPrincipalAndRewardsAreSolvent() public view {
        RobynNativeBasketVaultV2.BasketLeg memory selected = invariantVault.leg(0);
        assertEq(
            selected.pendingNative + selected.consumedNative, invariantVault.totalFeesReceived()
        );
        assertEq(
            invariantVault.totalPendingNative() + invariantVault.totalNativeConsumed(),
            invariantVault.totalFeesReceived()
        );
        assertEq(selected.rewardsDeposited, invariantToken.totalRewardsReceived(0));
        assertLe(invariantToken.totalRewardsClaimed(0), invariantToken.totalRewardsVested(0));
        assertEq(
            IERC20(invariantToken.rewardAsset(0)).balanceOf(address(invariantToken)),
            invariantToken.totalRewardsReceived(0) - invariantToken.totalRewardsClaimed(0)
        );
    }

    function invariantSupplyBindingsAndLockedPrincipalRemainImmutable() public view {
        assertEq(invariantToken.totalSupply(), SUPPLY);
        assertTrue(invariantToken.exclusionsSealed());
        assertEq(launchFactory.creatorByToken(address(invariantToken)), address(this));
        assertEq(marketFactory.marketByToken(address(invariantToken)), address(invariantMarket));
        assertEq(address(invariantVault.launchToken()), address(invariantToken));
        if (invariantMarket.graduated()) {
            RobynV4GraduationAdapter adapter = invariantMarket.graduationAdapter();
            assertEq(
                positionManager.ownerOf(adapter.locker().positionTokenId()),
                address(adapter.locker())
            );
            assertGt(positionManager.getPositionLiquidity(adapter.locker().positionTokenId()), 0);
        }
    }

    function invariantKnownCustodyBalancesNeverExceedFixedSupply() public view {
        uint256 known = invariantToken.balanceOf(address(invariantMarket))
            + invariantToken.balanceOf(address(poolManager))
            + invariantToken.balanceOf(address(feeRouter))
            + invariantToken.balanceOf(address(invariantMarket.graduationAdapter()))
            + invariantToken.balanceOf(address(invariantMarket.graduationAdapter().locker()));
        for (uint256 i; i < invariantActors.length; ++i) {
            known += invariantToken.balanceOf(address(invariantActors[i]));
        }
        assertLe(known, SUPPLY);
    }
}
