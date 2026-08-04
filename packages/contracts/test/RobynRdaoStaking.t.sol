// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { DevnetWrappedNative } from "../src/devnet/DevnetWrappedNative.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../src/RobynRdaoStaking.sol";
import { RobynRdaoStakeEscrow } from "../src/RobynRdaoStakeEscrow.sol";

contract Schema20RewardSource {
    RobynRdaoStaking public immutable staking;
    IERC20 public immutable weth;

    constructor(RobynRdaoStaking staking_, IERC20 weth_) {
        staking = staking_;
        weth = weth_;
    }

    function depositNative(address sourceToken) external payable {
        staking.depositRewards{ value: msg.value }(sourceToken);
    }

    function depositWrapped(address sourceToken, uint256 amount) external {
        weth.approve(address(staking), amount);
        staking.depositWrappedRewards(sourceToken, amount);
    }
}

contract RobynRdaoStakingTest is Test {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant RETAINED = 800_000_000 ether;
    uint256 private constant WARMUP = 24 hours;
    address private constant GUARDIAN = address(0xA11CE);
    address private constant FOUNDER = address(0xF0A1);
    address private constant USER = address(0xB0B);

    RobynDaoToken private rdao;
    DevnetWrappedNative private weth;
    RobynRdaoStaking private staking;
    Schema20RewardSource private source;

    receive() external payable { }

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
            WARMUP,
            1 hours,
            7 days
        );
        source = new Schema20RewardSource(staking, IERC20(address(weth)));
        staking.configureRewardSource(address(source), true);
        staking.sealRewardSources();
        rdao.approve(address(staking), type(uint256).max);
        rdao.delegate(address(this));
    }

    function testRetainedAllocationHasNoCapAndPreservesVotes() external {
        assertEq(rdao.getVotes(address(this)), SUPPLY);
        staking.stake(RETAINED, address(this));
        assertEq(rdao.balanceOf(staking.escrowOf(address(this))), RETAINED);
        assertEq(rdao.getVotes(address(this)), SUPPLY);
        vm.warp(block.timestamp + WARMUP);
        assertEq(staking.activateFor(address(this)), RETAINED);
        (,, uint256 warming,,,) = staking.position(address(this));
        assertEq(warming, 0);
        assertEq(staking.totalEligibleStake(), RETAINED);
        assertEq(staking.totalPrincipal(), RETAINED);
    }

    function testNewStakeWarmsIndependentlyWithoutDelayingOlderStake() external {
        staking.stake(500_000_000 ether, address(this));
        uint256 firstReady = block.timestamp + WARMUP;
        vm.warp(block.timestamp + 12 hours);
        staking.stake(100_000_000 ether, address(this));
        vm.warp(firstReady);
        assertEq(staking.activateFor(address(this)), 500_000_000 ether);
        (, uint256 eligible, uint256 warming, uint256 nextReady,,) = staking.position(address(this));
        assertEq(eligible, 500_000_000 ether);
        assertEq(warming, 100_000_000 ether);
        assertEq(nextReady, firstReady + 12 hours);
        vm.warp(nextReady);
        assertEq(staking.activateFor(address(this)), 100_000_000 ether);
    }

    function testRewardsStreamInWethAndClaimForAlwaysPaysAccount() external {
        rdao.transfer(USER, 100_000_000 ether);
        vm.startPrank(USER);
        rdao.approve(address(staking), type(uint256).max);
        staking.stake(100_000_000 ether, USER);
        vm.stopPrank();
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(USER);
        vm.deal(address(this), 10 ether);
        source.depositNative{ value: 10 ether }(address(rdao));
        vm.warp(block.timestamp + 1 hours);
        assertApproxEqAbs(staking.earned(USER), 10 ether, 1);
        uint256 claimed = staking.claimFor(USER);
        assertApproxEqAbs(claimed, 10 ether, 1);
        assertEq(weth.balanceOf(USER), claimed);
        assertEq(staking.totalRewardsDeposited(), 10 ether);
        assertEq(staking.totalRewardsClaimed(), claimed);
        assertLe(staking.outstandingLiability(), 1);
        assertEq(
            staking.totalRewardsClaimed() + staking.outstandingLiability(),
            staking.totalRewardsDeposited()
        );
    }

    function testZeroEligibleRewardsQueueAndReleaseOverSevenDays() external {
        vm.deal(address(this), 7 ether);
        source.depositNative{ value: 7 ether }(address(rdao));
        assertEq(staking.queuedRewards(), 7 ether);
        staking.stake(1 ether, address(this));
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(address(this));
        assertEq(staking.queuedRewards(), 0);
        vm.warp(block.timestamp + 3 days + 12 hours);
        assertApproxEqAbs(staking.earned(address(this)), 3.5 ether, 1);
        vm.warp(block.timestamp + 3 days + 12 hours);
        assertEq(staking.claim(), 7 ether);
        assertEq(weth.balanceOf(address(this)), 7 ether);
    }

    function testFounderRedistributionRequiresOwnWarmupAndKeepsVotes() external {
        staking.stake(RETAINED, address(this));
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(address(this));
        staking.unstake(100_000_000 ether, FOUNDER);
        assertEq(rdao.balanceOf(FOUNDER), 100_000_000 ether);
        vm.startPrank(FOUNDER);
        rdao.approve(address(staking), type(uint256).max);
        staking.stake(100_000_000 ether, FOUNDER);
        vm.stopPrank();
        (, uint256 eligible, uint256 warming,,,) = staking.position(FOUNDER);
        assertEq(eligible, 0);
        assertEq(warming, 100_000_000 ether);
        assertEq(rdao.getVotes(FOUNDER), 100_000_000 ether);
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(FOUNDER);
        (, eligible, warming,,,) = staking.position(FOUNDER);
        assertEq(eligible, 100_000_000 ether);
        assertEq(warming, 0);
    }

    function testGuardianPauseBlocksNewStakeAndRewardsButNotExitOrClaim() external {
        staking.stake(100_000_000 ether, address(this));
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(address(this));
        vm.deal(address(this), 1 ether);
        source.depositNative{ value: 1 ether }(address(rdao));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(GUARDIAN);
        staking.setPaused(true);
        vm.expectRevert(RobynRdaoStaking.Paused.selector);
        staking.stake(1 ether, address(this));
        vm.deal(address(this), 1 wei);
        vm.expectRevert(RobynRdaoStaking.Paused.selector);
        source.depositNative{ value: 1 wei }(address(rdao));
        assertApproxEqAbs(staking.claim(), 1 ether, 1);
        staking.unstake(100_000_000 ether, address(this));
        assertEq(staking.totalPrincipal(), 0);
    }

    function testThousandsOfWarmupLotsRemainBoundedAndExitImmediately() external {
        uint256 lotCount = 1_024;
        for (uint256 index; index < lotCount; ++index) {
            staking.stake(1, address(this));
        }
        staking.unstake(lotCount, address(this));
        assertEq(staking.totalPrincipal(), 0);
        assertEq(staking.totalWarmingStake(), 0);
        assertEq(staking.cancelledWarming(address(this)), lotCount);

        staking.stake(1, address(this));
        vm.warp(block.timestamp + WARMUP);
        for (uint256 page; page < 3; ++page) {
            assertEq(staking.activateFor(address(this), 256), 0);
        }
        assertEq(staking.activateFor(address(this), 256), 1);
        assertEq(staking.cancelledWarming(address(this)), 0);
        assertEq(staking.totalEligibleStake(), 1);
        assertEq(staking.totalPrincipal(), 1);
    }

    function testActivationLotLimitRejectsUnboundedRequests() external {
        staking.stake(1, address(this));
        vm.warp(block.timestamp + WARMUP);
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.activateFor(address(this), 257);
    }

    function testFuzzSingleStakerNeverClaimsBeyondBacking(uint256 stakeAmount, uint256 reward)
        external
    {
        stakeAmount = bound(stakeAmount, 1, RETAINED);
        reward = bound(reward, 1, 100 ether);
        staking.stake(stakeAmount, address(this));
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(address(this));
        vm.deal(address(this), reward);
        source.depositNative{ value: reward }(address(rdao));
        vm.warp(block.timestamp + 1 hours);
        uint256 claimable = staking.earned(address(this));
        assertLe(claimable, reward);
        if (claimable == 0) {
            assertEq(staking.totalRewardsClaimed(), 0);
            assertEq(staking.outstandingLiability(), reward);
            return;
        }
        uint256 claimed = staking.claim();
        assertEq(claimed, claimable);
        assertLe(staking.totalRewardsClaimed(), weth.balanceOf(address(staking)) + claimed);
        assertEq(
            staking.totalRewardsClaimed() + staking.outstandingLiability(),
            staking.totalRewardsDeposited()
        );
    }

    function testFuzzWarmingExitIsImmediateAndDoesNotChangeVotes(uint256 amount) external {
        amount = bound(amount, 1, RETAINED);
        uint256 votesBefore = rdao.getVotes(address(this));
        staking.stake(amount, address(this));
        assertEq(rdao.getVotes(address(this)), votesBefore);
        staking.unstake(amount, address(this));
        assertEq(rdao.getVotes(address(this)), votesBefore);
        assertEq(staking.totalPrincipal(), 0);
        assertEq(staking.totalWarmingStake(), 0);
    }

    function testAdmissionAndViewBranchMatrix() external {
        vm.deal(USER, 1);
        vm.prank(USER);
        (bool accepted,) = address(staking).call{ value: 1 }("");
        assertFalse(accepted);
        assertEq(staking.predictEscrow(address(0)), address(0));
        assertEq(staking.currentRewardPerToken(), 0);
        assertEq(staking.warmupLotCount(address(this)), 0);
        vm.expectRevert(RobynRdaoStaking.NothingToActivate.selector);
        staking.activateFor(address(this));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.activateFor(address(this), 0);
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.stake(0, address(this));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.stake(1, address(0));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.unstake(0, address(this));
        vm.expectRevert(RobynRdaoStaking.InsufficientStake.selector);
        staking.unstake(1, address(this));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.setDelegate(address(0));
        vm.expectRevert(RobynRdaoStaking.InsufficientStake.selector);
        staking.setDelegate(address(this));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.claimFor(address(0));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.claimTo(address(0));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        staking.forwardLegacyRewards(payable(address(0)));
        vm.expectRevert(RobynRdaoStaking.InsufficientStake.selector);
        staking.forwardLegacyRewards(payable(address(this)));
        vm.expectRevert(RobynRdaoStaking.NothingToClaim.selector);
        staking.claim();
        staking.stake(1, address(this));
        vm.expectPartialRevert(RobynRdaoStaking.WarmupIncomplete.selector);
        staking.activateFor(address(this));
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(address(this));
        staking.unstake(1, address(this));
        staking.rewardAccountingState();
    }

    function testRewardSourcePauseWrappedAndSolvencyBranches() external {
        RobynRdaoStaking fresh = new RobynRdaoStaking(
            IERC20(address(rdao)),
            IRobynWrappedNative(address(weth)),
            address(this),
            GUARDIAN,
            WARMUP,
            1 hours,
            7 days
        );
        Schema20RewardSource freshSource = new Schema20RewardSource(fresh, IERC20(address(weth)));
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStaking.Unauthorized.selector);
        fresh.sealRewardSources();
        vm.deal(address(this), 2 ether);
        vm.expectRevert(RobynRdaoStaking.SourcesNotSealed.selector);
        freshSource.depositNative{ value: 1 }(address(rdao));
        vm.expectRevert(RobynRdaoStaking.SourcesNotSealed.selector);
        freshSource.depositWrapped(address(rdao), 1);
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        fresh.configureRewardSource(address(0), true);
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        fresh.configureRewardSource(USER, true);
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStaking.Unauthorized.selector);
        fresh.configureRewardSource(address(freshSource), true);
        fresh.configureRewardSource(address(freshSource), true);
        fresh.sealRewardSources();
        vm.expectRevert(RobynRdaoStaking.SourcesSealed.selector);
        fresh.sealRewardSources();
        vm.expectRevert(RobynRdaoStaking.SourcesSealed.selector);
        fresh.configureRewardSource(address(freshSource), false);
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStaking.Unauthorized.selector);
        fresh.setPaused(true);
        vm.prank(GUARDIAN);
        fresh.setPaused(true);
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStaking.Unauthorized.selector);
        fresh.setPaused(false);
        fresh.setPaused(false);

        vm.deal(USER, 1);
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStaking.Unauthorized.selector);
        fresh.depositRewards{ value: 1 }(address(rdao));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        freshSource.depositNative{ value: 1 }(address(0));
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        freshSource.depositNative{ value: 0 }(address(rdao));
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStaking.Unauthorized.selector);
        fresh.depositWrappedRewards(address(rdao), 1);
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        freshSource.depositWrapped(address(0), 1);
        vm.expectRevert(RobynRdaoStaking.InvalidConfiguration.selector);
        freshSource.depositWrapped(address(rdao), 0);
        vm.deal(address(this), 1 ether);
        weth.deposit{ value: 1 ether }();
        weth.transfer(address(freshSource), 1 ether);
        freshSource.depositWrapped(address(rdao), 1 ether);
        assertEq(fresh.queuedRewards(), 1 ether);
        vm.expectRevert(RobynRdaoStaking.NothingToActivate.selector);
        fresh.activateQueuedRewards();

        rdao.approve(address(fresh), 1);
        fresh.stake(1, address(this));
        vm.warp(block.timestamp + WARMUP);
        fresh.activateFor(address(this));
        vm.deal(address(this), 1);
        weth.deposit{ value: 1 }();
        weth.transfer(address(freshSource), 1);
        freshSource.depositWrapped(address(rdao), 1);
    }

    function testExplicitClaimSolvencyErrorPrecedesTransferFailure() external {
        staking.stake(1 ether, address(this));
        vm.warp(block.timestamp + WARMUP);
        staking.activateFor(address(this));
        vm.deal(address(this), 1 ether);
        source.depositNative{ value: 1 ether }(address(rdao));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(address(staking));
        weth.withdraw(1 ether);
        (,,,,,,, uint256 surplus, uint256 deficit,) = staking.rewardAccountingState();
        assertEq(surplus, 0);
        assertGt(deficit, 0);
        vm.expectPartialRevert(RobynRdaoStaking.RewardAccountingInsolvent.selector);
        staking.claim();
    }

    function testEscrowInitializationAuthorityAndLegacyRewardBranches() external {
        RobynRdaoStakeEscrow raw = new RobynRdaoStakeEscrow();
        vm.expectRevert(RobynRdaoStakeEscrow.InvalidConfiguration.selector);
        raw.initialize(IERC20(address(0)), address(this), address(this), address(this));
        raw.initialize(IERC20(address(rdao)), address(this), USER, USER);
        vm.expectRevert(RobynRdaoStakeEscrow.AlreadyInitialized.selector);
        raw.initialize(IERC20(address(rdao)), address(this), USER, USER);

        vm.prank(USER);
        vm.expectRevert(RobynRdaoStakeEscrow.Unauthorized.selector);
        raw.setDelegate(USER);
        vm.expectRevert(RobynRdaoStakeEscrow.InvalidConfiguration.selector);
        raw.setDelegate(address(0));
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStakeEscrow.Unauthorized.selector);
        raw.release(USER, 1);
        vm.expectRevert(RobynRdaoStakeEscrow.InvalidConfiguration.selector);
        raw.release(address(0), 1);
        vm.expectRevert(RobynRdaoStakeEscrow.InvalidConfiguration.selector);
        raw.release(USER, 0);
        vm.prank(USER);
        vm.expectRevert(RobynRdaoStakeEscrow.Unauthorized.selector);
        raw.forwardLegacyRewards(payable(USER));
        vm.expectRevert(RobynRdaoStakeEscrow.InvalidConfiguration.selector);
        raw.forwardLegacyRewards(payable(address(0)));

        staking.stake(1 ether, address(this));
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(staking);
        rdao.sealRewardExclusions(exclusions);
        rdao.bindRewardDepositor(address(source));
        vm.deal(address(source), 1 ether);
        vm.prank(address(source));
        rdao.depositRewards{ value: 1 ether }();
        vm.warp(block.timestamp + 1 hours);
        uint256 before = address(this).balance;
        uint256 forwarded = staking.forwardLegacyRewards(payable(address(this)));
        assertGt(forwarded, 0);
        assertEq(address(this).balance - before, forwarded);
    }
}
