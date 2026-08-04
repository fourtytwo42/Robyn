// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { SafeCallback } from "@uniswap/v4-periphery/src/base/SafeCallback.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { DevnetWrappedNative } from "../src/devnet/DevnetWrappedNative.sol";
import { RobynRdaoBondingSale } from "../src/RobynRdaoBondingSale.sol";
import { IRobynWrappedNative, RobynRdaoStaking } from "../src/RobynRdaoStaking.sol";
import { RobynRdaoV4LiquidityLocker } from "../src/uniswap/RobynRdaoV4LiquidityLocker.sol";

contract Schema20RdaoV4Trader is SafeCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using SafeERC20 for IERC20;

    PoolKey private _key;

    constructor(IPoolManager manager, PoolKey memory key) SafeCallback(manager) {
        _key = key;
    }

    function swap(address inputToken, uint128 amount, address recipient)
        external
        returns (uint256 output)
    {
        bool zeroForOne = Currency.unwrap(_key.currency0) == inputToken;
        output = abi.decode(
            poolManager.unlock(abi.encode(zeroForOne, amount, recipient, msg.sender)), (uint256)
        );
    }

    function _unlockCallback(bytes calldata data) internal override returns (bytes memory) {
        (bool zeroForOne, uint128 amount, address recipient, address payer) =
            abi.decode(data, (bool, uint128, address, address));
        BalanceDelta delta = poolManager.swap(
            _key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(amount)),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            bytes("")
        );
        int128 signedInput = zeroForOne ? delta.amount0() : delta.amount1();
        int128 signedOutput = zeroForOne ? delta.amount1() : delta.amount0();
        require(signedInput < 0 && signedOutput > 0, "delta");
        uint256 input = uint256(uint128(-signedInput));
        uint256 output = uint256(uint128(signedOutput));
        Currency inputCurrency = zeroForOne ? _key.currency0 : _key.currency1;
        Currency outputCurrency = zeroForOne ? _key.currency1 : _key.currency0;
        poolManager.sync(inputCurrency);
        IERC20(Currency.unwrap(inputCurrency)).safeTransferFrom(payer, address(poolManager), input);
        poolManager.settle();
        poolManager.take(outputCurrency, recipient, output);
        return abi.encode(output);
    }
}

contract Schema20LockerSaleIdentity {
    IERC20 public immutable rdao;
    RobynRdaoStaking public immutable staking;
    address public immutable graduationFinalizer;

    constructor(IERC20 rdao_, RobynRdaoStaking staking_, address finalizer_) {
        rdao = rdao_;
        staking = staking_;
        graduationFinalizer = finalizer_;
    }
}

contract RobynRdaoV4LiquidityLockerTest is Test {
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant SALE = 150_000_000 ether;
    uint256 private constant LP_TOKENS = 50_000_000 ether;
    uint256 private constant VIRTUAL_RDAO = 600_000_000 ether;
    uint256 private constant CURVE_TARGET = 332_317_917_474_383_827_195;
    uint256 private constant VIRTUAL_NATIVE = 996_953_752_423_151_481_585;
    uint256 private constant OWNER_PAYOUT = 184_621_065_263_546_570_663;
    uint256 private constant LP_NATIVE = 147_696_852_210_837_256_531;
    address private constant BUYER = address(0xB0B);
    address private constant GUARDIAN = address(0xA11CE);

    IPoolManager private poolManager;
    IStateView private stateView;
    RobynDaoToken private rdao;
    DevnetWrappedNative private weth;
    RobynRdaoStaking private staking;
    RobynRdaoV4LiquidityLocker private locker;
    RobynRdaoBondingSale private sale;

    receive() external payable { }

    function setUp() external {
        poolManager = IPoolManager(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/PoolManager.sol/PoolManager.default.json",
                abi.encode(address(this))
            )
        );
        stateView = IStateView(
            _deployPinned(
                "../../node_modules/@uniswap/v4-periphery/foundry-out/StateView.sol/StateView.json",
                abi.encode(poolManager)
            )
        );
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
        locker = new RobynRdaoV4LiquidityLocker(
            poolManager,
            IERC20(address(rdao)),
            IRobynWrappedNative(address(weth)),
            staking,
            10_000,
            10_000
        );
        RobynRdaoBondingSale.SaleConfiguration memory config = RobynRdaoBondingSale.SaleConfiguration({
            deployerPayoutRecipient: payable(address(0xDA0)),
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
        sale = new RobynRdaoBondingSale(IERC20(address(rdao)), staking, locker, config);
        locker.bindSale(address(sale));
        staking.configureRewardSource(address(sale), true);
        staking.configureRewardSource(address(locker), true);
        staking.sealRewardSources();
        rdao.approve(address(sale), SALE + LP_TOKENS);
        sale.fundAllocation();
    }

    function testRealV4GraduationLocksPrincipalAndHarvestsBothFeeSides() external {
        vm.deal(BUYER, 1_000 ether);
        vm.prank(BUYER);
        sale.buy{ value: 1_000 ether }(SALE, block.timestamp + 1, BUYER);
        sale.finalizeGraduation();
        assertTrue(locker.initialized());
        assertGt(locker.principalLiquidity(), 0);
        assertEq(locker.principalRdaoUsed() + locker.lockedRdaoResidual(), LP_TOKENS);
        assertEq(
            locker.principalWethUsed() + staking.totalRewardsDeposited(),
            LP_NATIVE + sale.totalBondingFees() + sale.graduationDustToStaking()
        );
        assertLe(locker.lockedRdaoResidual(), 10_000);
        assertEq(locker.lockedWethResidual(), 0);
        (uint128 recordedLiquidity,,) = stateView.getPositionInfo(
            PoolId.wrap(locker.poolId()),
            address(locker),
            locker.TICK_LOWER(),
            locker.TICK_UPPER(),
            bytes32(0)
        );
        assertEq(recordedLiquidity, locker.principalLiquidity());

        Schema20RdaoV4Trader trader = new Schema20RdaoV4Trader(poolManager, locker.poolKey());
        vm.deal(address(this), 2 ether);
        weth.deposit{ value: 2 ether }();
        weth.approve(address(trader), type(uint256).max);
        uint256 rdaoOut = trader.swap(address(weth), 1 ether, address(this));
        assertGt(rdaoOut, 0);
        rdao.approve(address(trader), type(uint256).max);
        uint256 wethOut = trader.swap(address(rdao), uint128(rdaoOut / 2), address(this));
        assertGt(wethOut, 0);

        uint256 depositedBefore = staking.totalRewardsDeposited();
        uint256 harvested = locker.harvest(0, block.timestamp + 1);
        assertGt(harvested, 0);
        assertEq(staking.totalRewardsDeposited() - depositedBefore, harvested);
        assertGt(locker.cumulativeWethFees(), 0);
        assertGt(locker.cumulativeRdaoFees(), 0);
        (recordedLiquidity,,) = stateView.getPositionInfo(
            PoolId.wrap(locker.poolId()),
            address(locker),
            locker.TICK_LOWER(),
            locker.TICK_UPPER(),
            bytes32(0)
        );
        assertEq(recordedLiquidity, locker.principalLiquidity());
    }

    function testLockerHasNoPrincipalRemovalOrArbitraryCallSurface() external {
        (bool removed,) = address(locker)
            .call(abi.encodeWithSignature("removeLiquidity(uint128,address)", 1, address(this)));
        assertFalse(removed);
        (bool called,) = address(locker)
            .call(abi.encodeWithSignature("execute(address,bytes)", address(rdao), bytes("")));
        assertFalse(called);
    }

    function testLockerBindingAndAdmissionBranches() external {
        vm.expectRevert();
        new RobynRdaoV4LiquidityLocker(
            IPoolManager(address(0)),
            IERC20(address(rdao)),
            IRobynWrappedNative(address(weth)),
            staking,
            10_000,
            10_000
        );
        vm.prank(BUYER);
        vm.expectRevert(RobynRdaoV4LiquidityLocker.Unauthorized.selector);
        locker.bindSale(address(sale));
        vm.expectRevert(RobynRdaoV4LiquidityLocker.Unauthorized.selector);
        locker.finalizeRdaoLiquidity(
            IERC20(address(rdao)),
            LP_TOKENS,
            VIRTUAL_RDAO - SALE,
            VIRTUAL_NATIVE + CURVE_TARGET,
            address(staking)
        );
        vm.expectRevert(RobynRdaoV4LiquidityLocker.InvalidConfiguration.selector);
        locker.bindSale(address(sale));

        RobynRdaoV4LiquidityLocker fresh = new RobynRdaoV4LiquidityLocker(
            poolManager,
            IERC20(address(rdao)),
            IRobynWrappedNative(address(weth)),
            staking,
            10_000,
            10_000
        );
        vm.expectRevert(RobynRdaoV4LiquidityLocker.InvalidConfiguration.selector);
        fresh.bindSale(address(0));
        vm.expectRevert(RobynRdaoV4LiquidityLocker.InvalidConfiguration.selector);
        fresh.bindSale(BUYER);
        Schema20LockerSaleIdentity wrong =
            new Schema20LockerSaleIdentity(IERC20(address(weth)), staking, address(fresh));
        vm.expectRevert(RobynRdaoV4LiquidityLocker.InvalidConfiguration.selector);
        fresh.bindSale(address(wrong));

        Schema20LockerSaleIdentity selected =
            new Schema20LockerSaleIdentity(IERC20(address(rdao)), staking, address(fresh));
        fresh.bindSale(address(selected));
        vm.prank(address(selected));
        vm.expectRevert(RobynRdaoV4LiquidityLocker.InvalidConfiguration.selector);
        fresh.finalizeRdaoLiquidity(
            IERC20(address(weth)),
            LP_TOKENS,
            VIRTUAL_RDAO - SALE,
            VIRTUAL_NATIVE + CURVE_TARGET,
            address(staking)
        );
    }

    function testHarvestReadinessDeadlineAndMinimumBranches() external {
        RobynRdaoV4LiquidityLocker fresh = new RobynRdaoV4LiquidityLocker(
            poolManager,
            IERC20(address(rdao)),
            IRobynWrappedNative(address(weth)),
            staking,
            10_000,
            10_000
        );
        vm.expectRevert(RobynRdaoV4LiquidityLocker.NotInitialized.selector);
        fresh.harvest(0, block.timestamp);

        vm.deal(BUYER, 1_000 ether);
        vm.prank(BUYER);
        sale.buy{ value: 1_000 ether }(SALE, block.timestamp + 1, BUYER);
        sale.finalizeGraduation();
        vm.expectRevert(RobynRdaoV4LiquidityLocker.InvalidConfiguration.selector);
        locker.harvest(0, block.timestamp - 1);
        vm.expectPartialRevert(RobynRdaoV4LiquidityLocker.SlippageExceeded.selector);
        locker.harvest(1, block.timestamp);
        vm.prank(address(sale));
        vm.expectRevert(RobynRdaoV4LiquidityLocker.AlreadyInitialized.selector);
        locker.finalizeRdaoLiquidity(
            IERC20(address(rdao)),
            LP_TOKENS,
            VIRTUAL_RDAO - SALE,
            VIRTUAL_NATIVE + CURVE_TARGET,
            address(staking)
        );
    }

    function _deployPinned(string memory path, bytes memory constructorArgs)
        private
        returns (address deployed)
    {
        bytes memory creationCode = vm.parseJsonBytes(vm.readFile(path), ".bytecode.object");
        bytes memory initCode = bytes.concat(creationCode, constructorArgs);
        assembly { deployed := create(0, add(initCode, 0x20), mload(initCode)) }
        require(deployed != address(0), "pinned deployment failed");
    }
}
