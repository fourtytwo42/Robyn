// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {
    RobynV4TestAssetLiquidityLocker
} from "../src/uniswap/RobynV4TestAssetLiquidityLocker.sol";

contract LockerTestAsset is ERC20 {
    constructor() ERC20("Robyn Testnet Mock Asset", "tmTEST") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

contract RobynV4TestAssetLiquidityLockerTest is Test {
    IPoolManager internal poolManager;
    IStateView internal stateView;
    LockerTestAsset internal asset;
    RobynV4TestAssetLiquidityLocker internal locker;

    receive() external payable { }

    function setUp() public {
        vm.deal(address(this), 100 ether);
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
        asset = new LockerTestAsset();
        locker = new RobynV4TestAssetLiquidityLocker(poolManager);
        asset.approve(address(locker), type(uint256).max);
    }

    function testSeedsFullRangeLiquidityAndPermanentlyOmitsRemoval() public {
        (bytes32 poolId, uint256 nativeAmount, uint256 tokenAmount) =
            locker.seed{ value: 11 ether }(address(asset), 10 ether, 11 ether);
        (uint128 liquidity,,) = stateView.getPositionInfo(
            PoolId.wrap(poolId),
            address(locker),
            locker.TICK_LOWER(),
            locker.TICK_UPPER(),
            bytes32(0)
        );

        assertEq(liquidity, 10 ether);
        assertGt(nativeAmount, 0);
        assertGt(tokenAmount, 0);
        assertEq(address(locker).balance, 0);
        assertEq(asset.balanceOf(address(locker)), 0);
        assertEq(locker.position(poolId).asset, address(asset));

        (bool removed,) = address(locker)
            .call(
                abi.encodeWithSignature(
                    "remove(bytes32,uint128,address)", poolId, liquidity, address(this)
                )
            );
        assertFalse(removed);
        (uint128 liquidityAfter,,) = stateView.getPositionInfo(
            PoolId.wrap(poolId),
            address(locker),
            locker.TICK_LOWER(),
            locker.TICK_UPPER(),
            bytes32(0)
        );
        assertEq(liquidityAfter, liquidity);
    }

    function testOnlyInitializerCanSeedAndSealingIsPermanent() public {
        vm.deal(address(0xBEEF), 1 ether);
        vm.prank(address(0xBEEF));
        vm.expectRevert(RobynV4TestAssetLiquidityLocker.Unauthorized.selector);
        locker.seed{ value: 1 ether }(address(asset), 1 ether, 1 ether);

        locker.seal();
        assertTrue(locker.configurationSealed());
        vm.expectRevert(RobynV4TestAssetLiquidityLocker.Sealed.selector);
        locker.seed{ value: 1 ether }(address(asset), 1 ether, 1 ether);
        vm.expectRevert(RobynV4TestAssetLiquidityLocker.Sealed.selector);
        locker.seal();
    }

    function _deployPinned(string memory path, bytes memory constructorArgs)
        private
        returns (address deployed)
    {
        bytes memory creationCode = vm.parseJsonBytes(vm.readFile(path), ".bytecode.object");
        bytes memory initCode = bytes.concat(creationCode, constructorArgs);
        assembly {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0), "pinned deployment failed");
    }
}
