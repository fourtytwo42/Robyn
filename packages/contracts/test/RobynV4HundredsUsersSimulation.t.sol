// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynTestnetGovernor } from "../src/dao/RobynTestnetGovernor.sol";
import { RobynNativeBasketVaultV2 } from "../src/uniswap/RobynNativeBasketVaultV2.sol";
import { RobynNativeLaunchFactoryV4 } from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4FeePositionLocker } from "../src/uniswap/RobynV4FeePositionLocker.sol";
import { RobynV4NativeProtocolTest, V4TestAsset } from "./RobynV4NativeProtocol.t.sol";

contract AssuranceGovernedValue {
    address public immutable timelock;
    uint256 public value;

    constructor(address timelock_) {
        timelock = timelock_;
    }

    function setValue(uint256 value_) external {
        require(msg.sender == timelock, "timelock only");
        value = value_;
    }
}

/// @notice Native-v4 deterministic economic campaign mirroring the public assurance profile.
/// @dev The test executes 25,000 state-changing actions across 512 deterministic EOAs and
///      32 atomic launches. Twenty fixed seeds partition the action stream for exact replay.
contract RobynV4HundredsUsersSimulationTest is RobynV4NativeProtocolTest {
    uint256 private constant USER_COUNT = 512;
    uint256 private constant LAUNCH_COUNT = 32;
    uint256 private constant ACTION_COUNT = 25_000;
    uint256 private constant SEED_COUNT = 20;

    V4TestAsset[] private assets;
    RobynLaunchToken[] private tokens;
    RobynNativeBasketVaultV2[] private vaults;
    RobynV4BondingCurveMarket[] private markets;

    function setUp() public override {
        super.setUp();
        assets.push(basketAsset);
        for (uint256 index = 1; index < 24; ++index) {
            V4TestAsset asset = new V4TestAsset();
            assets.push(asset);
            _seedAssetPool(asset);
        }

        daoToken.delegate(address(this));
        for (uint256 index; index < USER_COUNT; ++index) {
            address actor = _actor(index);
            vm.deal(actor, 20 ether);
            daoToken.transfer(actor, 1_000_000 ether);
            vm.prank(actor);
            daoToken.delegate(actor);
        }
        vm.warp(block.timestamp + 1);

        for (uint256 index; index < LAUNCH_COUNT; ++index) {
            address creator = _actor(index % 8);
            vm.prank(creator);
            (
                RobynLaunchToken token,
                RobynNativeBasketVaultV2 vault,
                RobynV4BondingCurveMarket market
            ) = coordinator.createLaunch(_campaignRequest(index));
            tokens.push(token);
            vaults.push(vault);
            markets.push(market);
        }
    }

    function testNativeV4Campaign512Wallets32Launches25000Actions20Seeds() public {
        uint256 successfulActions;
        for (uint256 seed; seed < SEED_COUNT; ++seed) {
            for (uint256 offset; offset < ACTION_COUNT / SEED_COUNT; ++offset) {
                uint256 entropy = uint256(keccak256(abi.encode(seed, offset)));
                uint256 marketIndex = (entropy >> 32) % LAUNCH_COUNT;
                address actor = _actor(entropy % USER_COUNT);
                RobynV4BondingCurveMarket market = markets[marketIndex];
                RobynLaunchToken token = tokens[marketIndex];

                vm.startPrank(actor);
                uint256 balance = token.balanceOf(actor);
                if (entropy % 5 == 0 && balance > 1_000) {
                    uint256 sellAmount = balance / 25;
                    token.approve(address(market), sellAmount);
                    market.sell(sellAmount, 1);
                } else {
                    market.buy{ value: 0.000005 ether }(1);
                }
                vm.stopPrank();
                ++successfulActions;
            }
        }
        assertEq(successfulActions, ACTION_COUNT);

        _graduateThreeAndTrade();
        _convertAllBasketRewards();
        _claimRewardsAndCreators();
        _runShortenedGovernance();
        _assertCampaignConservation();
    }

    function _graduateThreeAndTrade() private {
        for (uint256 index; index < 3; ++index) {
            address actor = _actor(500 + index);
            vm.prank(actor);
            _graduateMarket(markets[index]);
            assertTrue(markets[index].graduated());

            RobynV4FeePositionLocker locker = markets[index].graduationAdapter().locker();
            uint128 principal = locker.principalLiquidity();
            assertGt(principal, 0);
            assertEq(positionManager.ownerOf(locker.positionTokenId()), address(locker));
            assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principal);

            vm.prank(actor);
            markets[index].buy{ value: 0.001 ether }(1);
            uint256 balance = tokens[index].balanceOf(actor);
            uint256 sellAmount = balance / 100;
            vm.startPrank(actor);
            tokens[index].approve(address(markets[index]), sellAmount);
            markets[index].sell(sellAmount, 1);
            vm.stopPrank();
            locker.collectFees(0, 0);
            assertEq(positionManager.getPositionLiquidity(locker.positionTokenId()), principal);
        }
    }

    function _convertAllBasketRewards() private {
        for (uint256 launchIndex; launchIndex < LAUNCH_COUNT; ++launchIndex) {
            RobynNativeBasketVaultV2 vault = vaults[launchIndex];
            for (uint256 legIndex; legIndex < 3; ++legIndex) {
                RobynNativeBasketVaultV2.BasketLeg memory selected = vault.leg(legIndex);
                if (selected.pendingNative != 0) {
                    (uint256 quote,) = assetRouter.quoteNativeToAsset(
                        address(selected.asset), uint128(selected.pendingNative)
                    );
                    vault.convertLeg(
                        legIndex,
                        selected.pendingNative,
                        (quote * 99) / 100,
                        block.timestamp + 1 hours
                    );
                }
            }
            assertEq(vault.totalPendingNative(), 0);
        }
    }

    function _claimRewardsAndCreators() private {
        for (uint256 index; index < 128; ++index) {
            address actor = _actor(index);
            uint256 launchIndex = index % LAUNCH_COUNT;
            for (uint256 legIndex; legIndex < 3; ++legIndex) {
                if (tokens[launchIndex].withdrawableRewardOf(actor, legIndex) != 0) {
                    vm.prank(actor);
                    tokens[launchIndex].claim(legIndex);
                }
            }
            if (daoToken.claimableRewardOf(actor) != 0) {
                vm.prank(actor);
                daoToken.claimRewards();
            }
        }

        for (uint256 creatorIndex; creatorIndex < 8; ++creatorIndex) {
            address[] memory creatorTokens = new address[](4);
            for (uint256 offset; offset < 4; ++offset) {
                creatorTokens[offset] = address(tokens[creatorIndex + (offset * 8)]);
            }
            vm.prank(_actor(creatorIndex));
            feeRouter.claimCreatorFeesBatch(creatorTokens);
        }
    }

    function _runShortenedGovernance() private {
        address[] memory empty = new address[](0);
        TimelockController timelock =
            new TimelockController(10 minutes, empty, empty, address(this));
        RobynTestnetGovernor governor = new RobynTestnetGovernor(daoToken, timelock);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(0xCAFE));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        AssuranceGovernedValue target = new AssuranceGovernedValue(address(timelock));
        address[] memory targets = new address[](1);
        targets[0] = address(target);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(AssuranceGovernedValue.setValue, (512));
        string memory description = "Sherwood Forest deterministic assurance";
        uint256 proposalId = governor.propose(targets, values, calldatas, description);

        vm.warp(block.timestamp + 10 minutes + 1);
        for (uint256 index; index < 120; ++index) {
            vm.prank(_actor(index));
            governor.castVote(proposalId, index % 10 == 0 ? 0 : index % 10 == 1 ? 2 : 1);
        }
        vm.expectRevert();
        vm.prank(_actor(0));
        governor.castVote(proposalId, 1);

        vm.warp(block.timestamp + 30 minutes + 1);
        assertEq(uint8(governor.state(proposalId)), 4);
        bytes32 descriptionHash = keccak256(bytes(description));
        governor.queue(targets, values, calldatas, descriptionHash);
        vm.warp(block.timestamp + 10 minutes + 1);
        governor.execute(targets, values, calldatas, descriptionHash);
        assertEq(target.value(), 512);
    }

    function _assertCampaignConservation() private view {
        assertEq(launchFactory.launchCount(), LAUNCH_COUNT);
        assertEq(daoToken.totalSupply(), 1_000_000_000 ether);
        assertEq(feeRouter.totalCreatorNativeLiability(), 0);

        uint256 cumulativeFees;
        uint256 basketFees;
        uint256 creatorFees;
        for (uint256 index; index < LAUNCH_COUNT; ++index) {
            assertEq(tokens[index].totalSupply(), 1_000_000_000 ether);
            assertTrue(tokens[index].exclusionsSealed());
            assertTrue(markets[index].seeded());
            assertEq(vaults[index].totalPendingNative(), 0);
            RobynNativeProtocolFeeRouterV4.LaunchFeeAccount memory account =
                feeRouter.launchAccount(address(tokens[index]));
            assertTrue(account.registered);
            assertEq(account.claimableCreatorNative, 0);
            cumulativeFees += account.cumulativeNativeFees;
            basketFees += vaults[index].totalFeesReceived();
            creatorFees += account.cumulativeCreatorNative;
        }
        assertEq(
            cumulativeFees,
            feeRouter.totalBasketNative() + creatorFees + feeRouter.totalDaoNativeRewards()
                + feeRouter.totalTreasuryNative()
        );
        assertEq(basketFees + feeRouter.totalBasketNativeLiability(), feeRouter.totalBasketNative());
        assertGe(address(feeRouter).balance, feeRouter.totalNativeLiabilities());
    }

    function _campaignRequest(uint256 index)
        private
        view
        returns (RobynNativeLaunchFactoryV4.LaunchRequest memory request)
    {
        address[] memory selectedAssets = new address[](3);
        uint16[] memory weights = new uint16[](3);
        for (uint256 legIndex; legIndex < 3; ++legIndex) {
            selectedAssets[legIndex] = address(assets[(index * 3 + legIndex) % 24]);
        }
        weights[0] = 4_000;
        weights[1] = 3_500;
        weights[2] = 2_500;
        request = RobynNativeLaunchFactoryV4.LaunchRequest({
            name: "Automated Assurance Launch",
            symbol: "AUTO",
            assets: selectedAssets,
            weights: weights,
            metadataUri: METADATA_URI,
            userSalt: keccak256(abi.encode("sherwood-assurance", index))
        });
    }

    function _actor(uint256 index) private pure returns (address) {
        return address(uint160(0xA550_0000 + index));
    }
}
