// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { FeeBasketVault } from "../src/FeeBasketVault.sol";
import { RobynLaunchFactory } from "../src/RobynLaunchFactory.sol";
import {
    INonfungiblePositionManager,
    IQuoterV2,
    ISwapRouter,
    IUniswapV3Factory
} from "../src/uniswap/UniswapV3Interfaces.sol";
import { RewardFeePositionLocker } from "../src/uniswap/RewardFeePositionLocker.sol";
import { UniswapV3BondingCurveMarket } from "../src/uniswap/UniswapV3BondingCurveMarket.sol";
import { UniswapV3GraduationAdapter } from "../src/uniswap/UniswapV3GraduationAdapter.sol";
import { GraduationMockConversionRouter, GraduationMockERC20 } from "./UniswapGraduation.t.sol";

interface GraduationForkVm {
    function createSelectFork(string calldata urlOrAlias) external returns (uint256 forkId);
    function deal(address account, uint256 newBalance) external;
    function envOr(string calldata name, string calldata defaultValue)
        external
        returns (string memory value);
}

interface IWrappedNative is IERC20 {
    function deposit() external payable;
}

/// @notice No-broadcast rehearsal against the canonical contracts on a local Robinhood mainnet fork.
/// @dev Set ROBINHOOD_MAINNET_RPC_URL to run; the normal offline suite leaves this test inert.
contract RobinhoodUniswapGraduationForkTest {
    GraduationForkVm private constant vm =
        GraduationForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint24 private constant POOL_FEE = 10_000;
    uint160 private constant Q96 = 79_228_162_514_264_337_593_543_950_336;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant UNISWAP_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address private constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;

    receive() external payable { }

    function testCanonicalRobinhoodUniswapGraduationAndFeeHarvest() public {
        string memory rpcUrl = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        require(block.chainid == 4663, "wrong fork chain");

        vm.deal(address(this), 2_000 ether);
        IWrappedNative base = IWrappedNative(WETH);
        base.deposit{ value: 1_000 ether }();

        GraduationMockERC20 reward = new GraduationMockERC20("Mock Stock", "mSTOCK");
        GraduationMockConversionRouter conversionRouter = new GraduationMockConversionRouter();
        RobynLaunchFactory launchFactory = new RobynLaunchFactory(base, conversionRouter, 1, 1 days);
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        (RobynLaunchToken token, FeeBasketVault vault) = launchFactory.createLaunch(
            "Canonical Fork Graduate", "CFORK", SUPPLY, assets, weights
        );

        UniswapV3BondingCurveMarket.CurveConfig memory curve =
            UniswapV3BondingCurveMarket.CurveConfig({
                curveTokenAllocation: 2_000 ether,
                graduationTokenAllocation: 666 ether,
                initialVirtualTokenReserve: 3_000 ether,
                initialVirtualBaseReserve: 333 ether,
                graduationThresholdBase: 666 ether,
                curveFeeBps: 100
            });
        UniswapV3GraduationAdapter.AdapterConfig memory dex =
            UniswapV3GraduationAdapter.AdapterConfig({
                factory: IUniswapV3Factory(UNISWAP_FACTORY),
                positionManager: INonfungiblePositionManager(POSITION_MANAGER),
                swapRouter: ISwapRouter(SWAP_ROUTER),
                quoter: IQuoterV2(QUOTER_V2),
                poolFee: POOL_FEE,
                tickLower: -887_200,
                tickUpper: 887_200,
                initialSqrtPriceX96: Q96,
                minimumUseBps: 9_900,
                maximumPriceDeviationBps: 100
            });
        UniswapV3BondingCurveMarket market =
            new UniswapV3BondingCurveMarket(base, token, vault, address(this), curve, dex);

        address[] memory exclusions = new address[](4);
        exclusions[0] = address(market);
        exclusions[1] = address(market.graduationAdapter());
        exclusions[2] = market.positionLocker();
        exclusions[3] = market.graduatedPool();
        launchFactory.sealLaunchExclusions(token, exclusions);

        token.approve(address(market), 2_666 ether);
        market.seed(2_666 ether, 0);
        base.approve(address(market), type(uint256).max);
        require(market.buy(900 ether, 2_000 ether) == 2_000 ether, "terminal buy");
        require(market.graduated(), "not graduated");

        UniswapV3GraduationAdapter adapter = market.graduationAdapter();
        RewardFeePositionLocker locker = adapter.locker();
        require(adapter.pool() == market.graduatedPool(), "pool mismatch");
        require(locker.positionBound(), "position not bound");
        require(
            INonfungiblePositionManager(POSITION_MANAGER).ownerOf(adapter.positionTokenId())
                == address(locker),
            "position not locked"
        );

        (, uint256 quotedBuy) = market.quoteBuy(1 ether);
        require(quotedBuy != 0, "empty buy quote");
        uint256 bought = market.buy(1 ether, (quotedBuy * 99) / 100);
        require(bought != 0, "pool buy failed");
        token.approve(address(market), bought / 2);
        (, uint256 quotedSell) = market.quoteSell(bought / 2);
        require(quotedSell != 0, "empty sell quote");
        require(market.sell(bought / 2, (quotedSell * 99) / 100) != 0, "pool sell failed");

        uint256 priorVaultFees = vault.totalFeesReceived();
        (uint256 baseFees, uint256 launchFees) = locker.harvest();
        require(baseFees != 0, "no quote fees collected");
        require(launchFees != 0, "no launch fees collected");
        require(vault.totalFeesReceived() == priorVaultFees + baseFees, "fees not routed");
        require(token.balanceOf(address(locker)) >= launchFees, "launch fees not sequestered");
    }
}
