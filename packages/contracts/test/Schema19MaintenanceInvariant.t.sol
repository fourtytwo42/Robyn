// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynClaimsRouter } from "../src/RobynClaimsRouter.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { IRobynMaintenanceCoordinator } from "../src/interfaces/IRobynMaintenanceCoordinator.sol";
import { RobynMaintenanceCoordinator } from "../src/RobynMaintenanceCoordinator.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4NativeProtocolTest } from "./RobynV4NativeProtocol.t.sol";

interface ISchema19InvariantActivator {
    function ensureSchema19Maintenance() external;
}

contract Schema19InvariantActor {
    receive() external payable { }

    function buy(RobynV4BondingCurveMarket market, uint256 amount) external {
        market.buy{ value: amount }(1);
    }

    function sell(RobynLaunchToken token, RobynV4BondingCurveMarket market, uint256 amount)
        external
    {
        token.approve(address(market), amount);
        market.sell(amount, 1);
        token.approve(address(market), 0);
    }

    function transferToken(RobynLaunchToken token, address recipient, uint256 amount) external {
        token.transfer(recipient, amount);
    }

    function claim(RobynClaimsRouter claimsRouter, RobynLaunchToken token) external {
        claimsRouter.claimAll(token);
    }

    function process(RobynMaintenanceCoordinator maintenance, RobynLaunchToken token) external {
        maintenance.processRewards(address(token));
    }
}

contract Schema19MaintenanceInvariantHandler {
    uint256 private constant MAX_BUY = 0.01 ether;

    RobynLaunchToken public immutable token;
    RobynV4BondingCurveMarket public immutable market;
    RobynClaimsRouter public immutable claimsRouter;
    RobynMaintenanceCoordinator public immutable maintenance;
    ISchema19InvariantActivator public immutable activator;
    Schema19InvariantActor[] private _actors;

    constructor(
        RobynLaunchToken token_,
        RobynV4BondingCurveMarket market_,
        RobynClaimsRouter claimsRouter_,
        RobynMaintenanceCoordinator maintenance_,
        ISchema19InvariantActivator activator_,
        Schema19InvariantActor[] memory actors_
    ) {
        token = token_;
        market = market_;
        claimsRouter = claimsRouter_;
        maintenance = maintenance_;
        activator = activator_;
        for (uint256 index; index < actors_.length; ++index) _actors.push(actors_[index]);
    }

    function buy(uint8 actorSeed, uint96 amountSeed) external {
        activator.ensureSchema19Maintenance();
        Schema19InvariantActor selected = _actor(actorSeed);
        uint256 available = address(selected).balance;
        if (available == 0) return;
        uint256 ceiling = available < MAX_BUY ? available : MAX_BUY;
        uint256 amount = (uint256(amountSeed) % ceiling) + 1;
        try selected.buy(market, amount) { } catch { }
    }

    function sell(uint8 actorSeed, uint96 amountSeed) external {
        activator.ensureSchema19Maintenance();
        Schema19InvariantActor selected = _actor(actorSeed);
        uint256 available = token.balanceOf(address(selected));
        if (available == 0) return;
        uint256 amount = (uint256(amountSeed) % available) + 1;
        try selected.sell(token, market, amount) { } catch { }
    }

    function transfer(uint8 fromSeed, uint8 toSeed, uint96 amountSeed) external {
        activator.ensureSchema19Maintenance();
        uint256 fromIndex = uint256(fromSeed) % _actors.length;
        uint256 toIndex = uint256(toSeed) % _actors.length;
        if (fromIndex == toIndex) toIndex = (toIndex + 1) % _actors.length;
        uint256 available = token.balanceOf(address(_actors[fromIndex]));
        if (available == 0) return;
        uint256 amount = (uint256(amountSeed) % available) + 1;
        try _actors[fromIndex].transferToken(token, address(_actors[toIndex]), amount) { } catch { }
    }

    function claim(uint8 actorSeed) external {
        activator.ensureSchema19Maintenance();
        try _actor(actorSeed).claim(claimsRouter, token) { } catch { }
    }

    function process(uint8 actorSeed) external {
        activator.ensureSchema19Maintenance();
        try _actor(actorSeed).process(maintenance, token) { } catch { }
    }

    function actor(uint256 index) external view returns (address) {
        return address(_actors[index]);
    }

    function actorCount() external view returns (uint256) {
        return _actors.length;
    }

    function _actor(uint8 seed) private view returns (Schema19InvariantActor) {
        return _actors[uint256(seed) % _actors.length];
    }
}

contract Schema19MaintenanceInvariantTest is RobynV4NativeProtocolTest {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant ACTOR_COUNT = 8;

    RobynLaunchToken private invariantToken;
    RobynNativeBasketVaultV2 private invariantVault;
    RobynV4BondingCurveMarket private invariantMarket;
    RobynMaintenanceCoordinator private invariantMaintenance;
    RobynClaimsRouter private invariantClaimsRouter;
    Schema19MaintenanceInvariantHandler private invariantHandler;
    bool private maintenanceActivated;

    function setUp() public override {
        super.setUp();
        invariantMaintenance = new RobynMaintenanceCoordinator(feeRouter, assetRouter, 1_500_000);
        invariantClaimsRouter = new RobynClaimsRouter(
            IRobynMaintenanceCoordinator(address(invariantMaintenance)), 1_550_000
        );
        daoToken.delegate(address(this));
        vm.warp(block.timestamp + 1);

        (invariantToken, invariantVault, invariantMarket) =
            coordinator.createLaunch(_request(keccak256("schema19-maintenance-invariant")));
        Schema19InvariantActor[] memory actors = new Schema19InvariantActor[](ACTOR_COUNT);
        for (uint256 index; index < ACTOR_COUNT; ++index) {
            Schema19InvariantActor actor = new Schema19InvariantActor();
            vm.deal(address(actor), 10 ether);
            actors[index] = actor;
        }
        invariantHandler = new Schema19MaintenanceInvariantHandler(
            invariantToken,
            invariantMarket,
            invariantClaimsRouter,
            invariantMaintenance,
            ISchema19InvariantActivator(address(this)),
            actors
        );
        targetContract(address(invariantHandler));
    }

    function ensureSchema19Maintenance() external {
        require(msg.sender == address(invariantHandler), "handler only");
        if (maintenanceActivated) return;
        maintenanceActivated = true;
        feeRouter.bindMaintenanceCoordinator(address(invariantMaintenance));
    }

    function invariantSchema19FeeAllocationAndBackingRemainExact() public view {
        RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
            feeRouter.launchAccount(address(invariantToken));
        assertEq(
            account.cumulativeNativeFees,
            account.cumulativeCreatorNative + account.pendingBasketNative
                + account.cumulativeBasketNativeSettled + account.pendingDaoNative
                + account.cumulativeDaoNativeSettled + account.pendingTreasuryNative
                + account.cumulativeTreasuryNativeSettled
        );
        assertGe(address(feeRouter).balance, feeRouter.totalNativeLiabilities());
    }

    function invariantSchema19BasketLegsConserveIndependentValue() public view {
        uint256 pending;
        uint256 consumed;
        for (uint256 index; index < invariantVault.legCount(); ++index) {
            RobynNativeBasketVaultV2.BasketLeg memory selected = invariantVault.leg(index);
            pending += selected.pendingNative;
            consumed += selected.consumedNative;
            assertLe(selected.fallbackNativeConsumed, selected.consumedNative);
        }
        assertEq(pending, invariantVault.totalPendingNative());
        assertEq(consumed, invariantVault.totalNativeConsumed());
        assertEq(pending + consumed, invariantVault.totalFeesReceived());
    }

    function invariantSchema19RewardCustodyIsSolvent() public view {
        for (uint256 index; index < invariantToken.rewardAssetCount(); ++index) {
            uint256 outstanding =
                invariantToken.totalRewardsReceived(index) - invariantToken.totalRewardsClaimed(index);
            assertGe(
                IERC20(invariantToken.rewardAsset(index)).balanceOf(address(invariantToken)),
                outstanding
            );
            assertLe(
                invariantToken.totalRewardsClaimed(index),
                invariantToken.totalRewardsVested(index)
            );
        }
    }

    function invariantSchema19MaintenanceIsBoundedAndLaunchLocal() public view {
        uint256 attempts = invariantMaintenance.attemptCount(address(invariantToken));
        assertLt(
            invariantMaintenance.nextTask(address(invariantToken)),
            invariantMaintenance.TASK_COUNT()
        );
        assertLe(invariantMaintenance.successCount(address(invariantToken)), attempts);
        assertEq(invariantMaintenance.attemptCount(address(0xDEAD)), 0);
        assertEq(invariantMaintenance.successCount(address(0xDEAD)), 0);
    }

    function invariantSchema19SupplyAndBindingsRemainImmutable() public view {
        assertEq(invariantToken.totalSupply(), SUPPLY);
        assertTrue(invariantToken.exclusionsSealed());
        assertEq(address(invariantVault.launchToken()), address(invariantToken));
        assertEq(marketFactory.marketByToken(address(invariantToken)), address(invariantMarket));
        if (maintenanceActivated) {
            assertEq(feeRouter.maintenanceCoordinator(), address(invariantMaintenance));
        } else {
            assertEq(feeRouter.maintenanceCoordinator(), address(0));
        }
        assertEq(
            address(invariantClaimsRouter.maintenanceCoordinator()), address(invariantMaintenance)
        );
    }
}
