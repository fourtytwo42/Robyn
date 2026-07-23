// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRobynConversionRouter } from "../src/FeeBasketVault.sol";
import { IRobynRouteRegistry } from "../src/RobynRouteRegistry.sol";
import { RobynLaunchDeployerV2 } from "../src/RobynLaunchDeployerV2.sol";
import { RobynLaunchFactoryV3 } from "../src/RobynLaunchFactoryV3.sol";
import { TestnetAssetConversionRouter } from "../src/testnet/TestnetAssetConversionRouter.sol";
import { TestnetMockERC20 } from "../src/testnet/TestnetMockERC20.sol";
import { IUniswapV3Factory, IQuoterV2, ISwapRouter } from "../src/uniswap/UniswapV3Interfaces.sol";

contract TestnetRouteCodeStub { }

contract TestnetAssetRoutesTest {
    TestnetMockERC20 private base;
    TestnetMockERC20 private reward;
    TestnetAssetConversionRouter private router;
    RobynLaunchFactoryV3 private factory;

    function setUp() public {
        TestnetRouteCodeStub factoryStub = new TestnetRouteCodeStub();
        TestnetRouteCodeStub swapStub = new TestnetRouteCodeStub();
        TestnetRouteCodeStub quoteStub = new TestnetRouteCodeStub();
        base = new TestnetMockERC20("Robyn Testnet Mock USD", "tmUSD", address(this), 1_000 ether);
        reward = new TestnetMockERC20("Robyn Testnet Mock NVIDIA", "tmNVDA", address(this), 0);
        router = new TestnetAssetConversionRouter(
            address(this),
            IUniswapV3Factory(address(factoryStub)),
            ISwapRouter(address(swapStub)),
            IQuoterV2(address(quoteStub))
        );
        router.setFixedRoute(address(base), address(reward), 0.005 ether);
        base.mint(address(this), 1_000 ether);
        reward.mint(address(router), 100 ether);
        RobynLaunchDeployerV2 deployer = new RobynLaunchDeployerV2();
        factory = new RobynLaunchFactoryV3(
            IERC20(address(base)),
            IRobynConversionRouter(address(router)),
            deployer,
            1 ether,
            1 days
        );
    }

    function testFixedRouteQuotesAndConvertsMeasuredAssets() public {
        IRobynRouteRegistry.RouteStatus memory status =
            router.routeStatus(address(base), address(reward));
        require(status.ready, "route not ready");
        require(status.kind == IRobynRouteRegistry.RouteKind.FixedTestnet, "route kind");
        require(router.quoteExactInput(address(base), address(reward), 200 ether) == 1 ether, "quote");

        base.approve(address(router), 200 ether);
        uint256 output = router.swapExactInput(
            address(base),
            address(reward),
            200 ether,
            0.995 ether,
            address(this),
            block.timestamp + 1
        );
        require(output == 1 ether, "output");
        require(reward.balanceOf(address(this)) == 1 ether, "balance");
    }

    function testFactoryRejectsMissingAndPausedRoutes() public {
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        factory.requireBasketRoutes(assets);

        router.setRoutePaused(address(base), address(reward), true);
        (bool pausedOk,) = address(factory).call(abi.encodeCall(factory.requireBasketRoutes, (assets)));
        require(!pausedOk, "paused route accepted");

        assets[0] = address(0xBEEF);
        (bool missingOk,) = address(factory).call(abi.encodeCall(factory.requireBasketRoutes, (assets)));
        require(!missingOk, "missing route accepted");
    }

    function testFixedRouteRejectsExpiredAndUnavailableSwaps() public {
        base.approve(address(router), 1 ether);
        (bool expiredOk,) = address(router).call(
            abi.encodeCall(
                router.swapExactInput,
                (address(base), address(reward), 1 ether, 1, address(this), 0)
            )
        );
        require(!expiredOk, "expired swap accepted");

        router.setRoutePaused(address(base), address(reward), true);
        (bool pausedOk,) = address(router).call(
            abi.encodeCall(
                router.swapExactInput,
                (address(base), address(reward), 1 ether, 1, address(this), block.timestamp + 1)
            )
        );
        require(!pausedOk, "paused swap accepted");
    }
}
