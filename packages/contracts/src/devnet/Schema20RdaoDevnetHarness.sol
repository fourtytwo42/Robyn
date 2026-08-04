// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { RobynRdaoBondingSale } from "../RobynRdaoBondingSale.sol";
import { RobynRdaoStaking, IRobynWrappedNative } from "../RobynRdaoStaking.sol";
import { RobynBootstrapTimelock } from "../dao/RobynBootstrapTimelock.sol";
import { RobynDaoTokenV3 } from "../dao/RobynDaoTokenV3.sol";
import { RobynGovernorV2 } from "../dao/RobynGovernorV2.sol";
import { RobynRdaoV4LiquidityLocker } from "../uniswap/RobynRdaoV4LiquidityLocker.sol";

/// @notice Devnet-only constructor closure used by the restart-safe Schema-20 broadcaster.
contract Schema20RdaoDevnetHarness {
    uint256 public constant FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 public constant SALE_INVENTORY = 150_000_000 ether;
    uint256 public constant LIQUIDITY_INVENTORY = 50_000_000 ether;

    RobynDaoTokenV3 public immutable rdao;
    RobynBootstrapTimelock public immutable timelock;
    RobynGovernorV2 public immutable governor;
    RobynRdaoStaking public immutable staking;
    RobynRdaoV4LiquidityLocker public immutable liquidityLocker;
    RobynRdaoBondingSale public immutable sale;

    constructor(
        address owner,
        address guardian,
        IPoolManager poolManager,
        IRobynWrappedNative wrappedNative,
        uint256 warmupDuration
    ) {
        require(
            owner != address(0) && guardian != address(0) && owner != guardian
                && address(poolManager).code.length != 0 && address(wrappedNative).code.length != 0
                && warmupDuration != 0,
            "invalid Schema-20 Devnet configuration"
        );
        address[] memory recipients = new address[](1);
        recipients[0] = owner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = FIXED_SUPPLY;
        rdao = new RobynDaoTokenV3(recipients, amounts, 1 hours, owner);
        bytes32[2] memory plans = [
            keccak256("SCHEMA20_DEVNET_UNUSED_BOOTSTRAP_ONE"),
            keccak256("SCHEMA20_DEVNET_UNUSED_BOOTSTRAP_TWO")
        ];
        timelock = new RobynBootstrapTimelock(
            IERC20(address(rdao)),
            owner,
            guardian,
            keccak256(abi.encode("SCHEMA20_DEVNET", block.chainid, address(this))),
            plans
        );
        rdao.bindBootstrapController(address(timelock));
        governor = new RobynGovernorV2(rdao, timelock);
        staking = new RobynRdaoStaking(
            IERC20(address(rdao)),
            wrappedNative,
            address(timelock),
            guardian,
            warmupDuration,
            1 hours,
            7 days
        );
        liquidityLocker = new RobynRdaoV4LiquidityLocker(
            poolManager, IERC20(address(rdao)), wrappedNative, staking, 10_000, 100
        );
        sale = new RobynRdaoBondingSale(
            IERC20(address(rdao)),
            staking,
            liquidityLocker,
            RobynRdaoBondingSale.SaleConfiguration({
                deployerPayoutRecipient: payable(owner),
                governance: address(timelock),
                guardian: guardian,
                saleInventory: SALE_INVENTORY,
                liquidityInventory: LIQUIDITY_INVENTORY,
                virtualTokenReserve: 600_000_000 ether,
                virtualNativeReserve: 996_953_752_423_151_481_585,
                curvePrincipalTarget: 332_317_917_474_383_827_195,
                deployerPayout: 184_621_065_263_546_570_663,
                liquidityNative: 147_696_852_210_837_256_531,
                maintenanceGasLimit: 1_500_000
            })
        );
        liquidityLocker.bindSale(address(sale));
        staking.configureRewardSource(address(sale), true);
        staking.configureRewardSource(address(liquidityLocker), true);
        staking.sealRewardSources();
    }
}
