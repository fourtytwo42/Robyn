// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { FeeBasketVault, IRobynConversionRouter } from "../src/FeeBasketVault.sol";
import { RobynLaunchFactory } from "../src/RobynLaunchFactory.sol";
import { DevnetFixedPriceMarket } from "../src/devnet/DevnetFixedPriceMarket.sol";
import { DevnetBondingCurveMarket } from "../src/devnet/DevnetBondingCurveMarket.sol";
import { DevnetLockedLiquidityPool } from "../src/devnet/DevnetLockedLiquidityPool.sol";
import { DevnetMarketFactory } from "../src/devnet/DevnetMarketFactory.sol";
import { DevnetMockERC20 } from "../src/devnet/DevnetMockERC20.sol";

contract ProtocolMockERC20 is ERC20 {
    uint16 public feeBps;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeBps(uint16 feeBps_) external {
        require(feeBps_ <= 2_000, "fee");
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (feeBps != 0 && from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
            return;
        }
        super._update(from, to, value);
    }
}

contract ReentrantRewardToken is ERC20 {
    RobynLaunchToken public target;
    uint256 public assetIndex;
    bool public armed;
    bool public callbackRejected;

    constructor() ERC20("Reentrant Reward", "REENT") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(RobynLaunchToken target_, uint256 assetIndex_) external {
        target = target_;
        assetIndex = assetIndex_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed && from == address(target) && to != address(0)) {
            armed = false;
            (bool succeeded,) =
                address(target).call(abi.encodeCall(RobynLaunchToken.claim, assetIndex));
            callbackRejected = !succeeded;
        }
        super._update(from, to, value);
    }
}

contract ProtocolMockRouter is IRobynConversionRouter {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public rate;
    mapping(address => bool) public shouldFail;

    function setRate(address outputToken, uint256 rate_) external {
        rate[outputToken] = rate_;
    }

    function setFailure(address outputToken, bool failed) external {
        shouldFail[outputToken] = failed;
    }

    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 reportedAmountOut) {
        require(!shouldFail[outputToken], "route failed");
        // forge-lint: disable-next-line(block-timestamp)
        require(deadline >= block.timestamp, "expired");
        reportedAmountOut = (amountIn * rate[outputToken]) / 1e18;
        require(reportedAmountOut >= minimumAmountOut, "slippage");
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(outputToken).safeTransfer(recipient, reportedAmountOut);
    }
}

contract ReentrantProtocolRouter is IRobynConversionRouter {
    using SafeERC20 for IERC20;

    FeeBasketVault public target;
    bool public convertCallbackRejected;
    bool public recordCallbackRejected;

    function setTarget(FeeBasketVault target_) external {
        target = target_;
    }

    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 reportedAmountOut) {
        (bool convertSucceeded,) = address(target)
            .call(abi.encodeCall(FeeBasketVault.convertLeg, (0, 1, 1, deadline)));
        convertCallbackRejected = !convertSucceeded;
        (bool recordSucceeded,) =
            address(target).call(abi.encodeCall(FeeBasketVault.recordFees, (1)));
        recordCallbackRejected = !recordSucceeded;
        require(convertCallbackRejected && recordCallbackRejected, "reentry accepted");

        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        reportedAmountOut = amountIn;
        require(reportedAmountOut >= minimumAmountOut, "slippage");
        IERC20(outputToken).safeTransfer(recipient, reportedAmountOut);
    }
}

contract ProtocolActor {
    function transferToken(RobynLaunchToken token, address to, uint256 amount) external {
        require(token.transfer(to, amount), "transfer");
    }

    function claim(RobynLaunchToken token, uint256 index) external returns (uint256) {
        return token.claim(index);
    }

    function claimAll(RobynLaunchToken token) external returns (uint256) {
        return token.claimAll();
    }

    function approveToken(IERC20 asset, address spender, uint256 amount) external {
        asset.approve(spender, amount);
    }

    function buy(DevnetFixedPriceMarket market, uint256 amount, uint256 minimumOutput)
        external
        returns (uint256)
    {
        return market.buy(amount, minimumOutput);
    }

    function sell(DevnetFixedPriceMarket market, uint256 amount, uint256 minimumOutput)
        external
        returns (uint256)
    {
        return market.sell(amount, minimumOutput);
    }
}

contract RobynProtocolTest {
    uint256 private constant CURVE_ALLOCATION = 800_000_000 ether;
    uint256 private constant GRADUATION_ALLOCATION = 200_000_000 ether;
    uint256 private constant INITIAL_VIRTUAL_TOKEN = 1_066_666_666_666_666_666_666_666_666;
    uint256 private constant INITIAL_VIRTUAL_BASE = 2_166_666_666_666_666_666_667;
    uint256 private constant GRADUATION_TARGET = 6_500 ether;
    uint256 private constant SUPPLY = 1_000_000_000 ether;

    ProtocolMockERC20 private base;
    ProtocolMockERC20[3] private rewards;
    ProtocolMockRouter private router;
    RobynLaunchFactory private factory;
    RobynLaunchToken private token;
    FeeBasketVault private vault;
    ProtocolActor private buyer;

    function setUp() public {
        base = new ProtocolMockERC20("Mock USD", "mUSD");
        rewards[0] = new ProtocolMockERC20("Mock NVIDIA", "mNVDA");
        rewards[1] = new ProtocolMockERC20("Mock S&P 500", "mSPY");
        rewards[2] = new ProtocolMockERC20("Mock Ether", "mETH");
        router = new ProtocolMockRouter();
        factory = new RobynLaunchFactory(base, router, 1, 1 days);
        (token, vault) =
            factory.createLaunch("Robyn Community", "ROBYN", SUPPLY, _assets(), _weights());
        factory.sealLaunchExclusions(token, new address[](0));
        buyer = new ProtocolActor();

        for (uint256 i; i < 3; ++i) {
            router.setRate(address(rewards[i]), (i + 1) * 1e18);
            rewards[i].mint(address(router), 10_000_000 ether);
        }
        base.mint(address(this), 10_000_000 ether);
        base.approve(address(vault), type(uint256).max);
    }

    function testFactoryPublishesImmutableLaunchComponents() public view {
        require(factory.chainId() == block.chainid, "chain");
        require(factory.launchCount() == 1, "count");
        require(factory.launchTokenById(1) == address(token), "token registry");
        require(factory.vaultByToken(address(token)) == address(vault), "vault registry");
        require(token.controller() == address(vault), "controller");
        require(address(vault.launchToken()) == address(token), "binding");
        require(token.rewardAssetCount() == 3, "asset count");
        require(token.rewardAsset(0) == address(rewards[0]), "asset 0");
        require(vault.leg(0).weightBps == 4_000, "weight 0");
        require(vault.leg(1).weightBps == 4_000, "weight 1");
        require(vault.leg(2).weightBps == 2_000, "weight 2");
    }

    function testFeeOnTransferAllocationUsesMeasuredDelta() public {
        base.setFeeBps(1_000);
        vault.recordFees(1_000);

        require(vault.totalFeesReceived() == 900, "measured receipt");
        require(vault.totalPendingBase() == 900, "pending");
        require(vault.leg(0).pendingBase == 360, "leg 0");
        require(vault.leg(1).pendingBase == 360, "leg 1");
        require(vault.leg(2).pendingBase == 180, "leg 2");
        require(base.balanceOf(address(vault)) == 900, "vault balance");
    }

    function testRewardDepositUsesSecondMeasuredDelta() public {
        rewards[0].setFeeBps(1_000);
        vault.recordFees(1_000);

        uint256 actualOutput = vault.convertLeg(0, 400, 350, block.timestamp);

        require(actualOutput == 360, "vault output delta");
        require(vault.leg(0).rewardsDeposited == 324, "token deposit delta");
        require(token.totalRewardsReceived(0) == 324, "received accounting");
        require(rewards[0].balanceOf(address(token)) == 324, "reward solvency");
        uint256 claimable = token.withdrawableRewardOf(address(this), 0);
        require(claimable >= 323 && claimable <= 324, "holder reward");
    }

    function testBuyerCannotEarnPrePurchaseRewardAndSellerKeepsIt() public {
        vault.recordFees(1_000);
        vault.convertLeg(0, 400, 400, block.timestamp);
        uint256 sellerFirst = token.withdrawableRewardOf(address(this), 0);
        require(sellerFirst >= 399 && sellerFirst <= 400, "initial seller reward");

        require(token.transfer(address(buyer), SUPPLY / 2), "transfer");
        require(token.withdrawableRewardOf(address(buyer), 0) == 0, "buyer prior reward");
        require(token.claim(0) == sellerFirst, "seller retained reward");

        vault.recordFees(1_000);
        vault.convertLeg(0, 400, 400, block.timestamp);
        uint256 sellerSecond = token.withdrawableRewardOf(address(this), 0);
        uint256 buyerSecond = token.withdrawableRewardOf(address(buyer), 0);
        require(sellerSecond >= 199 && sellerSecond <= 200, "seller next reward");
        require(buyerSecond >= 199 && buyerSecond <= 200, "buyer next reward");
        require(token.claim(0) == sellerSecond, "seller claim");
        require(buyer.claim(token, 0) == buyerSecond, "buyer claim");
        uint256 claimed = token.totalRewardsClaimed(0);
        require(claimed <= token.totalRewardsReceived(0), "insolvent");
        require(token.totalRewardsReceived(0) - claimed <= 3, "rounding bound");
    }

    function testMaliciousRewardTokenCannotReenterClaim() public {
        ReentrantRewardToken maliciousReward = new ReentrantRewardToken();
        address[] memory assets = new address[](1);
        assets[0] = address(maliciousReward);
        RobynLaunchToken guardedToken =
            new RobynLaunchToken("Guarded", "GRD", address(this), SUPPLY, address(this), assets);
        guardedToken.sealExclusions(new address[](0));
        maliciousReward.mint(address(this), 1_000);
        maliciousReward.approve(address(guardedToken), 1_000);
        guardedToken.distributeReward(0, 1_000);
        maliciousReward.arm(guardedToken, 0);

        uint256 claimed = guardedToken.claim(0);

        require(maliciousReward.callbackRejected(), "claim callback entered");
        require(claimed >= 999 && claimed <= 1_000, "outer claim");
        require(guardedToken.totalRewardsClaimed(0) == claimed, "claimed accounting");
        require(maliciousReward.balanceOf(address(guardedToken)) == 1_000 - claimed, "solvency");
    }

    function testMaliciousRouterCallbacksCannotReenterVault() public {
        ProtocolMockERC20 attackBase = new ProtocolMockERC20("Attack Base", "ABASE");
        ProtocolMockERC20 attackReward = new ProtocolMockERC20("Attack Reward", "ARWD");
        ReentrantProtocolRouter attackRouter = new ReentrantProtocolRouter();
        RobynLaunchFactory attackFactory =
            new RobynLaunchFactory(attackBase, attackRouter, 1, 1 days);
        address[] memory assets = new address[](1);
        assets[0] = address(attackReward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        (RobynLaunchToken attackToken, FeeBasketVault attackVault) =
            attackFactory.createLaunch("Attack Launch", "ATK", SUPPLY, assets, weights);
        attackFactory.sealLaunchExclusions(attackToken, new address[](0));
        attackRouter.setTarget(attackVault);
        attackBase.mint(address(this), 1_000);
        attackReward.mint(address(attackRouter), 1_000);
        attackBase.approve(address(attackVault), 1_000);
        attackVault.recordFees(1_000);

        uint256 output = attackVault.convertLeg(0, 1_000, 1_000, block.timestamp);

        require(attackRouter.convertCallbackRejected(), "convert callback entered");
        require(attackRouter.recordCallbackRejected(), "record callback entered");
        require(output == 1_000, "outer output");
        require(attackVault.totalPendingBase() == 0, "pending");
        require(attackVault.totalBaseConsumed() == 1_000, "consumed");
        require(attackVault.totalFeesReceived() == 1_000, "received");
        require(attackToken.totalRewardsReceived(0) == 1_000, "reward");
    }

    function testRouteFailureRetainsPrincipalAndDoesNotBlockOtherLeg() public {
        vault.recordFees(1_000);
        router.setFailure(address(rewards[1]), true);

        try vault.convertLeg(1, 400, 800, block.timestamp) {
            revert("failed route accepted");
        } catch { }

        require(vault.leg(1).pendingBase == 400, "failed pending changed");
        require(vault.leg(1).consumedBase == 0, "failed consumed");
        require(vault.totalBaseConsumed() == 0, "failed total consumed");

        uint256 actual = vault.convertLeg(0, 400, 400, block.timestamp);
        require(actual == 400, "valid output");
        require(vault.leg(0).pendingBase == 0, "valid pending");
        require(vault.leg(1).pendingBase == 400, "other pending changed");
        require(vault.leg(2).pendingBase == 200, "third pending changed");
        require(token.totalRewardsReceived(0) == 400, "reward not deposited");
    }

    function testStaleAndZeroMinimumConversionsPreservePrincipal() public {
        vault.recordFees(1_000);

        try vault.convertLeg(0, 400, 0, block.timestamp) {
            revert("zero minimum accepted");
        } catch { }
        try vault.convertLeg(0, 400, 400, block.timestamp - 1) {
            revert("stale quote accepted");
        } catch { }

        require(vault.leg(0).pendingBase == 400, "pending changed");
        require(base.balanceOf(address(vault)) == 1_000, "principal changed");
    }

    function testUnauthorizedRewardDepositAndRebindingFail() public {
        rewards[0].mint(address(this), 100);
        rewards[0].approve(address(token), 100);

        try token.distributeReward(0, 100) {
            revert("unauthorized deposit");
        } catch { }
        try vault.bindLaunchToken(token) {
            revert("rebind accepted");
        } catch { }
    }

    function testRejectsDuplicateBasketAssets() public {
        address[] memory assets = _assets();
        assets[2] = assets[0];
        try factory.createLaunch("Bad", "BAD", SUPPLY, assets, _weights()) {
            revert("duplicate accepted");
        } catch { }
    }

    function testDistributionCannotStartBeforeExclusionsAreSealed() public {
        (RobynLaunchToken unsealedToken, FeeBasketVault unsealedVault) =
            factory.createLaunch("Unsealed", "OPEN", SUPPLY, _assets(), _weights());
        base.approve(address(unsealedVault), type(uint256).max);
        unsealedVault.recordFees(1_000);

        try unsealedVault.convertLeg(0, 400, 400, block.timestamp) {
            revert("unsealed distribution");
        } catch { }
        require(unsealedVault.leg(0).pendingBase == 400, "unsealed principal");

        factory.sealLaunchExclusions(unsealedToken, new address[](0));
        // forge-lint: disable-next-line(block-timestamp)
        require(unsealedVault.convertLeg(0, 400, 400, block.timestamp) == 400, "sealed conversion");
    }

    function testExclusionListIsBounded() public {
        (RobynLaunchToken boundedToken,) =
            factory.createLaunch("Bounded", "BND", SUPPLY, _assets(), _weights());
        address[] memory exclusions = new address[](17);
        for (uint256 i; i < exclusions.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            exclusions[i] = address(uint160(i + 1));
        }

        try factory.sealLaunchExclusions(boundedToken, exclusions) {
            revert("oversized exclusion list accepted");
        } catch { }
        require(!boundedToken.exclusionsSealed(), "failed seal changed state");
    }

    function testExcludedInventoryDoesNotDiluteHolderRewards() public {
        (RobynLaunchToken excludedToken, FeeBasketVault excludedVault) =
            factory.createLaunch("Excluded", "EXCL", SUPPLY, _assets(), _weights());
        ProtocolActor inventory = new ProtocolActor();
        require(excludedToken.transfer(address(inventory), SUPPLY / 2), "inventory transfer");
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(inventory);
        factory.sealLaunchExclusions(excludedToken, exclusions);

        require(excludedToken.eligibleSupply() == SUPPLY / 2, "eligible supply");
        require(excludedToken.isExcluded(address(inventory)), "excluded");
        base.approve(address(excludedVault), type(uint256).max);
        excludedVault.recordFees(1_000);
        excludedVault.convertLeg(0, 400, 400, block.timestamp);

        uint256 creatorReward = excludedToken.withdrawableRewardOf(address(this), 0);
        require(creatorReward >= 399 && creatorReward <= 400, "creator diluted");
        require(excludedToken.withdrawableRewardOf(address(inventory), 0) == 0, "inventory reward");
        try factory.sealLaunchExclusions(excludedToken, exclusions) {
            revert("reseal accepted");
        } catch { }
    }

    function testDevnetBaseFaucetClaimsOncePerAddress() public {
        DevnetMockERC20 faucetToken =
            new DevnetMockERC20("Faucet", "FAU", address(this), 10_000 ether);
        ProtocolActor recipient = new ProtocolActor();
        faucetToken.claimFaucet(address(recipient));
        require(faucetToken.balanceOf(address(recipient)) == 10_000 ether, "faucet balance");
        try faucetToken.claimFaucet(address(recipient)) {
            revert("duplicate faucet");
        } catch { }
    }

    function testDevnetMarketBuySellFeeConversionAndHolderClaim() public {
        uint256 marketSupply = 1_000 ether;
        (RobynLaunchToken marketToken, FeeBasketVault marketVault) =
            factory.createLaunch("Market", "MKT", marketSupply, _assets(), _weights());
        DevnetFixedPriceMarket market =
            new DevnetFixedPriceMarket(base, marketToken, marketVault, address(this), 1e18, 100);
        marketToken.approve(address(market), 500 ether);
        base.approve(address(market), 1_000 ether);
        market.seed(500 ether, 1_000 ether);
        address[] memory exclusions = new address[](1);
        exclusions[0] = address(market);
        factory.sealLaunchExclusions(marketToken, exclusions);

        ProtocolActor trader = new ProtocolActor();
        base.mint(address(trader), 100 ether);
        trader.approveToken(base, address(market), type(uint256).max);
        uint256 bought = trader.buy(market, 100 ether, 99 ether);
        require(bought == 99 ether, "buy output");
        require(marketToken.balanceOf(address(trader)) == 99 ether, "trader balance");
        require(marketVault.totalFeesReceived() == 1 ether, "buy fee");
        require(marketVault.leg(0).pendingBase == 0.4 ether, "buy leg 0");

        marketVault.convertLeg(0, 0.4 ether, 0.4 ether, block.timestamp);
        uint256 claimable = marketToken.withdrawableRewardOf(address(trader), 0);
        require(claimable > 0, "trader claimable");
        require(trader.claim(marketToken, 0) == claimable, "trader claim");
        require(marketToken.withdrawableRewardOf(address(market), 0) == 0, "market reward");

        trader.approveToken(marketToken, address(market), type(uint256).max);
        uint256 soldFor = trader.sell(market, 9 ether, 8.91 ether);
        require(soldFor == 8.91 ether, "sell output");
        require(marketVault.totalFeesReceived() == 1.09 ether, "total fees");
        require(base.balanceOf(address(trader)) == 8.91 ether, "trader base");
        require(marketToken.balanceOf(address(trader)) == 90 ether, "trader token");
    }

    function testDevnetMarketFactoryCreatesOneCreatorOwnedMarket() public {
        (RobynLaunchToken marketToken,) =
            factory.createLaunch("Factory Market", "FMKT", SUPPLY, _assets(), _weights());
        DevnetMarketFactory marketFactory = new DevnetMarketFactory(
            base,
            factory,
            CURVE_ALLOCATION,
            GRADUATION_ALLOCATION,
            INITIAL_VIRTUAL_TOKEN,
            INITIAL_VIRTUAL_BASE,
            GRADUATION_TARGET,
            100
        );
        DevnetBondingCurveMarket market = marketFactory.createMarket(marketToken);

        require(marketFactory.marketByToken(address(marketToken)) == address(market), "registry");
        require(market.marketOwner() == address(this), "market owner");
        require(address(market.launchToken()) == address(marketToken), "market token");
        try marketFactory.createMarket(marketToken) {
            revert("duplicate market accepted");
        } catch { }
    }

    function testDevnetBondingCurveGraduatesAndKeepsBasketFees() public {
        (RobynLaunchToken marketToken, FeeBasketVault marketVault) =
            factory.createLaunch("Curve Market", "CRVE", SUPPLY, _assets(), _weights());
        DevnetMarketFactory marketFactory = new DevnetMarketFactory(
            base,
            factory,
            CURVE_ALLOCATION,
            GRADUATION_ALLOCATION,
            INITIAL_VIRTUAL_TOKEN,
            INITIAL_VIRTUAL_BASE,
            GRADUATION_TARGET,
            100
        );
        DevnetBondingCurveMarket market = marketFactory.createMarket(marketToken);
        DevnetLockedLiquidityPool pool = market.graduatedPool();

        marketToken.approve(address(market), SUPPLY);
        market.seed(SUPPLY, 0);
        address[] memory exclusions = new address[](2);
        exclusions[0] = address(market);
        exclusions[1] = address(pool);
        factory.sealLaunchExclusions(marketToken, exclusions);

        base.mint(address(this), 12_000 ether);
        base.approve(address(market), type(uint256).max);
        uint256 firstBuy = market.buy(1_000 ether, 1);
        require(firstBuy > 0, "curve buy");
        require(market.graduationProgressBps() > 0, "curve progress");
        require(!market.graduated(), "graduated early");

        marketToken.approve(address(market), firstBuy / 10);
        uint256 sellOutput = market.sell(firstBuy / 10, 1);
        require(sellOutput > 0, "curve sell");

        uint256 baseBeforeFinalBuy = base.balanceOf(address(this));
        market.buy(10_000 ether, 1);
        require(base.balanceOf(address(this)) > baseBeforeFinalBuy - 10_000 ether, "no refund");
        require(market.graduated(), "not graduated");
        require(market.graduationProgressBps() == 10_000, "graduation progress");
        require(pool.initialized(), "pool not initialized");
        require(marketToken.balanceOf(address(pool)) == GRADUATION_ALLOCATION, "locked tokens");
        require(base.balanceOf(address(pool)) >= GRADUATION_TARGET - 2, "locked base");
        require(marketVault.totalFeesReceived() > 0, "basket fees");
        require(marketToken.withdrawableRewardOf(address(pool), 0) == 0, "pool reward");

        uint256 postBuy = market.buy(100 ether, 1);
        marketToken.approve(address(market), postBuy);
        require(market.sell(postBuy, 1) > 0, "post graduation sell");

        try pool.initialize() {
            revert("pool reinitialized");
        } catch { }
        try pool.buyFor(address(this), 1 ether, 1) {
            revert("direct pool buy accepted");
        } catch { }
        require(market.graduated(), "graduation reversed");
    }

    function testClaimAllPaysAllAvailableAssets() public {
        vault.recordFees(1_000);
        vault.convertLeg(0, 400, 400, block.timestamp);
        vault.convertLeg(1, 400, 800, block.timestamp);
        vault.convertLeg(2, 200, 600, block.timestamp);

        uint256 expected0 = token.withdrawableRewardOf(address(this), 0);
        uint256 expected1 = token.withdrawableRewardOf(address(this), 1);
        uint256 expected2 = token.withdrawableRewardOf(address(this), 2);
        uint256 claimed = token.claimAll();
        require(claimed == expected0 + expected1 + expected2, "claim all");
        require(claimed >= 1_797 && claimed <= 1_800, "claim dust bound");
        require(rewards[0].balanceOf(address(this)) == expected0, "reward 0");
        require(rewards[1].balanceOf(address(this)) == expected1, "reward 1");
        require(rewards[2].balanceOf(address(this)) == expected2, "reward 2");
    }

    function testFiveAssetReferenceAccounting() public {
        address[] memory assets = new address[](5);
        ProtocolMockERC20[] memory fiveRewards = new ProtocolMockERC20[](5);
        for (uint256 i; i < 5; ++i) {
            fiveRewards[i] = new ProtocolMockERC20("Reference", "REF");
            assets[i] = address(fiveRewards[i]);
        }
        RobynLaunchToken five =
            new RobynLaunchToken("Five", "FIVE", address(this), SUPPLY, address(this), assets);
        five.sealExclusions(new address[](0));
        for (uint256 i; i < 5; ++i) {
            fiveRewards[i].mint(address(this), 100);
            fiveRewards[i].approve(address(five), 100);
            five.distributeReward(i, 100);
        }
        uint256 claimed = five.claimAll();
        require(claimed >= 495 && claimed <= 500, "five asset claim");
    }

    function testFuzzPostDistributionBuyerGetsNoPriorReward(uint96 rawTransfer) public {
        uint256 transferAmount = (uint256(rawTransfer) % (SUPPLY - 1)) + 1;
        vault.recordFees(1_000);
        vault.convertLeg(0, 400, 400, block.timestamp);
        require(token.transfer(address(buyer), transferAmount), "transfer");

        require(token.withdrawableRewardOf(address(buyer), 0) == 0, "buyer prior entitlement");
        uint256 sellerReward = token.withdrawableRewardOf(address(this), 0);
        require(sellerReward >= 399 && sellerReward <= 400, "seller lost entitlement");
    }

    function _assets() private view returns (address[] memory assets) {
        assets = new address[](3);
        assets[0] = address(rewards[0]);
        assets[1] = address(rewards[1]);
        assets[2] = address(rewards[2]);
    }

    function _weights() private pure returns (uint16[] memory weights) {
        weights = new uint16[](3);
        weights[0] = 4_000;
        weights[1] = 4_000;
        weights[2] = 2_000;
    }
}
