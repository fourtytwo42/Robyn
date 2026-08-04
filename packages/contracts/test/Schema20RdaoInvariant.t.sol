// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import {
    RobynRdaoBondingSale,
    IRobynRdaoGraduationFinalizer
} from "../src/RobynRdaoBondingSale.sol";
import { RobynRdaoStaking, IRobynWrappedNative } from "../src/RobynRdaoStaking.sol";
import { DevnetWrappedNative } from "../src/devnet/DevnetWrappedNative.sol";

contract Schema20InvariantFinalizer is IRobynRdaoGraduationFinalizer {
    function finalizeRdaoLiquidity(IERC20, uint256, uint256, uint256, address)
        external
        payable
        returns (bytes32 poolId, uint256 positionId)
    {
        return (keccak256("SCHEMA20_INVARIANT_POOL"), 1);
    }
}

contract Schema20RdaoHandler is Test {
    RobynDaoToken public immutable rdao;
    RobynRdaoBondingSale public immutable sale;
    RobynRdaoStaking public immutable staking;

    constructor(RobynDaoToken rdao_, RobynRdaoBondingSale sale_, RobynRdaoStaking staking_) {
        rdao = rdao_;
        sale = sale_;
        staking = staking_;
        rdao.approve(address(sale), type(uint256).max);
    }

    receive() external payable { }

    function buy(uint256 grossNative) external {
        if (sale.finalized() || sale.buysPaused()) return;
        grossNative = bound(grossNative, 1 gwei, 25 ether);
        vm.deal(address(this), address(this).balance + grossNative);
        try sale.buy{ value: grossNative }(0, block.timestamp, address(this)) { } catch { }
    }

    function sell(uint256 tokenAmount) external {
        if (sale.finalized()) return;
        uint256 balance = rdao.balanceOf(address(this));
        uint256 outstanding = sale.sold();
        uint256 maximum = Math.min(balance, outstanding);
        if (maximum == 0) return;
        tokenAmount = bound(tokenAmount, 1, maximum);
        try sale.sell(tokenAmount, 0, block.timestamp, payable(address(this))) { } catch { }
    }

    function processFees() external {
        try sale.processFees() { } catch { }
    }

    function finalize() external {
        if (!sale.finalized()) {
            try sale.finalizeGraduation() { } catch { }
        }
    }

    function activate() external {
        try staking.activateFor(address(this), 256) { } catch { }
    }

    function warp(uint256 elapsed) external {
        vm.warp(block.timestamp + bound(elapsed, 1, 2 days));
    }
}

contract Schema20RdaoInvariantTest is StdInvariant, Test {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant SALE_INVENTORY = 150_000_000 ether;
    uint256 private constant LIQUIDITY_INVENTORY = 50_000_000 ether;
    uint256 private constant VIRTUAL_TOKEN = 600_000_000 ether;
    uint256 private constant VIRTUAL_NATIVE = 996_953_752_423_151_481_585;
    uint256 private constant CURVE_TARGET = 332_317_917_474_383_827_195;
    uint256 private constant OWNER_PAYOUT = 184_621_065_263_546_570_663;
    uint256 private constant LP_NATIVE = 147_696_852_210_837_256_531;

    RobynDaoToken private rdao;
    DevnetWrappedNative private weth;
    RobynRdaoStaking private staking;
    RobynRdaoBondingSale private sale;
    Schema20RdaoHandler private handler;

    function setUp() external {
        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = SUPPLY;
        rdao = new RobynDaoToken(recipients, amounts, 1 hours);
        weth = new DevnetWrappedNative();
        staking = new RobynRdaoStaking(
            IERC20(address(rdao)),
            IRobynWrappedNative(address(weth)),
            address(this),
            address(0xA11CE),
            1 hours,
            1 hours,
            7 days
        );
        sale = new RobynRdaoBondingSale(
            IERC20(address(rdao)),
            staking,
            new Schema20InvariantFinalizer(),
            RobynRdaoBondingSale.SaleConfiguration({
                deployerPayoutRecipient: payable(address(this)),
                governance: address(this),
                guardian: address(0xA11CE),
                saleInventory: SALE_INVENTORY,
                liquidityInventory: LIQUIDITY_INVENTORY,
                virtualTokenReserve: VIRTUAL_TOKEN,
                virtualNativeReserve: VIRTUAL_NATIVE,
                curvePrincipalTarget: CURVE_TARGET,
                deployerPayout: OWNER_PAYOUT,
                liquidityNative: LP_NATIVE,
                maintenanceGasLimit: 1_000_000
            })
        );
        staking.configureRewardSource(address(sale), true);
        staking.sealRewardSources();
        rdao.approve(address(sale), SALE_INVENTORY + LIQUIDITY_INVENTORY);
        sale.fundAllocation();
        handler = new Schema20RdaoHandler(rdao, sale, staking);
        targetContract(address(handler));
    }

    receive() external payable { }

    function invariantFixedSupplyAndSaleCustody() external view {
        assertEq(rdao.totalSupply(), SUPPLY);
        assertLe(sale.sold(), SALE_INVENTORY);
        uint256 required = sale.finalized() ? 0 : SALE_INVENTORY - sale.sold() + LIQUIDITY_INVENTORY;
        assertGe(rdao.balanceOf(address(sale)), required);
    }

    function invariantCurvePrincipalAndFeeAttribution() external view {
        if (!sale.finalized()) {
            (uint256 tokenReserve, uint256 nativeReserve) = sale.currentVirtualReserves();
            assertEq(tokenReserve, VIRTUAL_TOKEN - sale.sold());
            assertEq(nativeReserve, VIRTUAL_NATIVE + sale.curvePrincipal());
            assertGe(address(sale).balance, sale.curvePrincipal());
        }
        assertEq(
            sale.totalFeesSettled() + sale.pendingStakingFees(),
            sale.totalBondingFees() + (sale.finalized() ? sale.graduationDustToStaking() : 0)
        );
    }

    function invariantStakingIsBacked() external view {
        assertEq(staking.totalPrincipal(), 0);
        assertGe(weth.balanceOf(address(staking)), staking.outstandingLiability());
        assertEq(
            staking.totalRewardsClaimed() + staking.outstandingLiability(),
            staking.totalRewardsDeposited()
        );
    }
}
