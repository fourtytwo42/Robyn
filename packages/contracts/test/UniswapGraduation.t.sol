// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { FeeBasketVault, IRobynConversionRouter } from "../src/FeeBasketVault.sol";
import { RobynLaunchFactory } from "../src/RobynLaunchFactory.sol";
import {
    INonfungiblePositionManager,
    IQuoterV2,
    ISwapRouter,
    IUniswapV3Factory
} from "../src/uniswap/UniswapV3Interfaces.sol";
import { RewardFeePositionLocker } from "../src/uniswap/RewardFeePositionLocker.sol";
import { UniswapV3AdapterDeployer } from "../src/uniswap/UniswapV3AdapterDeployer.sol";
import { UniswapV3BondingCurveMarket } from "../src/uniswap/UniswapV3BondingCurveMarket.sol";
import { UniswapV3GraduationAdapter } from "../src/uniswap/UniswapV3GraduationAdapter.sol";
import { UniswapV3MarketDeployer } from "../src/uniswap/UniswapV3MarketDeployer.sol";
import { UniswapV3MarketFactory } from "../src/uniswap/UniswapV3MarketFactory.sol";

contract GraduationMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract GraduationMockConversionRouter is IRobynConversionRouter {
    using SafeERC20 for IERC20;

    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 reportedAmountOut) {
        require(deadline >= block.timestamp, "expired");
        reportedAmountOut = amountIn;
        require(reportedAmountOut >= minimumAmountOut, "slippage");
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(outputToken).safeTransfer(recipient, reportedAmountOut);
    }
}

contract GraduationMockPool {
    uint160 public sqrtPriceX96;

    constructor(uint160 sqrtPriceX96_) {
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function initialize(uint160 sqrtPriceX96_) external {
        require(sqrtPriceX96 == 0, "initialized");
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 1, 1, 0, true);
    }
}

contract GraduationMockFactory is IUniswapV3Factory {
    mapping(bytes32 => address) private _pool;
    mapping(uint24 => int24) public override feeAmountTickSpacing;

    constructor() {
        feeAmountTickSpacing[10_000] = 200;
    }

    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        returns (address pool)
    {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 key = keccak256(abi.encode(token0, token1, fee));
        require(_pool[key] == address(0), "exists");
        pool = address(new GraduationMockPool(0));
        _pool[key] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return _pool[keccak256(abi.encode(token0, token1, fee))];
    }

    function setPool(address token0, address token1, uint24 fee, address pool) external {
        _pool[keccak256(abi.encode(token0, token1, fee))] = pool;
    }
}

    contract GraduationMockPositionManager is ERC721, INonfungiblePositionManager {
        using SafeERC20 for IERC20;

        struct Position {
            address token0;
            address token1;
            uint24 fee;
            int24 tickLower;
            int24 tickUpper;
            uint128 liquidity;
            uint128 owed0;
            uint128 owed1;
        }

        GraduationMockFactory public immutable factory;
        uint16 public useBps = 9_900;
        uint256 public nextTokenId = 1;
        mapping(uint256 => Position) private _position;

        constructor(GraduationMockFactory factory_) ERC721("Mock Uniswap Position", "MUNI-V3") {
            factory = factory_;
        }

        function ownerOf(uint256 tokenId)
            public
            view
            override(ERC721, INonfungiblePositionManager)
            returns (address)
        {
            return super.ownerOf(tokenId);
        }

        function createAndInitializePoolIfNecessary(
            address token0,
            address token1,
            uint24 fee,
            uint160 sqrtPriceX96
        ) external payable returns (address pool) {
            pool = factory.getPool(token0, token1, fee);
            if (pool == address(0)) {
                pool = factory.createPool(token0, token1, fee);
            }
            (uint160 current,,,,,,) = GraduationMockPool(pool).slot0();
            if (current == 0) GraduationMockPool(pool).initialize(sqrtPriceX96);
        }

        function mint(MintParams calldata params)
            external
            payable
            returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
        {
            require(params.deadline >= block.timestamp, "expired");
            amount0 = (params.amount0Desired * useBps) / 10_000;
            amount1 = (params.amount1Desired * useBps) / 10_000;
            require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "minimum");
            address pool = factory.getPool(params.token0, params.token1, params.fee);
            IERC20(params.token0).safeTransferFrom(msg.sender, pool, amount0);
            IERC20(params.token1).safeTransferFrom(msg.sender, pool, amount1);
            tokenId = nextTokenId++;
            liquidity = uint128(amount0 < amount1 ? amount0 : amount1);
            _position[tokenId] = Position({
                token0: params.token0,
                token1: params.token1,
                fee: params.fee,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidity: liquidity,
                owed0: 0,
                owed1: 0
            });
            // Canonical Uniswap v3 mints directly and does not call ERC721Receiver.
            _mint(params.recipient, tokenId);
        }

        function accrue(uint256 tokenId, uint128 amount0, uint128 amount1) external {
            Position storage selected = _position[tokenId];
            IERC20(selected.token0).safeTransferFrom(msg.sender, address(this), amount0);
            IERC20(selected.token1).safeTransferFrom(msg.sender, address(this), amount1);
            selected.owed0 += amount0;
            selected.owed1 += amount1;
        }

        function collect(CollectParams calldata params)
            external
            payable
            returns (uint256 amount0, uint256 amount1)
        {
            require(ownerOf(params.tokenId) == msg.sender, "owner");
            Position storage selected = _position[params.tokenId];
            amount0 = selected.owed0 < params.amount0Max ? selected.owed0 : params.amount0Max;
            amount1 = selected.owed1 < params.amount1Max ? selected.owed1 : params.amount1Max;
            selected.owed0 -= uint128(amount0);
            selected.owed1 -= uint128(amount1);
            if (amount0 != 0) IERC20(selected.token0).safeTransfer(params.recipient, amount0);
            if (amount1 != 0) IERC20(selected.token1).safeTransfer(params.recipient, amount1);
        }

        function positions(uint256 tokenId)
            external
            view
            returns (
                uint96,
                address,
                address token0,
                address token1,
                uint24 fee,
                int24 tickLower,
                int24 tickUpper,
                uint128 liquidity,
                uint256,
                uint256,
                uint128 tokensOwed0,
                uint128 tokensOwed1
            )
        {
            Position storage selected = _position[tokenId];
            return (
                0,
                address(0),
                selected.token0,
                selected.token1,
                selected.fee,
                selected.tickLower,
                selected.tickUpper,
                selected.liquidity,
                0,
                0,
                selected.owed0,
                selected.owed1
            );
        }
    }

    contract GraduationMockSwapRouter is ISwapRouter {
        using SafeERC20 for IERC20;

        function exactInputSingle(ExactInputSingleParams calldata params)
            external
            payable
            returns (uint256 amountOut)
        {
            amountOut = params.amountIn;
            require(amountOut >= params.amountOutMinimum, "slippage");
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
            IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        }
    }

    contract GraduationMockQuoter is IQuoterV2 {
        function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
            external
            pure
            returns (uint256 amountOut, uint160, uint32, uint256)
        {
            return (params.amountIn, 0, 0, 50_000);
        }
    }

    contract GraduationUnauthorizedCaller {
        function initialize(
            UniswapV3GraduationAdapter adapter,
            uint256 tokenAmount,
            uint256 baseAmount
        ) external {
            adapter.initialize(tokenAmount, baseAmount, 1 ether);
        }

        function buyFor(
            UniswapV3GraduationAdapter adapter,
            address recipient,
            uint256 input,
            uint256 minimum
        ) external {
            adapter.buyFor(recipient, input, minimum);
        }

        function harvest(RewardFeePositionLocker locker)
            external
            returns (uint256 baseFees, uint256 launchFees)
        {
            return locker.harvest();
        }
    }

    contract UniswapGraduationTest {
        uint256 private constant SUPPLY = 1_000_000_000 ether;
        uint24 private constant POOL_FEE = 10_000;
        uint160 private constant Q96 = 79_228_162_514_264_337_593_543_950_336;

        GraduationMockERC20 private base;
        GraduationMockERC20 private reward;
        GraduationMockConversionRouter private conversionRouter;
        RobynLaunchFactory private launchFactory;
        RobynLaunchToken private token;
        FeeBasketVault private vault;
        GraduationMockFactory private uniswapFactory;
        GraduationMockPositionManager private positionManager;
        GraduationMockSwapRouter private swapRouter;
        GraduationMockQuoter private quoter;
        UniswapV3GraduationAdapter private adapter;
        RewardFeePositionLocker private locker;

        function setUp() public {
            base = new GraduationMockERC20("Mock USD", "mUSD");
            reward = new GraduationMockERC20("Mock Stock", "mSTOCK");
            conversionRouter = new GraduationMockConversionRouter();
            launchFactory = new RobynLaunchFactory(base, conversionRouter, 1, 1 days);
            address[] memory assets = new address[](1);
            assets[0] = address(reward);
            uint16[] memory weights = new uint16[](1);
            weights[0] = 10_000;
            (token, vault) =
                launchFactory.createLaunch("Uniswap Graduate", "UGRAD", SUPPLY, assets, weights);

            uniswapFactory = new GraduationMockFactory();
            positionManager = new GraduationMockPositionManager(uniswapFactory);
            swapRouter = new GraduationMockSwapRouter();
            quoter = new GraduationMockQuoter();
            UniswapV3GraduationAdapter.AdapterConfig memory adapterConfig =
                UniswapV3GraduationAdapter.AdapterConfig({
                    factory: uniswapFactory,
                    positionManager: positionManager,
                    swapRouter: swapRouter,
                    quoter: quoter,
                    poolFee: POOL_FEE,
                    tickLower: -887_200,
                    tickUpper: 887_200,
                    initialSqrtPriceX96: Q96,
                    minimumUseBps: 9_900,
                    maximumPriceDeviationBps: 100
                });
            adapter = _deployAdapter(adapterConfig);
            adapter.bindMarket(address(this));
            locker = adapter.locker();
            address[] memory exclusions = new address[](2);
            exclusions[0] = address(adapter);
            exclusions[1] = address(locker);
            launchFactory.sealLaunchExclusions(token, exclusions);

            base.mint(address(this), 10_000 ether);
            base.mint(address(swapRouter), 10_000 ether);
            token.transfer(address(swapRouter), 10_000 ether);
            reward.mint(address(conversionRouter), 10_000 ether);
        }

        function _deployAdapter(UniswapV3GraduationAdapter.AdapterConfig memory adapterConfig)
            private
            returns (UniswapV3GraduationAdapter)
        {
            return new UniswapV3GraduationAdapter(base, token, vault, address(this), adapterConfig);
        }

        function testGraduationMintsPositionDirectlyToImmutableLocker() public {
            _initialize();
            require(adapter.initialized(), "adapter not initialized");
            require(locker.positionBound(), "locker not bound");
            require(locker.positionTokenId() == adapter.positionTokenId(), "position mismatch");
            require(positionManager.ownerOf(adapter.positionTokenId()) == address(locker), "owner");
            require(
                adapter.pool() == uniswapFactory.getPool(address(base), address(token), POOL_FEE),
                "pool"
            );
            require(token.balanceOf(address(locker)) == 10 ether, "token residual");
            require(base.balanceOf(address(locker)) == 10 ether, "base residual");
            require(adapter.spotBasePerTokenX18() == 1 ether, "spot price");

            (bool canDecrease,) = address(locker)
                .call(
                    abi.encodeWithSignature(
                        "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))"
                    )
                );
            require(!canDecrease, "principal path exposed");
            (bool canTransfer,) = address(locker)
                .call(
                    abi.encodeWithSignature(
                        "transferFrom(address,address,uint256)", address(locker), address(this), 1
                    )
                );
            require(!canTransfer, "nft transfer path exposed");
        }

        function testPermissionlessHarvestFundsBasketAndLocksLaunchFees() public {
            _initialize();
            uint256 tokenId = adapter.positionTokenId();
            (,, address token0,,,,,,,,,) = positionManager.positions(tokenId);
            uint128 baseFee = 12 ether;
            uint128 launchFee = 7 ether;
            uint128 amount0 = token0 == address(base) ? baseFee : launchFee;
            uint128 amount1 = token0 == address(base) ? launchFee : baseFee;
            base.approve(address(positionManager), baseFee);
            token.approve(address(positionManager), launchFee);
            positionManager.accrue(tokenId, amount0, amount1);

            GraduationUnauthorizedCaller publicCaller = new GraduationUnauthorizedCaller();
            (uint256 routed, uint256 locked) = publicCaller.harvest(locker);
            require(routed == baseFee, "base fees");
            require(locked == launchFee, "launch fees");
            require(vault.totalFeesReceived() == baseFee, "vault fees");
            require(locker.cumulativeBaseFees() == baseFee, "base cumulative");
            require(locker.cumulativeLaunchTokenFeesLocked() == launchFee, "launch cumulative");
            require(token.balanceOf(address(locker)) == 10 ether + launchFee, "launch locked");
            require(base.balanceOf(address(locker)) == 10 ether, "principal residual moved");

            try locker.harvest() {
                revert("empty harvest accepted");
            } catch { }
        }

        function testMarketBoundAdapterRoutesPostGraduationTrades() public {
            _initialize();
            (uint256 nominalBuyFee, uint256 quotedBuy) = adapter.quoteBuy(100 ether);
            require(nominalBuyFee == 1 ether && quotedBuy == 100 ether, "buy quote");
            base.approve(address(adapter), 100 ether);
            uint256 tokenBefore = token.balanceOf(address(this));
            uint256 bought = adapter.buyFor(address(this), 100 ether, 99 ether);
            require(bought == 100 ether, "buy output");
            require(token.balanceOf(address(this)) == tokenBefore + 100 ether, "buy recipient");

            token.approve(address(adapter), 50 ether);
            (uint256 nominalSellFee, uint256 quotedSell) = adapter.quoteSell(50 ether);
            require(nominalSellFee == 0.5 ether && quotedSell == 50 ether, "sell quote");
            uint256 baseBefore = base.balanceOf(address(this));
            uint256 sold = adapter.sellFor(address(this), 50 ether, 49 ether);
            require(sold == 50 ether, "sell output");
            require(base.balanceOf(address(this)) == baseBefore + 50 ether, "sell recipient");
        }

        function testUnauthorizedCallerCannotInitializeOrTrade() public {
            GraduationUnauthorizedCaller caller = new GraduationUnauthorizedCaller();
            try caller.initialize(adapter, 1 ether, 1 ether) {
                revert("unauthorized initialize");
            } catch { }
            try caller.buyFor(adapter, address(this), 1 ether, 1) {
                revert("unauthorized trade");
            } catch { }
        }

        function testGraduationCannotRepeat() public {
            _initialize();
            try adapter.initialize(1 ether, 1 ether, 1 ether) {
                revert("repeat initialization");
            } catch { }
        }

        function testGraduationPriceMismatchRevertsWithoutMovingLiquidity() public {
            uint256 tokenBefore = token.balanceOf(address(this));
            uint256 baseBefore = base.balanceOf(address(this));
            token.approve(address(adapter), 1_000 ether);
            base.approve(address(adapter), 1_000 ether);
            try adapter.initialize(1_000 ether, 1_000 ether, 2 ether) {
                revert("price mismatch accepted");
            } catch { }
            require(!adapter.initialized(), "adapter initialized");
            require(adapter.positionTokenId() == 0, "position minted");
            require(token.balanceOf(address(this)) == tokenBefore, "token moved");
            require(base.balanceOf(address(this)) == baseBefore, "base moved");
        }

        function _initialize() private {
            token.approve(address(adapter), 1_000 ether);
            base.approve(address(adapter), 1_000 ether);
            adapter.initialize(1_000 ether, 1_000 ether, 1 ether);
        }
    }

    contract UniswapBondingCurveMarketTest {
        uint256 private constant SUPPLY = 1_000_000_000 ether;
        uint24 private constant POOL_FEE = 10_000;
        uint160 private constant Q96 = 79_228_162_514_264_337_593_543_950_336;

        GraduationMockERC20 private base;
        GraduationMockERC20 private reward;
        GraduationMockConversionRouter private conversionRouter;
        RobynLaunchFactory private launchFactory;
        RobynLaunchToken private token;
        FeeBasketVault private vault;
        GraduationMockFactory private uniswapFactory;
        GraduationMockPositionManager private positionManager;
        GraduationMockSwapRouter private swapRouter;
        GraduationMockQuoter private quoter;
        UniswapV3BondingCurveMarket private market;

        function setUp() public {
            base = new GraduationMockERC20("Mock USD", "mUSD");
            reward = new GraduationMockERC20("Mock Stock", "mSTOCK");
            conversionRouter = new GraduationMockConversionRouter();
            launchFactory = new RobynLaunchFactory(base, conversionRouter, 1, 1 days);
            address[] memory assets = new address[](1);
            assets[0] = address(reward);
            uint16[] memory weights = new uint16[](1);
            weights[0] = 10_000;
            (token, vault) =
                launchFactory.createLaunch("Curve to Uniswap", "CURVEUNI", SUPPLY, assets, weights);

            uniswapFactory = new GraduationMockFactory();
            positionManager = new GraduationMockPositionManager(uniswapFactory);
            swapRouter = new GraduationMockSwapRouter();
            quoter = new GraduationMockQuoter();
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
                    factory: uniswapFactory,
                    positionManager: positionManager,
                    swapRouter: swapRouter,
                    quoter: quoter,
                    poolFee: POOL_FEE,
                    tickLower: -887_200,
                    tickUpper: 887_200,
                    initialSqrtPriceX96: Q96,
                    minimumUseBps: 9_900,
                    maximumPriceDeviationBps: 100
                });
            UniswapV3GraduationAdapter marketAdapter =
                new UniswapV3GraduationAdapter(base, token, vault, address(this), dex);
            market = new UniswapV3BondingCurveMarket(
                base, token, vault, address(this), curve, marketAdapter
            );
            marketAdapter.bindMarket(address(market));

            address[] memory exclusions = new address[](4);
            exclusions[0] = address(market);
            exclusions[1] = address(market.graduationAdapter());
            exclusions[2] = market.positionLocker();
            exclusions[3] = market.graduatedPool();
            launchFactory.sealLaunchExclusions(token, exclusions);

            token.approve(address(market), 2_666 ether);
            market.seed(2_666 ether, 0);
            base.mint(address(this), 10_000 ether);
            base.mint(address(swapRouter), 10_000 ether);
            token.transfer(address(swapRouter), 10_000 ether);
            reward.mint(address(conversionRouter), 10_000 ether);
        }









        function testTerminalBuyAtomicallyGraduatesAndSameMarketKeepsTrading() public {
            uint256 baseBefore = base.balanceOf(address(this));
            base.approve(address(market), 2_000 ether);
            uint256 boughtOnCurve = market.buy(2_000 ether, 2_000 ether);
            require(boughtOnCurve == 2_000 ether, "terminal output");
            require(base.balanceOf(address(this)) > baseBefore - 2_000 ether, "refund missing");
            require(market.graduated(), "not graduated");
            require(market.graduationProgressBps() == 10_000, "progress");

            UniswapV3GraduationAdapter adapter = market.graduationAdapter();
            RewardFeePositionLocker locker = adapter.locker();
            require(adapter.initialized(), "adapter");
            require(locker.positionBound(), "locker");
            require(
                positionManager.ownerOf(adapter.positionTokenId()) == address(locker), "nft owner"
            );
            require(adapter.pool() == market.graduatedPool(), "pool binding");
            require(token.isExcluded(adapter.pool()), "pool rewards exclusion");
            require(token.isExcluded(address(locker)), "locker rewards exclusion");

            (uint256 nominalBuyFee, uint256 quotedBuy) = market.quoteBuy(100 ether);
            require(nominalBuyFee == 1 ether && quotedBuy == 100 ether, "graduated buy quote");
            base.approve(address(market), 100 ether);
            uint256 tokenBefore = token.balanceOf(address(this));
            require(market.buy(100 ether, 99 ether) == 100 ether, "graduated buy");
            require(token.balanceOf(address(this)) == tokenBefore + 100 ether, "buy balance");

            (uint256 nominalSellFee, uint256 quotedSell) = market.quoteSell(50 ether);
            require(nominalSellFee == 0.5 ether && quotedSell == 50 ether, "graduated sell quote");
            token.approve(address(market), 50 ether);
            uint256 postGraduationBase = base.balanceOf(address(this));
            require(market.sell(50 ether, 49 ether) == 50 ether, "graduated sell");
            require(base.balanceOf(address(this)) == postGraduationBase + 50 ether, "sell balance");
        }

        function testHarvestedPoolBaseFeesFeedExistingBasketVault() public {
            base.approve(address(market), 2_000 ether);
            market.buy(2_000 ether, 2_000 ether);
            UniswapV3GraduationAdapter adapter = market.graduationAdapter();
            RewardFeePositionLocker locker = adapter.locker();
            uint256 tokenId = adapter.positionTokenId();
            (,, address token0,,,,,,,,,) = positionManager.positions(tokenId);
            uint128 baseFee = 9 ether;
            uint128 launchFee = 4 ether;
            base.approve(address(positionManager), baseFee);
            token.approve(address(positionManager), launchFee);
            positionManager.accrue(
                tokenId,
                token0 == address(base) ? baseFee : launchFee,
                token0 == address(base) ? launchFee : baseFee
            );

            uint256 priorFees = vault.totalFeesReceived();
            (uint256 routed, uint256 locked) = locker.harvest();
            require(routed == baseFee && locked == launchFee, "harvest amounts");
            require(vault.totalFeesReceived() == priorFees + baseFee, "vault routing");
            require(token.balanceOf(address(locker)) >= launchFee, "launch fees not locked");
        }
    }
