// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RobynV4NativeProtocolTest} from "./RobynV4NativeProtocol.t.sol";
import {RobynV4AssetRouter} from "../src/uniswap/RobynV4AssetRouter.sol";

contract RobynSchema14AssetRouterTest is RobynV4NativeProtocolTest {
    function testDirectWrappedNativeRouteIsOneToOne() public {
        assetRouter.configureWrappedNativeRoute(2 ether, true);

        uint256 wrappedBefore = testWrappedNative.balanceOf(address(this));
        uint256 wrappedOutput = assetRouter.swapExactNativeForAsset{value: 1 ether}(
            address(testWrappedNative), 1 ether, address(this), block.timestamp
        );
        assertEq(wrappedOutput, 1 ether);
        assertEq(testWrappedNative.balanceOf(address(this)), wrappedBefore + 1 ether);

        testWrappedNative.approve(address(assetRouter), 1 ether);
        uint256 nativeBefore = address(this).balance;
        uint256 nativeOutput = assetRouter.swapExactAssetForNative(
            address(testWrappedNative), 1 ether, 1 ether, payable(address(this)), block.timestamp
        );
        assertEq(nativeOutput, 1 ether);
        assertEq(address(this).balance, nativeBefore + 1 ether);
    }

    function testWrappedNativeRouteEnforcesBothInputCaps() public {
        assetRouter.configureWrappedNativeRoute(1 ether, true);

        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        assetRouter.swapExactNativeForAsset{value: 1 ether + 1}(
            address(testWrappedNative), 1, address(this), block.timestamp
        );

        testWrappedNative.deposit{value: 1 ether + 1}();
        testWrappedNative.approve(address(assetRouter), 1 ether + 1);
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        assetRouter.swapExactAssetForNative(
            address(testWrappedNative), 1 ether + 1, 1, payable(address(this)), block.timestamp
        );
    }

    function testWrappedNativeRouteDetectsRuntimeMutation() public {
        assetRouter.configureWrappedNativeRoute(2 ether, true);
        assertTrue(assetRouter.executionRouteStatus(address(testWrappedNative)).ready);
        vm.etch(address(testWrappedNative), hex"00");

        RobynV4AssetRouter.ExecutionRouteStatus memory status =
            assetRouter.executionRouteStatus(address(testWrappedNative));
        assertFalse(status.ready);
        assertEq(status.reason, keccak256("RUNTIME_HASH_MISMATCH"));
    }

    function testProviderCalldataEntrypointsDoNotExist() public {
        assetRouter.configureWrappedNativeRoute(2 ether, true);
        uint256 routerBalanceBefore = address(assetRouter).balance;
        uint256 wrappedBefore = testWrappedNative.balanceOf(address(this));

        (bool buySuccess,) = address(assetRouter).call{value: 1 ether}(
            abi.encodeWithSignature(
                "swapExactNativeForAssetWithData(address,uint256,address,uint256,bytes)",
                address(testWrappedNative),
                1 ether,
                address(this),
                block.timestamp,
                hex"deadbeef"
            )
        );
        assertFalse(buySuccess);
        assertEq(address(assetRouter).balance, routerBalanceBefore);
        assertEq(testWrappedNative.balanceOf(address(this)), wrappedBefore);

        (bool configureSuccess,) = address(assetRouter).call(hex"deadbeef");
        assertFalse(configureSuccess);
    }

    function testRouterSweepsForcedTokensToTimelock() public {
        basketAsset.transfer(address(assetRouter), 7);
        uint256 governorBefore = basketAsset.balanceOf(address(this));
        uint256 swept = assetRouter.sweepUnattributedToken(address(basketAsset));
        assertEq(swept, 7);
        assertEq(basketAsset.balanceOf(address(this)), governorBefore + 7);
        assertEq(basketAsset.balanceOf(address(assetRouter)), 0);
    }

    function testGuardianCanDisableAndPauseButCannotEnableOrResume() public {
        assetRouter.configureWrappedNativeRoute(2 ether, true);

        vm.prank(GUARDIAN);
        assetRouter.disableRoute(address(testWrappedNative), keccak256("GUARDIAN_DISABLED"));
        assertFalse(assetRouter.executionRouteStatus(address(testWrappedNative)).ready);

        vm.prank(GUARDIAN);
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        assetRouter.configureWrappedNativeRoute(2 ether, true);

        assetRouter.configureWrappedNativeRoute(2 ether, true);
        vm.prank(GUARDIAN);
        assetRouter.pauseConversions();
        assertFalse(assetRouter.executionRouteStatus(address(testWrappedNative)).ready);

        vm.prank(GUARDIAN);
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        assetRouter.resumeConversions();
        assetRouter.resumeConversions();
        assertTrue(assetRouter.executionRouteStatus(address(testWrappedNative)).ready);
    }
}
