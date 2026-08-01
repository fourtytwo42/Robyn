// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";

interface Schema18RewardVm {
    function deal(address account, uint256 newBalance) external;
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
}

contract Schema18RewardDepositor {
    function deposit(RobynDaoToken token) external payable {
        token.depositRewards{ value: msg.value }();
    }
}

contract Schema18RewardAsset is ERC20 {
    constructor() ERC20("Schema 18 Reward", "S18R") { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract Schema18RewardAccountingTest {
    Schema18RewardVm private constant vm =
        Schema18RewardVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256[9] private depositAmounts = [
        uint256(21_672_087_355_371),
        uint256(394_059_840),
        uint256(1_352_039_762_027),
        uint256(27_089_171_808),
        uint256(270_405_962),
        uint256(2_704_049),
        uint256(27_040),
        uint256(270),
        uint256(1)
    ];

    uint256[9] private depositTimestamps = [
        uint256(1_785_586_532),
        uint256(1_785_586_549),
        uint256(1_785_586_854),
        uint256(1_785_586_867),
        uint256(1_785_586_888),
        uint256(1_785_586_903),
        uint256(1_785_586_918),
        uint256(1_785_586_939),
        uint256(1_785_586_958)
    ];

    function testExactSchema17DaoIncidentNeverOvercreditsAndClaimSucceeds() external {
        address holder = address(0xA11CE);
        address excluded = address(0xBEEF);
        address[] memory recipients = new address[](1);
        recipients[0] = holder;
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        RobynDaoToken token = new RobynDaoToken(recipients, allocations, 1 hours);
        Schema18RewardDepositor depositor = new Schema18RewardDepositor();
        address[] memory exclusions = new address[](1);
        exclusions[0] = excluded;
        token.sealRewardExclusions(exclusions);
        token.bindRewardDepositor(address(depositor));
        vm.deal(address(this), 1 ether);

        uint256 deposited;
        for (uint256 index; index < depositAmounts.length; ++index) {
            vm.warp(depositTimestamps[index]);
            deposited += depositAmounts[index];
            depositor.deposit{ value: depositAmounts[index] }(token);
        }
        require(deposited == 23_051_883_486_368, "incident deposit total");

        vm.warp(depositTimestamps[8] + 1 hours);
        uint256 claimable = token.claimableRewardOf(holder);
        require(claimable <= deposited, "reward over-credit");
        require(deposited - claimable <= 1, "rounding carry too large");
        require(token.totalRewardsVested() == deposited, "vested conservation");

        uint256 beforeBalance = holder.balance;
        vm.prank(holder);
        token.claimRewards();
        require(holder.balance - beforeBalance == claimable, "claim transfer");
        require(address(token).balance == deposited - claimable, "backing remainder");
        require(token.totalRewardsClaimed() == claimable, "claimed conservation");
    }

    function testHolderIncidentSequenceNeverRequeuesReleasedDust() external {
        address holder = address(0xA11CE);
        Schema18RewardAsset rewardAsset = new Schema18RewardAsset();
        address[] memory assets = new address[](1);
        assets[0] = address(rewardAsset);
        RobynLaunchToken token = new RobynLaunchToken(
            "Schema 18 Launch",
            "S18",
            holder,
            1_000_000_000 ether,
            address(this),
            assets,
            "ipfs://baaaaaaaaaaaaaaaaaaaa"
        );
        token.sealExclusions(new address[](0));
        rewardAsset.mint(address(this), 1 ether);
        rewardAsset.approve(address(token), type(uint256).max);

        uint256 deposited;
        for (uint256 index; index < depositAmounts.length; ++index) {
            vm.warp(depositTimestamps[index]);
            deposited += depositAmounts[index];
            token.distributeReward(0, depositAmounts[index]);
        }
        vm.warp(depositTimestamps[8] + 1 hours);
        uint256 claimable = token.withdrawableRewardOf(holder, 0);
        require(claimable <= deposited, "holder reward over-credit");
        require(deposited - claimable <= 1, "holder carry too large");
        require(token.totalRewardsVested(0) == deposited, "holder vested conservation");

        vm.prank(holder);
        token.claim(0);
        require(rewardAsset.balanceOf(holder) == claimable, "holder claim transfer");
        require(rewardAsset.balanceOf(address(token)) == deposited - claimable, "holder backing");
    }

    function testOneWeiStreamsCompleteWithoutBeingRequeued() external {
        address holder = address(0xA11CE);
        address[] memory recipients = new address[](1);
        recipients[0] = holder;
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        RobynDaoToken token = new RobynDaoToken(recipients, allocations, 1 hours);
        Schema18RewardDepositor depositor = new Schema18RewardDepositor();
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(0xBEEF);
        token.sealRewardExclusions(exclusions);
        token.bindRewardDepositor(address(depositor));
        vm.deal(address(this), 1 ether);

        depositor.deposit{ value: 1 }(token);
        vm.warp(block.timestamp + 1 hours);
        require(token.queuedRewards() == 0, "one wei requeued");
        require(token.claimableRewardOf(holder) <= 1, "one wei over-credit");
        require(token.totalRewardsVested() == 1, "one wei not vested");
    }

    function testThousandHoldersCannotCreateRewardValue() external {
        address holder = address(0xA11CE);
        address[] memory recipients = new address[](1);
        recipients[0] = holder;
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        RobynDaoToken token = new RobynDaoToken(recipients, allocations, 1 hours);
        Schema18RewardDepositor depositor = new Schema18RewardDepositor();
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(0xBEEF);
        token.sealRewardExclusions(exclusions);
        token.bindRewardDepositor(address(depositor));
        vm.deal(address(this), 1 ether);

        uint256 holderCount = 1_000;
        uint256 allocation = 1_000 ether;
        for (uint256 index; index < holderCount; ++index) {
            vm.prank(holder);
            token.transfer(address(uint160(0x10_000 + index)), allocation);
        }
        uint256 deposited;
        for (uint256 index; index < depositAmounts.length; ++index) {
            deposited += depositAmounts[index];
            depositor.deposit{ value: depositAmounts[index] }(token);
            vm.warp(block.timestamp + 17 + index);
        }
        vm.warp(block.timestamp + 1 hours);

        uint256 aggregateClaimable = token.claimableRewardOf(holder);
        for (uint256 index; index < holderCount; ++index) {
            aggregateClaimable += token.claimableRewardOf(address(uint160(0x10_000 + index)));
        }
        require(aggregateClaimable <= deposited, "aggregate reward over-credit");
        require(token.totalRewardsVested() == deposited, "aggregate vested conservation");
        require(token.distributionRemainder() < token.eligibleRewardSupply(), "carry bound");
    }
}
