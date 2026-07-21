// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { FeeBasketVault } from "../src/FeeBasketVault.sol";
import { RobynLaunchFactory } from "../src/RobynLaunchFactory.sol";
import { ProtocolActor, ProtocolMockERC20, ProtocolMockRouter } from "./RobynProtocol.t.sol";

contract ProtocolInvariantHandler {
    uint256 private constant MAX_DEPOSIT = 10_000 ether;

    ProtocolMockERC20 public immutable base;
    ProtocolMockRouter public immutable router;
    RobynLaunchToken public immutable token;
    FeeBasketVault public immutable vault;
    ProtocolActor[] private _actors;

    constructor(
        ProtocolMockERC20 base_,
        ProtocolMockRouter router_,
        RobynLaunchToken token_,
        FeeBasketVault vault_,
        ProtocolActor[] memory actors_
    ) {
        base = base_;
        router = router_;
        token = token_;
        vault = vault_;
        for (uint256 i; i < actors_.length; ++i) {
            _actors.push(actors_[i]);
        }
        base_.mint(address(this), type(uint128).max);
        base_.approve(address(vault_), type(uint256).max);
    }

    function recordFees(uint96 seed) external {
        uint256 amount = (uint256(seed) % MAX_DEPOSIT) + 1;
        vault.recordFees(amount);
    }

    function convertLeg(uint8 legSeed, uint96 amountSeed) external {
        uint256 index = uint256(legSeed) % vault.legCount();
        FeeBasketVault.BasketLeg memory selected = vault.leg(index);
        if (selected.pendingBase == 0) return;
        uint256 amount = (uint256(amountSeed) % selected.pendingBase) + 1;
        uint256 minimumOutput = (amount * router.rate(address(selected.asset))) / 1e18;
        vault.convertLeg(index, amount, minimumOutput, block.timestamp);
    }

    function transfer(uint8 fromSeed, uint8 toSeed, uint96 amountSeed) external {
        uint256 count = _actors.length;
        uint256 fromIndex = uint256(fromSeed) % count;
        uint256 toIndex = uint256(toSeed) % count;
        if (fromIndex == toIndex) toIndex = (toIndex + 1) % count;
        uint256 balance = token.balanceOf(address(_actors[fromIndex]));
        if (balance == 0) return;
        uint256 amount = (uint256(amountSeed) % balance) + 1;
        _actors[fromIndex].transferToken(token, address(_actors[toIndex]), amount);
    }

    function claim(uint8 actorSeed, uint8 legSeed) external {
        ProtocolActor selectedActor = _actors[uint256(actorSeed) % _actors.length];
        uint256 index = uint256(legSeed) % token.rewardAssetCount();
        if (token.withdrawableRewardOf(address(selectedActor), index) == 0) return;
        selectedActor.claim(token, index);
    }

    function actor(uint256 index) external view returns (address) {
        return address(_actors[index]);
    }

    function actorCount() external view returns (uint256) {
        return _actors.length;
    }
}

contract RobynProtocolInvariantTest {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant ACTOR_COUNT = 4;

    ProtocolMockERC20 private base;
    ProtocolMockERC20[3] private rewards;
    ProtocolMockRouter private router;
    RobynLaunchFactory private factory;
    RobynLaunchToken private token;
    FeeBasketVault private vault;
    ProtocolInvariantHandler private handler;
    ProtocolActor[] private actors;
    address[] private _targetedContracts;

    function setUp() public {
        base = new ProtocolMockERC20("Invariant USD", "iUSD");
        rewards[0] = new ProtocolMockERC20("Invariant A", "iA");
        rewards[1] = new ProtocolMockERC20("Invariant B", "iB");
        rewards[2] = new ProtocolMockERC20("Invariant C", "iC");
        router = new ProtocolMockRouter();
        factory = new RobynLaunchFactory(base, router, 1, 1 days);
        (token, vault) =
            factory.createLaunch("Invariant Launch", "INVAR", SUPPLY, _assets(), _weights());
        factory.sealLaunchExclusions(token, new address[](0));

        ProtocolActor[] memory actorList = new ProtocolActor[](ACTOR_COUNT);
        for (uint256 i; i < ACTOR_COUNT; ++i) {
            ProtocolActor next = new ProtocolActor();
            actors.push(next);
            actorList[i] = next;
            require(token.transfer(address(next), SUPPLY / ACTOR_COUNT), "initial transfer");
        }

        for (uint256 i; i < rewards.length; ++i) {
            router.setRate(address(rewards[i]), (i + 1) * 1e18);
            rewards[i].mint(address(router), type(uint128).max);
        }

        handler = new ProtocolInvariantHandler(base, router, token, vault, actorList);
        _targetedContracts.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return _targetedContracts;
    }

    function invariantFeePrincipalIsConserved() public view {
        uint256 pending;
        uint256 consumed;
        for (uint256 i; i < vault.legCount(); ++i) {
            FeeBasketVault.BasketLeg memory selected = vault.leg(i);
            pending += selected.pendingBase;
            consumed += selected.consumedBase;
        }
        require(pending == vault.totalPendingBase(), "pending sum");
        require(consumed == vault.totalBaseConsumed(), "consumed sum");
        require(pending + consumed == vault.totalFeesReceived(), "fee conservation");
        require(base.balanceOf(address(vault)) == pending, "base solvency");
    }

    function invariantRewardAccountingIsSolvent() public view {
        for (uint256 i; i < token.rewardAssetCount(); ++i) {
            FeeBasketVault.BasketLeg memory selected = vault.leg(i);
            uint256 received = token.totalRewardsReceived(i);
            uint256 distributed = token.totalRewardsDistributed(i);
            uint256 claimed = token.totalRewardsClaimed(i);
            require(selected.rewardsDeposited == received, "vault reward mismatch");
            require(claimed <= distributed, "claimed exceeds distributed");
            require(distributed + token.pendingWithoutSupply(i) == received, "reward conservation");
            require(rewards[i].balanceOf(address(token)) == received - claimed, "reward balance");

            uint256 withdrawn;
            uint256 withdrawable;
            for (uint256 j; j < actors.length; ++j) {
                address account = address(actors[j]);
                withdrawn += token.withdrawnRewardOf(account, i);
                withdrawable += token.withdrawableRewardOf(account, i);
            }
            require(withdrawn == claimed, "withdrawn sum");
            require(withdrawable <= received - claimed, "claim insolvency");
        }
    }

    function invariantSupplyAndEligibilityAreConserved() public view {
        uint256 balances;
        for (uint256 i; i < actors.length; ++i) {
            balances += token.balanceOf(address(actors[i]));
        }
        require(token.totalSupply() == SUPPLY, "fixed supply");
        require(balances == SUPPLY, "holder balances");
        require(token.eligibleSupply() == SUPPLY, "eligible supply");
    }

    function invariantFactoryBindingsDoNotChange() public view {
        require(factory.launchCount() == 1, "launch count");
        require(factory.launchTokenById(1) == address(token), "token binding");
        require(factory.vaultByToken(address(token)) == address(vault), "vault binding");
        require(factory.creatorByToken(address(token)) == address(this), "creator binding");
        require(token.controller() == address(vault), "controller binding");
        require(address(vault.launchToken()) == address(token), "reverse binding");
    }

    function _assets() private view returns (address[] memory assets) {
        assets = new address[](3);
        for (uint256 i; i < assets.length; ++i) {
            assets[i] = address(rewards[i]);
        }
    }

    function _weights() private pure returns (uint16[] memory weights) {
        weights = new uint16[](3);
        weights[0] = 4_000;
        weights[1] = 4_000;
        weights[2] = 2_000;
    }
}
