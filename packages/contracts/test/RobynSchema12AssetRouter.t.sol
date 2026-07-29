// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RobynV4NativeProtocolTest} from "./RobynV4NativeProtocol.t.sol";
import {
    IAllowanceHolder,
    RobynZeroExAllowanceHolderAdapter
} from "../src/uniswap/RobynZeroExAllowanceHolderAdapter.sol";
import {IRobynPriceGuard} from "../src/uniswap/IRobynPriceGuard.sol";
import {RobynV4AssetRouter} from "../src/uniswap/RobynV4AssetRouter.sol";
import {
    TestnetFixedRatePriceGuard,
    TestnetPinnedExecutionAdapter
} from "../src/testnet/TestnetPinnedExecutionAdapter.sol";

contract Schema12MockSettlement {
    function settle(address, uint256) external pure {}
}

contract Schema12MockPriceGuard is IRobynPriceGuard {
    bool public allowed = true;

    function setAllowed(bool allowed_) external {
        allowed = allowed_;
    }

    function validate(address, address, uint256, uint256) external view returns (bool) {
        return allowed;
    }
}

contract Schema12MockAllowanceHolder is IAllowanceHolder {
    using SafeERC20 for IERC20;

    bytes4 private constant SETTLE_SELECTOR = Schema12MockSettlement.settle.selector;
    uint16 public spendBps = 10_000;
    address public outputRecipient;

    function setSpendBps(uint16 spendBps_) external {
        require(spendBps_ <= 10_000, "invalid bps");
        spendBps = spendBps_;
    }

    function setOutputRecipient(address outputRecipient_) external {
        outputRecipient = outputRecipient_;
    }

    function exec(address, address token, uint256 amount, address payable, bytes calldata data)
        external
        payable
        returns (bytes memory result)
    {
        require(data.length >= 4 && bytes4(data[:4]) == SETTLE_SELECTOR, "bad settlement data");
        (address buyToken, uint256 outputAmount) = abi.decode(data[4:], (address, uint256));
        uint256 spent = amount * spendBps / 10_000;
        IERC20(token).safeTransferFrom(msg.sender, address(this), spent);
        IERC20(buyToken).safeTransfer(outputRecipient == address(0) ? msg.sender : outputRecipient, outputAmount);
        return bytes("");
    }
}

contract RobynSchema12AssetRouterTest is RobynV4NativeProtocolTest {
    Schema12MockAllowanceHolder private allowanceHolder;
    Schema12MockSettlement private settlement;
    Schema12MockPriceGuard private priceGuard;
    RobynZeroExAllowanceHolderAdapter private adapter;

    function setUp() public override {
        super.setUp();
        allowanceHolder = new Schema12MockAllowanceHolder();
        settlement = new Schema12MockSettlement();
        priceGuard = new Schema12MockPriceGuard();
        adapter = new RobynZeroExAllowanceHolderAdapter(
            address(assetRouter),
            address(basketAsset),
            address(testWrappedNative),
            address(allowanceHolder),
            address(settlement),
            payable(address(settlement)),
            address(0xD057),
            Schema12MockSettlement.settle.selector,
            block.chainid,
            address(allowanceHolder).codehash,
            address(settlement).codehash,
            address(settlement).codehash
        );
    }

    function testDirectWrappedNativeRouteIsOneToOne() public {
        assetRouter.configureWrappedNativeRoute(2 ether, keccak256("DIRECT_WETH"), true);

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

    function testDeterministicTestnetProviderRouteExercisesExecutionData() public {
        TestnetPinnedExecutionAdapter deterministicAdapter = new TestnetPinnedExecutionAdapter(
            address(assetRouter), address(basketAsset), address(testWrappedNative), address(0xCAFE), 2 ether
        );
        TestnetFixedRatePriceGuard deterministicGuard =
            new TestnetFixedRatePriceGuard(address(basketAsset), address(testWrappedNative), 2 ether);
        assetRouter.configureAdapterRoute(
            address(basketAsset),
            RobynV4AssetRouter.ExecutionRoute({
                kind: RobynV4AssetRouter.RouteKind.PinnedAdapter,
                adapter: address(deterministicAdapter),
                priceGuard: address(deterministicGuard),
                maximumNativeInput: 2 ether,
                maximumAssetInput: 4 ether,
                provider: keccak256("SCHEMA12_TESTNET_DETERMINISTIC"),
                adapterRuntimeHash: address(deterministicAdapter).codehash,
                priceGuardRuntimeHash: address(deterministicGuard).codehash,
                disabledReason: bytes32(0),
                enabled: true
            })
        );
        basketAsset.transfer(address(deterministicAdapter), 2 ether);
        (, bytes memory executionData) =
            deterministicAdapter.quote(address(testWrappedNative), address(basketAsset), 1 ether, keccak256("quote-1"));

        uint256 beforeBalance = basketAsset.balanceOf(address(this));
        uint256 output = assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, executionData
        );
        assertEq(output, 2 ether);
        assertEq(basketAsset.balanceOf(address(this)), beforeBalance + 2 ether);
        assertEq(testWrappedNative.balanceOf(address(0xCAFE)), 1 ether);
    }

    function testPinnedAdapterExecutesBothDirectionsAndClearsAllowance() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 4 ether);

        bytes memory buyData = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);
        uint256 assetBefore = basketAsset.balanceOf(address(this));
        uint256 assetOutput = assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, buyData
        );
        assertEq(assetOutput, 2 ether);
        assertEq(basketAsset.balanceOf(address(this)), assetBefore + 2 ether);
        assertEq(testWrappedNative.allowance(address(adapter), address(allowanceHolder)), 0);

        testWrappedNative.deposit{value: 1 ether}();
        testWrappedNative.transfer(address(allowanceHolder), 1 ether);
        basketAsset.approve(address(assetRouter), 2 ether);
        bytes memory sellData = _providerData(address(basketAsset), 2 ether, address(testWrappedNative), 1 ether);
        uint256 nativeBefore = address(this).balance;
        uint256 nativeOutput = assetRouter.swapExactAssetForNativeWithData(
            address(basketAsset), 2 ether, 1 ether, payable(address(this)), block.timestamp, sellData
        );
        assertEq(nativeOutput, 1 ether);
        assertEq(address(this).balance, nativeBefore + 1 ether);
        assertEq(basketAsset.allowance(address(adapter), address(allowanceHolder)), 0);
    }

    function testForcedAdapterTokensAreSweptWithoutBlockingExecution() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 2 ether);
        testWrappedNative.deposit{value: 1 wei}();
        testWrappedNative.transfer(address(adapter), 1 wei);
        basketAsset.transfer(address(adapter), 1 wei);
        bytes memory data = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);

        uint256 output = assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, data
        );
        assertEq(output, 2 ether);
        assertEq(testWrappedNative.balanceOf(address(0xD057)), 1 wei);
        assertEq(basketAsset.balanceOf(address(0xD057)), 1 wei);
    }

    function testRouterSweepsForcedTokensToTimelock() public {
        basketAsset.transfer(address(assetRouter), 7);
        uint256 governorBefore = basketAsset.balanceOf(address(this));
        uint256 swept = assetRouter.sweepUnattributedToken(address(basketAsset));
        assertEq(swept, 7);
        assertEq(basketAsset.balanceOf(address(this)), governorBefore + 7);
        assertEq(basketAsset.balanceOf(address(assetRouter)), 0);
    }

    function testPinnedAdapterRejectsMalformedOrSubstitutedCalldata() public {
        _configureAdapterRoute();
        vm.expectRevert(RobynZeroExAllowanceHolderAdapter.InvalidCalldata.selector);
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 1, address(this), block.timestamp, hex"12345678"
        );

        bytes memory substituted = abi.encodeWithSelector(
            IAllowanceHolder.exec.selector,
            address(settlement),
            address(testWrappedNative),
            2 ether,
            payable(address(settlement)),
            abi.encodeWithSelector(Schema12MockSettlement.settle.selector, address(basketAsset), 2 ether)
        );
        vm.expectRevert(RobynZeroExAllowanceHolderAdapter.InvalidCalldata.selector);
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 1, address(this), block.timestamp, substituted
        );

        bytes memory wrongInnerSelector = abi.encodeWithSelector(
            IAllowanceHolder.exec.selector,
            address(settlement),
            address(testWrappedNative),
            1 ether,
            payable(address(settlement)),
            abi.encodeWithSelector(bytes4(keccak256("notASettlement(address,uint256)")), address(basketAsset), 2 ether)
        );
        vm.expectRevert(RobynZeroExAllowanceHolderAdapter.InvalidCalldata.selector);
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 1, address(this), block.timestamp, wrongInnerSelector
        );
    }

    function testPinnedAdapterEnforcesIndependentInputCaps() public {
        _configureAdapterRoute();
        bytes memory buyData = _providerData(address(testWrappedNative), 3 ether, address(basketAsset), 1 ether);
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        assetRouter.swapExactNativeForAssetWithData{value: 3 ether}(
            address(basketAsset), 1, address(this), block.timestamp, buyData
        );

        basketAsset.approve(address(assetRouter), 4 ether);
        bytes memory sellData = _providerData(address(basketAsset), 4 ether, address(testWrappedNative), 1 ether);
        vm.expectRevert(RobynV4AssetRouter.InvalidAmount.selector);
        assetRouter.swapExactAssetForNativeWithData(
            address(basketAsset), 4 ether, 1, payable(address(this)), block.timestamp, sellData
        );
    }

    function testPinnedAdapterRejectsExpiredQuoteBeforeMovingAssets() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 2 ether);
        bytes memory data = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);
        uint256 holderBefore = basketAsset.balanceOf(address(allowanceHolder));

        vm.warp(block.timestamp + 2);
        vm.expectRevert(RobynV4AssetRouter.DeadlineExpired.selector);
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp - 1, data
        );
        assertEq(basketAsset.balanceOf(address(allowanceHolder)), holderBefore);
    }

    function testPinnedAdapterRejectsPartialFillAtomically() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 2 ether);
        allowanceHolder.setSpendBps(5_000);
        bytes memory data = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);
        uint256 holderAssetBefore = basketAsset.balanceOf(address(allowanceHolder));

        vm.expectRevert(
            abi.encodeWithSelector(
                RobynZeroExAllowanceHolderAdapter.ResidualBalance.selector, address(testWrappedNative), 0.5 ether
            )
        );
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, data
        );
        assertEq(basketAsset.balanceOf(address(allowanceHolder)), holderAssetBefore);
        assertEq(testWrappedNative.balanceOf(address(adapter)), 0);
    }

    function testPinnedAdapterRejectsOutputDiversionAtomically() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 2 ether);
        allowanceHolder.setOutputRecipient(address(0xBEEF));
        bytes memory data = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);
        uint256 holderAssetBefore = basketAsset.balanceOf(address(allowanceHolder));

        vm.expectRevert(
            abi.encodeWithSelector(RobynZeroExAllowanceHolderAdapter.InsufficientOutput.selector, 2 ether, 0)
        );
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, data
        );
        assertEq(basketAsset.balanceOf(address(allowanceHolder)), holderAssetBefore);
        assertEq(basketAsset.balanceOf(address(0xBEEF)), 0);
    }

    function testPinnedAdapterRejectsSettlementRuntimeMutation() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 2 ether);
        bytes memory data = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);
        vm.etch(address(settlement), hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(RobynZeroExAllowanceHolderAdapter.RuntimeHashMismatch.selector, address(settlement))
        );
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, data
        );
    }

    function testWrappedNativeRouteDetectsRuntimeMutation() public {
        assetRouter.configureWrappedNativeRoute(2 ether, keccak256("DIRECT_WETH"), true);
        assertTrue(assetRouter.executionRouteStatus(address(testWrappedNative)).ready);
        vm.etch(address(testWrappedNative), hex"00");

        RobynV4AssetRouter.ExecutionRouteStatus memory status =
            assetRouter.executionRouteStatus(address(testWrappedNative));
        assertFalse(status.ready);
        assertEq(status.reason, assetRouter.REASON_RUNTIME_HASH_MISMATCH());
    }

    function testIndependentGuardRevertsProviderSwapAtomically() public {
        _configureAdapterRoute();
        basketAsset.transfer(address(allowanceHolder), 2 ether);
        priceGuard.setAllowed(false);
        bytes memory data = _providerData(address(testWrappedNative), 1 ether, address(basketAsset), 2 ether);

        uint256 holderAssetBefore = basketAsset.balanceOf(address(allowanceHolder));
        vm.expectRevert(RobynV4AssetRouter.PriceGuardRejected.selector);
        assetRouter.swapExactNativeForAssetWithData{value: 1 ether}(
            address(basketAsset), 2 ether, address(this), block.timestamp, data
        );
        assertEq(basketAsset.balanceOf(address(allowanceHolder)), holderAssetBefore);
        assertEq(testWrappedNative.balanceOf(address(adapter)), 0);
    }

    function testGuardianCanDisableAndPauseButCannotEnableOrResume() public {
        _configureAdapterRoute();
        vm.prank(GUARDIAN);
        assetRouter.disableRoute(address(basketAsset), keccak256("GUARDIAN_DISABLED"));
        assertFalse(assetRouter.executionRouteStatus(address(basketAsset)).ready);

        RobynV4AssetRouter.ExecutionRoute memory route = assetRouter.executionRoute(address(basketAsset));
        route.enabled = true;
        route.disabledReason = bytes32(0);
        vm.prank(GUARDIAN);
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        assetRouter.configureAdapterRoute(address(basketAsset), route);

        _configureAdapterRoute();
        vm.prank(GUARDIAN);
        assetRouter.pauseConversions();
        assertFalse(assetRouter.executionRouteStatus(address(basketAsset)).ready);
        vm.prank(GUARDIAN);
        vm.expectRevert(RobynV4AssetRouter.Unauthorized.selector);
        assetRouter.resumeConversions();
        assetRouter.resumeConversions();
        assertTrue(assetRouter.executionRouteStatus(address(basketAsset)).ready);
    }

    function _configureAdapterRoute() private {
        assetRouter.configureAdapterRoute(
            address(basketAsset),
            RobynV4AssetRouter.ExecutionRoute({
                kind: RobynV4AssetRouter.RouteKind.PinnedAdapter,
                adapter: address(adapter),
                priceGuard: address(priceGuard),
                maximumNativeInput: 2 ether,
                maximumAssetInput: 3 ether,
                provider: keccak256("ZERO_EX_ALLOWANCE_HOLDER"),
                adapterRuntimeHash: address(adapter).codehash,
                priceGuardRuntimeHash: address(priceGuard).codehash,
                disabledReason: bytes32(0),
                enabled: true
            })
        );
    }

    function _providerData(address sellToken, uint256 amountIn, address buyToken, uint256 outputAmount)
        private
        view
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            IAllowanceHolder.exec.selector,
            address(settlement),
            sellToken,
            amountIn,
            payable(address(settlement)),
            abi.encodeWithSelector(Schema12MockSettlement.settle.selector, buyToken, outputAmount)
        );
    }
}
