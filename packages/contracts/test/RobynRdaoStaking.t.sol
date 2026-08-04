// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { DevnetWrappedNative } from "../src/devnet/DevnetWrappedNative.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../src/RobynRdaoStaking.sol";

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
            IERC20(address(rdao)), IRobynWrappedNative(address(weth)), address(this), GUARDIAN,
            WARMUP, 1 hours, 7 days
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
        (, uint256 eligible, uint256 warming, uint256 nextReady,,) =
            staking.position(address(this));
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
}
