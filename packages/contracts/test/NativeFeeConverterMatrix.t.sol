// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IQuoterV2, ISwapRouter, IUniswapV3Factory } from "../src/uniswap/UniswapV3Interfaces.sol";
import {
    IWrappedNative,
    UniswapV3NativeFeeConverter
} from "../src/uniswap/UniswapV3NativeFeeConverter.sol";

interface NativeConverterVm {
    function deal(address account, uint256 newBalance) external;
    function prank(address caller) external;
}

contract NativeConverterMockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract NativeConverterMockWeth is NativeConverterMockToken {
    constructor() NativeConverterMockToken("Wrapped Ether", "WETH") { }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = payable(msg.sender).call{ value: amount }("");
        require(sent, "native send");
    }

    receive() external payable { }
}

contract NativeConverterMockPool {
    address public immutable token0;
    uint160 public sqrtPriceX96 = 79_228_162_514_264_337_593_543_950_336;
    int24 public currentTick;
    int24 public meanTick;

    constructor(address token0_) {
        token0 = token0_;
    }

    function setTicks(int24 currentTick_, int24 meanTick_) external {
        currentTick = currentTick_;
        meanTick = meanTick_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, currentTick, 0, 1, 1, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory cumulatives, uint160[] memory secondsPerLiquidity)
    {
        cumulatives = new int56[](2);
        secondsPerLiquidity = new uint160[](2);
        cumulatives[0] = 0;
        cumulatives[1] = int56(meanTick) * int56(uint56(secondsAgos[0]));
    }
}

contract NativeConverterMockFactory is IUniswapV3Factory {
    mapping(bytes32 => address) private pools;
    mapping(uint24 => int24) public override feeAmountTickSpacing;

    constructor() {
        feeAmountTickSpacing[10_000] = 200;
    }

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        returns (address pool)
    {
        bytes32 key = _key(tokenA, tokenB, fee);
        require(pools[key] == address(0), "exists");
        address token0 = tokenA < tokenB ? tokenA : tokenB;
        pool = address(new NativeConverterMockPool(token0));
        pools[key] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

    contract NativeConverterMockQuoter is IQuoterV2 {
        uint16 public outputBps = 10_000;

        function setOutputBps(uint16 outputBps_) external {
            outputBps = outputBps_;
        }

        function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
            external
            view
            returns (uint256 amountOut, uint160, uint32, uint256)
        {
            return ((params.amountIn * outputBps) / 10_000, 0, 0, 1);
        }
    }

    contract NativeConverterMockRouter is ISwapRouter {
        using SafeERC20 for IERC20;

        uint16 public outputBps = 10_000;
        uint16 public transferBps = 10_000;

        function setOutputBps(uint16 outputBps_) external {
            outputBps = outputBps_;
        }

        function setTransferBps(uint16 transferBps_) external {
            transferBps = transferBps_;
        }

        function exactInputSingle(ExactInputSingleParams calldata params)
            external
            payable
            returns (uint256 amountOut)
        {
            amountOut = (params.amountIn * outputBps) / 10_000;
            require(amountOut >= params.amountOutMinimum, "slippage");
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
            IERC20(params.tokenOut)
                .safeTransfer(params.recipient, (params.amountIn * transferBps) / 10_000);
        }
    }

    contract NativeFeeConverterMatrixTest {
        NativeConverterVm private constant vm =
            NativeConverterVm(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint24 private constant FEE = 10_000;

        NativeConverterMockToken private base;
        NativeConverterMockToken private launch;
        NativeConverterMockWeth private wrapped;
        NativeConverterMockFactory private factory;
        NativeConverterMockQuoter private quoter;
        NativeConverterMockRouter private router;
        NativeConverterMockPool private basePool;
        NativeConverterMockPool private launchPool;
        UniswapV3NativeFeeConverter private converter;

        receive() external payable { }

        function setUp() external {
            base = new NativeConverterMockToken("Base", "BASE");
            launch = new NativeConverterMockToken("Launch", "LAUNCH");
            wrapped = new NativeConverterMockWeth();
            factory = new NativeConverterMockFactory();
            quoter = new NativeConverterMockQuoter();
            router = new NativeConverterMockRouter();
            basePool =
                NativeConverterMockPool(factory.createPool(address(base), address(wrapped), FEE));
            launchPool =
                NativeConverterMockPool(factory.createPool(address(launch), address(base), FEE));
            converter = new UniswapV3NativeFeeConverter(
                factory,
                router,
                quoter,
                base,
                IWrappedNative(address(wrapped)),
                FEE,
                FEE,
                60,
                500,
                50
            );
            converter.bindFeeRouter(address(this));
            base.mint(address(this), 1_000 ether);
            launch.mint(address(this), 1_000 ether);
            base.mint(address(router), 1_000 ether);
            wrapped.mint(address(router), 1_000 ether);
            vm.deal(address(wrapped), 1_000 ether);
            base.approve(address(converter), type(uint256).max);
            launch.approve(address(converter), type(uint256).max);
        }

        function testBindingAuthorizationAndConstructorValidation() external {
            try converter.bindFeeRouter(address(this)) {
                revert("rebound");
            } catch { }
            UniswapV3NativeFeeConverter fresh = new UniswapV3NativeFeeConverter(
                factory,
                router,
                quoter,
                base,
                IWrappedNative(address(wrapped)),
                FEE,
                FEE,
                60,
                500,
                50
            );
            vm.prank(address(0xBEEF));
            try fresh.bindFeeRouter(address(this)) {
                revert("unauthorized binding");
            } catch { }
            try new UniswapV3NativeFeeConverter(
                factory,
                router,
                quoter,
                base,
                IWrappedNative(address(wrapped)),
                FEE,
                FEE,
                0,
                500,
                50
            ) {
                revert("invalid configuration");
            } catch { }
        }

        function testMinimumSafetyFailureMatrixPreservesFunds() external {
            uint256 baseBefore = base.balanceOf(address(this));
            vm.prank(address(0xBEEF));
            try converter.convertBaseToNative(
                base, 1 ether, 1, block.timestamp, payable(address(this))
            ) {
                revert("unauthorized conversion");
            } catch { }
            try converter.convertBaseToNative(
                base, 1 ether, 1, block.timestamp - 1, payable(address(this))
            ) {
                revert("expired conversion");
            } catch { }
            try converter.minimumSafeOutput(base, launch, 500, 1 ether) {
                revert("missing pool");
            } catch { }
            basePool.setTicks(100, 0);
            try converter.minimumSafeOutput(base, wrapped, FEE, 1 ether) {
                revert("twap deviation");
            } catch { }
            basePool.setTicks(0, 0);
            quoter.setOutputBps(9_000);
            try converter.minimumSafeOutput(base, wrapped, FEE, 1 ether) {
                revert("excessive impact");
            } catch { }
            quoter.setOutputBps(10_000);
            try converter.convertBaseToNative(
                base, 1 ether, 94e16, block.timestamp, payable(address(this))
            ) {
                revert("unsafe minimum");
            } catch { }
            require(base.balanceOf(address(this)) == baseBefore, "base moved");
            require(base.allowance(address(converter), address(router)) == 0, "router allowance");
        }

        function testSuccessfulBaseAndLaunchConversionsClearAllowances() external {
            uint256 nativeBefore = address(this).balance;
            uint256 nativeOut = converter.convertBaseToNative(
                base, 10 ether, 95e17, block.timestamp, payable(address(this))
            );
            require(nativeOut == 10 ether, "native output");
            require(address(this).balance == nativeBefore + 10 ether, "native receipt");
            require(base.allowance(address(converter), address(router)) == 0, "base allowance");

            uint256 baseBefore = base.balanceOf(address(0xCAFE));
            uint256 baseOut = converter.convertLaunchToBase(
                launch, base, 10 ether, 95e17, block.timestamp, address(0xCAFE)
            );
            require(baseOut == 10 ether, "base output");
            require(base.balanceOf(address(0xCAFE)) == baseBefore + 10 ether, "base receipt");
            require(launch.allowance(address(converter), address(router)) == 0, "launch allowance");
        }

        function testInvalidAssetRecipientAmountAndBalanceDeltaFailClosed() external {
            try converter.convertBaseToNative(
                launch, 1 ether, 1, block.timestamp, payable(address(this))
            ) {
                revert("wrong base accepted");
            } catch { }
            try converter.convertBaseToNative(
                base, 1 ether, 1, block.timestamp, payable(address(0))
            ) {
                revert("zero recipient accepted");
            } catch { }
            try converter.convertLaunchToBase(
                base, base, 1 ether, 1, block.timestamp, address(this)
            ) {
                revert("base launch accepted");
            } catch { }
            try converter.minimumSafeOutput(base, wrapped, FEE, 0) {
                revert("zero amount accepted");
            } catch { }

            router.setTransferBps(9_000);
            try converter.convertLaunchToBase(
                launch, base, 10 ether, 95e17, block.timestamp, address(this)
            ) {
                revert("delta mismatch accepted");
            } catch { }
            require(
                launch.allowance(address(converter), address(router)) == 0, "allowance survived"
            );
        }
    }
