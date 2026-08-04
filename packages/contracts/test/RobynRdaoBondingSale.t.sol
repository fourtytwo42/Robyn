// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { DevnetWrappedNative } from "../src/devnet/DevnetWrappedNative.sol";
import {
    IRobynRdaoGraduationFinalizer,
    RobynRdaoBondingSale
} from "../src/RobynRdaoBondingSale.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../src/RobynRdaoStaking.sol";

contract Schema20MockGraduationFinalizer is IRobynRdaoGraduationFinalizer {
    bool public shouldRevert;
    uint256 public nativeReceived;
    uint256 public tokenReceived;
    uint256 public terminalTokenReserve;
    uint256 public terminalNativeReserve;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function finalizeRdaoLiquidity(
        IERC20 rdao,
        uint256 tokenAmount,
        uint256 terminalVirtualTokenReserve_,
        uint256 terminalVirtualNativeReserve_,
        address staking
    ) external payable returns (bytes32 poolId, uint256 positionId) {
        require(!shouldRevert, "finalizer failed");
        require(staking != address(0), "staking");
        nativeReceived = msg.value;
        tokenReceived = rdao.balanceOf(address(this));
        require(tokenReceived == tokenAmount, "tokens");
        terminalTokenReserve = terminalVirtualTokenReserve_;
        terminalNativeReserve = terminalVirtualNativeReserve_;
        poolId = keccak256(
            abi.encode(address(rdao), terminalVirtualTokenReserve_, terminalVirtualNativeReserve_)
        );
        positionId = 42;
    }
}

contract Schema20RejectNativeBuyer {
    receive() external payable {
        revert("reject native");
    }

    function buy(RobynRdaoBondingSale sale) external payable {
        sale.buy{ value: msg.value }(0, block.timestamp, address(this));
    }
}

contract RobynRdaoBondingSaleTest is Test {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant SALE = 150_000_000 ether;
    uint256 private constant LP_TOKENS = 50_000_000 ether;
    uint256 private constant RETAINED = 800_000_000 ether;
    uint256 private constant VIRTUAL_RDAO = 600_000_000 ether;
    uint256 private constant CURVE_TARGET = 332_317_917_474_383_827_195;
    uint256 private constant VIRTUAL_NATIVE = 996_953_752_423_151_481_585;
    uint256 private constant OWNER_PAYOUT = 184_621_065_263_546_570_663;
    uint256 private constant LP_NATIVE = 147_696_852_210_837_256_531;
    address private constant BUYER = address(0xB0B);
    address private constant GUARDIAN = address(0xA11CE);
    address payable private constant PAYOUT = payable(address(0xDA0));

    RobynDaoToken private rdao;
    DevnetWrappedNative private weth;
    RobynRdaoStaking private staking;
    Schema20MockGraduationFinalizer private finalizer;
    RobynRdaoBondingSale private sale;

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
            GUARDIAN,
            24 hours,
            1 hours,
            7 days
        );
        finalizer = new Schema20MockGraduationFinalizer();
        RobynRdaoBondingSale.SaleConfiguration memory config = RobynRdaoBondingSale.SaleConfiguration({
            deployerPayoutRecipient: PAYOUT,
            governance: address(this),
            guardian: GUARDIAN,
            saleInventory: SALE,
            liquidityInventory: LP_TOKENS,
            virtualTokenReserve: VIRTUAL_RDAO,
            virtualNativeReserve: VIRTUAL_NATIVE,
            curvePrincipalTarget: CURVE_TARGET,
            deployerPayout: OWNER_PAYOUT,
            liquidityNative: LP_NATIVE,
            maintenanceGasLimit: 500_000
        });
        sale = new RobynRdaoBondingSale(IERC20(address(rdao)), staking, finalizer, config);
        staking.configureRewardSource(address(sale), true);
        staking.sealRewardSources();
        rdao.approve(address(sale), SALE + LP_TOKENS);
        sale.fundAllocation();
    }

    function testAllocationLeavesExactlyEightHundredMillionRetained() external view {
        assertEq(rdao.balanceOf(address(this)), RETAINED);
        assertEq(rdao.balanceOf(address(sale)), SALE + LP_TOKENS);
        assertEq(rdao.totalSupply(), SUPPLY);
        assertTrue(sale.allocationFunded());
        assertEq(sale.graduationDustToStaking(), 1);
    }

    function testFullBuyRefundsExcessAndGraduatesAtomicallyAtExactAmounts() external {
        vm.deal(BUYER, 1_000 ether);
        uint256 buyerBefore = BUYER.balance;
        vm.prank(BUYER);
        uint256 tokens = sale.buy{ value: 1_000 ether }(SALE, block.timestamp + 1, BUYER);
        assertEq(tokens, SALE);
        assertEq(rdao.balanceOf(BUYER), SALE);
        assertEq(sale.curvePrincipal(), CURVE_TARGET);
        assertTrue(sale.graduationReady());
        assertLt(buyerBefore - BUYER.balance, 400 ether);
        uint256 payoutBefore = PAYOUT.balance;
        (bytes32 poolId, uint256 positionId) = sale.finalizeGraduation();
        assertEq(PAYOUT.balance - payoutBefore, OWNER_PAYOUT);
        assertEq(finalizer.nativeReceived(), LP_NATIVE);
        assertEq(finalizer.tokenReceived(), LP_TOKENS);
        assertEq(finalizer.terminalTokenReserve(), VIRTUAL_RDAO - SALE);
        assertEq(finalizer.terminalNativeReserve(), VIRTUAL_NATIVE + CURVE_TARGET);
        assertEq(positionId, 42);
        assertEq(sale.graduatedPoolId(), poolId);
        assertTrue(sale.finalized());
        assertEq(sale.curvePrincipal(), 0);
        assertEq(address(sale).balance, 0);
        assertEq(
            staking.totalRewardsDeposited(),
            sale.totalBondingFees() + sale.graduationDustToStaking()
        );
    }

    function testPartialBuyAndSellAreMonotonicAndFeesRemainAttributed() external {
        vm.deal(BUYER, 200 ether);
        uint256 initialPrice = sale.currentPriceE18();
        vm.prank(BUYER);
        uint256 bought = sale.buy{ value: 100 ether }(1, block.timestamp + 1, BUYER);
        uint256 afterBuyPrice = sale.currentPriceE18();
        assertGt(bought, 0);
        assertGt(afterBuyPrice, initialPrice);
        vm.startPrank(BUYER);
        rdao.approve(address(sale), type(uint256).max);
        uint256 nativeBefore = BUYER.balance;
        uint256 received = sale.sell(bought / 2, 1, block.timestamp + 1, payable(BUYER));
        vm.stopPrank();
        assertEq(BUYER.balance - nativeBefore, received);
        assertLt(sale.currentPriceE18(), afterBuyPrice);
        assertEq(staking.totalRewardsDeposited(), sale.totalBondingFees());
        assertEq(address(sale).balance, sale.curvePrincipal());
    }

    function testMaintenanceFailureNeverRevertsBuyAndCanBeRetried() external {
        vm.prank(GUARDIAN);
        staking.setPaused(true);
        vm.deal(BUYER, 10 ether);
        vm.prank(BUYER);
        uint256 bought = sale.buy{ value: 10 ether }(1, block.timestamp + 1, BUYER);
        assertGt(bought, 0);
        assertGt(sale.pendingStakingFees(), 0);
        assertEq(staking.totalRewardsDeposited(), 0);
        staking.setPaused(false);
        (uint256 amount, bool success) = sale.processFees();
        assertTrue(success);
        assertGt(amount, 0);
        assertEq(sale.pendingStakingFees(), 0);
        assertEq(staking.totalRewardsDeposited(), amount);
    }

    function testFinalizerFailureRollsBackEveryGraduationEffect() external {
        vm.deal(BUYER, 1_000 ether);
        vm.prank(BUYER);
        sale.buy{ value: 1_000 ether }(SALE, block.timestamp + 1, BUYER);
        finalizer.setShouldRevert(true);
        uint256 saleTokenBefore = rdao.balanceOf(address(sale));
        uint256 payoutBefore = PAYOUT.balance;
        vm.expectRevert(bytes("finalizer failed"));
        sale.finalizeGraduation();
        assertFalse(sale.finalized());
        assertEq(sale.curvePrincipal(), CURVE_TARGET);
        assertEq(rdao.balanceOf(address(sale)), saleTokenBefore);
        assertEq(PAYOUT.balance, payoutBefore);
        assertEq(finalizer.nativeReceived(), 0);
    }

    function testSellRemainsAvailableWhileGraduationReady() external {
        vm.deal(BUYER, 1_000 ether);
        vm.startPrank(BUYER);
        sale.buy{ value: 1_000 ether }(SALE, block.timestamp + 1, BUYER);
        rdao.approve(address(sale), type(uint256).max);
        uint256 received = sale.sell(1_000_000 ether, 1, block.timestamp + 1, payable(BUYER));
        vm.stopPrank();
        assertGt(received, 0);
        assertFalse(sale.graduationReady());
        vm.expectRevert(RobynRdaoBondingSale.GraduationNotReady.selector);
        sale.finalizeGraduation();
    }

    function testForcedNativeAndRdaoAreExplicitlyRecoverableOrRewarded() external {
        vm.deal(address(sale), 1 ether);
        (uint256 amount, bool success) = sale.processFees();
        assertTrue(success);
        assertEq(amount, 1 ether);
        assertEq(staking.totalRewardsDeposited(), 1 ether);
        rdao.transfer(address(sale), 123);
        uint256 before = rdao.balanceOf(address(this));
        assertEq(sale.recoverSurplusRdao(address(this)), 123);
        assertEq(rdao.balanceOf(address(this)), before + 123);
    }

    function testDeadlineSlippageAndGuardianPauseFailClosed() external {
        vm.deal(BUYER, 10 ether);
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.DeadlineExpired.selector);
        sale.buy{ value: 1 ether }(1, block.timestamp - 1, BUYER);
        vm.prank(BUYER);
        vm.expectPartialRevert(RobynRdaoBondingSale.SlippageExceeded.selector);
        sale.buy{ value: 1 ether }(SALE, block.timestamp + 1, BUYER);
        vm.prank(GUARDIAN);
        sale.setBuysPaused(true);
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.buy{ value: 1 ether }(1, block.timestamp + 1, BUYER);
        sale.setBuysPaused(false);
        vm.prank(BUYER);
        assertGt(sale.buy{ value: 1 ether }(1, block.timestamp + 1, BUYER), 0);
    }

    function testFuzzBuyQuoteIsBoundedMonotonicAndExactlyCharged(uint256 grossNative) external {
        grossNative = bound(grossNative, 1 gwei, 1_000 ether);
        (uint256 tokensOut, uint256 principal, uint256 fee, uint256 refund) =
            sale.quoteBuy(grossNative);
        assertLe(tokensOut, SALE);
        assertEq(principal + fee + refund, grossNative);
        if (tokensOut != 0) {
            vm.deal(BUYER, grossNative);
            vm.prank(BUYER);
            assertEq(sale.buy{ value: grossNative }(tokensOut, block.timestamp, BUYER), tokensOut);
            assertEq(sale.sold(), tokensOut);
            assertEq(sale.curvePrincipal(), principal);
            assertEq(sale.totalBondingFees(), fee);
        }
    }

    function testFuzzRoundTripNeverCreatesNative(uint256 grossNative, uint256 sellFraction)
        external
    {
        grossNative = bound(grossNative, 0.01 ether, 500 ether);
        vm.deal(BUYER, grossNative);
        vm.startPrank(BUYER);
        uint256 bought = sale.buy{ value: grossNative }(0, block.timestamp, BUYER);
        sellFraction = bound(sellFraction, 1, 10_000);
        uint256 tokensIn = Math.mulDiv(bought, sellFraction, 10_000);
        if (tokensIn == 0) tokensIn = 1;
        rdao.approve(address(sale), tokensIn);
        uint256 beforeSell = BUYER.balance;
        uint256 received = sale.sell(tokensIn, 0, block.timestamp, payable(BUYER));
        vm.stopPrank();
        assertEq(BUYER.balance - beforeSell, received);
        assertLt(received, grossNative);
        assertEq(staking.totalRewardsDeposited(), sale.totalBondingFees());
    }

    function testAdmissionAndStateViewBranchMatrix() external {
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.fundAllocation();
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.Unauthorized.selector);
        sale.setBuysPaused(true);
        vm.prank(GUARDIAN);
        sale.setBuysPaused(true);
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.Unauthorized.selector);
        sale.setBuysPaused(false);
        sale.setBuysPaused(false);
        (uint256 zeroTokens, uint256 zeroPrincipal, uint256 zeroFee, uint256 zeroRefund) =
            sale.quoteBuy(0);
        assertEq(zeroTokens, 0);
        assertEq(zeroPrincipal, 0);
        assertEq(zeroFee, 0);
        assertEq(zeroRefund, 0);
        (uint256 zeroGross, uint256 zeroSellFee, uint256 zeroNet) = sale.quoteSell(0);
        assertEq(zeroGross, 0);
        assertEq(zeroSellFee, 0);
        assertEq(zeroNet, 0);
        (uint256 tinyGross, uint256 tinyFee, uint256 tinyNet) = sale.quoteSell(1);
        assertEq(tinyGross, 0);
        assertEq(tinyFee, 0);
        assertEq(tinyNet, 0);
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.buy{ value: 1 ether }(0, block.timestamp, address(0));
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.NothingToBuy.selector);
        sale.buy{ value: 1 }(0, block.timestamp, BUYER);
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.sell(0, 0, block.timestamp, payable(BUYER));
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.sell(1, 0, block.timestamp, payable(address(0)));
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InsufficientOutstanding.selector);
        sale.sell(1, 0, block.timestamp, payable(BUYER));
        vm.expectRevert(RobynRdaoBondingSale.GraduationNotReady.selector);
        sale.finalizeGraduation();
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.Unauthorized.selector);
        sale.recoverSurplusRdao(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.Unauthorized.selector);
        sale.recoverSurplusRdao(address(0));
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.recoverSurplusRdao(address(this));
        (uint256 amount, bool success) = sale.processFees();
        assertEq(amount, 0);
        assertTrue(success);
        sale.currentVirtualReserves();
        sale.currentPriceE18();
        sale.terminalPriceE18();
    }

    function testSellDeadlineAndSlippageBranches() external {
        vm.deal(BUYER, 10 ether);
        vm.startPrank(BUYER);
        uint256 bought = sale.buy{ value: 10 ether }(0, block.timestamp, BUYER);
        rdao.approve(address(sale), bought);
        vm.expectRevert(RobynRdaoBondingSale.DeadlineExpired.selector);
        sale.sell(bought, 0, block.timestamp - 1, payable(BUYER));
        (,, uint256 quoted) = sale.quoteSell(bought);
        vm.expectPartialRevert(RobynRdaoBondingSale.SlippageExceeded.selector);
        sale.sell(bought, quoted + 1, block.timestamp, payable(BUYER));
        vm.stopPrank();
    }

    function testFinalizedBranchesRejectReplayAndTrading() external {
        vm.deal(BUYER, 1_000 ether);
        vm.prank(BUYER);
        sale.buy{ value: 1_000 ether }(SALE, block.timestamp, BUYER);
        sale.finalizeGraduation();
        vm.expectRevert(RobynRdaoBondingSale.AlreadyFinalized.selector);
        sale.finalizeGraduation();
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.buy{ value: 1 ether }(0, block.timestamp, BUYER);
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        sale.sell(1, 0, block.timestamp, payable(BUYER));
    }

    function testConstructorEconomicIdentityBranches() external {
        RobynRdaoBondingSale.SaleConfiguration memory config = _validConfig();
        config.curvePrincipalTarget += 1;
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        new RobynRdaoBondingSale(IERC20(address(rdao)), staking, finalizer, config);

        config = _validConfig();
        config.liquidityNative += 1;
        vm.expectRevert(RobynRdaoBondingSale.InvalidConfiguration.selector);
        new RobynRdaoBondingSale(IERC20(address(rdao)), staking, finalizer, config);
    }

    function testOverfillRefundFailureRollsBackPurchase() external {
        Schema20RejectNativeBuyer rejecting = new Schema20RejectNativeBuyer();
        vm.deal(address(rejecting), 1_000 ether);
        vm.expectRevert(RobynRdaoBondingSale.NativeTransferFailed.selector);
        rejecting.buy{ value: 1_000 ether }(sale);
        assertEq(sale.sold(), 0);
        assertEq(rdao.balanceOf(address(rejecting)), 0);
    }

    function _validConfig()
        private
        view
        returns (RobynRdaoBondingSale.SaleConfiguration memory config)
    {
        config = RobynRdaoBondingSale.SaleConfiguration({
            deployerPayoutRecipient: PAYOUT,
            governance: address(this),
            guardian: GUARDIAN,
            saleInventory: SALE,
            liquidityInventory: LP_TOKENS,
            virtualTokenReserve: VIRTUAL_RDAO,
            virtualNativeReserve: VIRTUAL_NATIVE,
            curvePrincipalTarget: CURVE_TARGET,
            deployerPayout: OWNER_PAYOUT,
            liquidityNative: LP_NATIVE,
            maintenanceGasLimit: 500_000
        });
    }
}
