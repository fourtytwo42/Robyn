// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynNativeLaunchDeployerV4 } from "../src/uniswap/RobynNativeLaunchDeployerV4.sol";
import { RobynNativeLaunchFactoryV4 } from "../src/uniswap/RobynNativeLaunchFactoryV4.sol";
import { RobynNativeProtocolFeeRouterV4 } from "../src/uniswap/RobynNativeProtocolFeeRouterV4.sol";
import { RobynV4BondingCurveMarket } from "../src/uniswap/RobynV4BondingCurveMarket.sol";
import { RobynV4NativeProtocolTest, V4TestAsset } from "./RobynV4NativeProtocol.t.sol";
import { Schema15AnvilLifecycleHarness } from "./harness/Schema15AnvilLifecycleHarness.sol";

contract Schema15DevnetTortureTest is RobynV4NativeProtocolTest {
    function testAllElevenSchema15RouteCandidatesMechanically() public {
        uint128 nativeInput = 0.00001 ether;
        for (uint256 index; index < 11; ++index) {
            V4TestAsset candidate = new V4TestAsset();
            _seedAssetPool(candidate);

            (uint256 buyQuote,) = assetRouter.quoteNativeToAsset(address(candidate), nativeInput);
            uint256 bought = assetRouter.swapExactNativeForAsset{ value: nativeInput }(
                address(candidate), (buyQuote * 99) / 100, address(this), block.timestamp + 1
            );
            assertGt(bought, 0, "mechanical buy returned zero");

            uint128 sellAmount = uint128(bought / 2);
            candidate.approve(address(assetRouter), sellAmount);
            (uint256 sellQuote,) = assetRouter.quoteAssetToNative(address(candidate), sellAmount);
            uint256 sold = assetRouter.swapExactAssetForNative(
                address(candidate),
                sellAmount,
                (sellQuote * 99) / 100,
                payable(address(this)),
                block.timestamp + 1
            );
            assertGt(sold, 0, "mechanical sell returned zero");
            assertEq(
                candidate.allowance(address(this), address(assetRouter)),
                0,
                "route allowance remained"
            );
        }
    }

    function testSchema15ProductionAndAcceleratedRewardConfigurations() public {
        V4TestAsset reward = new V4TestAsset();
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        RobynNativeLaunchDeployerV4.TokenRequest memory request =
            RobynNativeLaunchDeployerV4.TokenRequest({
                name: "Accelerated Schema 15",
                symbol: "S15A",
                supplyRecipient: address(this),
                initialSupply: 1_000_000_000 ether,
                vault: address(this),
                assets: assets,
                tokenUri: METADATA_URI
            });

        RobynNativeLaunchDeployerV4 accelerated = new RobynNativeLaunchDeployerV4(10 minutes);
        accelerated.bindController(address(this));
        RobynLaunchToken acceleratedToken =
            accelerated.deployToken(keccak256("schema15-accelerated"), request);
        address[] memory exclusions = new address[](0);
        accelerated.sealExclusions(acceleratedToken, exclusions);
        assertEq(acceleratedToken.REWARD_STREAM_DURATION(), 10 minutes);

        address[] memory recipients = new address[](1);
        recipients[0] = address(this);
        uint256[] memory allocations = new uint256[](1);
        allocations[0] = 1_000_000_000 ether;
        RobynDaoToken acceleratedDao = new RobynDaoToken(recipients, allocations, 10 minutes);
        RobynNativeProtocolFeeRouterV4 acceleratedRouter = new RobynNativeProtocolFeeRouterV4(
            acceleratedDao, assetRouter, TREASURY, GUARDIAN, 10 minutes
        );
        assertEq(acceleratedDao.REWARD_STREAM_DURATION(), 10 minutes);
        assertEq(acceleratedRouter.CREATOR_REWARD_STREAM_DURATION(), 10 minutes);
        assertEq(daoToken.REWARD_STREAM_DURATION(), 1 hours);
        assertEq(feeRouter.CREATOR_REWARD_STREAM_DURATION(), 1 hours);
    }

    function testSnapshotDepthsOneFiveTwentyReplayDeterministically() public {
        uint256[3] memory depths = [uint256(1), uint256(5), uint256(20)];
        for (uint256 depthIndex; depthIndex < depths.length; ++depthIndex) {
            RobynV4BondingCurveMarket market = _newReplayMarket(depthIndex);
            uint256 snapshot = vm.snapshotState();
            bytes32 first = _runReplaySequence(market, depths[depthIndex]);
            assertTrue(vm.revertToState(snapshot));
            bytes32 second = _runReplaySequence(market, depths[depthIndex]);
            assertEq(first, second, "snapshot replay drift");
        }
    }

    function _newReplayMarket(uint256 index) private returns (RobynV4BondingCurveMarket market) {
        address[] memory assets = new address[](1);
        assets[0] = address(basketAsset);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        RobynNativeLaunchFactoryV4.LaunchRequest memory request =
            RobynNativeLaunchFactoryV4.LaunchRequest({
                name: "Schema 15 Replay",
                symbol: "S15R",
                assets: assets,
                weights: weights,
                metadataUri: METADATA_URI,
                userSalt: keccak256(abi.encode("schema15-replay", index)),
                expectedGraduationProfileVersion: marketFactory.graduationProfileVersion()
            });
        (,, market) = coordinator.createLaunch(request);
    }

    function _runReplaySequence(RobynV4BondingCurveMarket market, uint256 depth)
        private
        returns (bytes32)
    {
        for (uint256 index; index < depth; ++index) {
            market.buy{ value: 0.0001 ether }(1);
        }
        RobynLaunchToken token = market.launchToken();
        return keccak256(
            abi.encode(
                market.virtualTokenReserve(),
                market.virtualNativeReserve(),
                market.realCurveTokenReserve(),
                market.curveNativePrincipal(),
                address(market).balance,
                token.balanceOf(address(this)),
                token.totalSupply()
            )
        );
    }
}
