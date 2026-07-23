// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FeeBasketVault, IRobynConversionRouter} from "../src/FeeBasketVault.sol";
import {RobynLaunchToken} from "../src/RobynLaunchToken.sol";
import {INativeFeeConverter} from "../src/dao/INativeFeeConverter.sol";
import {RobynDaoToken} from "../src/dao/RobynDaoToken.sol";
import {RobynProtocolFeeRouter} from "../src/dao/RobynProtocolFeeRouter.sol";

contract DaoFeeMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DaoFeeBasketConverter is IRobynConversionRouter {
    using SafeERC20 for IERC20;

    function swapExactInput(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256) {
        require(deadline >= block.timestamp && amountIn >= minimumAmountOut, "invalid");
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        DaoFeeMockERC20(outputToken).mint(recipient, amountIn);
        return amountIn;
    }
}

contract DaoFeeNativeConverter is INativeFeeConverter {
    using SafeERC20 for IERC20;
    receive() external payable {}

    function convertBaseToNative(
        IERC20 baseAsset,
        uint256 amount,
        uint256 minimumNativeOut,
        uint256 deadline,
        address payable recipient
    ) external returns (uint256) {
        require(deadline >= block.timestamp && amount >= minimumNativeOut, "invalid");
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native");
        return amount;
    }

    function convertLaunchToBase(
        IERC20 launchToken,
        IERC20 baseAsset,
        uint256 amount,
        uint256 minimumBaseOut,
        uint256 deadline,
        address recipient
    ) external returns (uint256) {
        require(deadline >= block.timestamp && amount >= minimumBaseOut, "invalid");
        launchToken.safeTransferFrom(msg.sender, address(this), amount);
        DaoFeeMockERC20(address(baseAsset)).mint(recipient, amount);
        return amount;
    }
}

contract DaoFeeActor {
    receive() external payable {}

    function approve(IERC20 token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function route(RobynProtocolFeeRouter router, IERC20 token, uint256 amount) external {
        router.routeBaseFees(token, amount);
    }

    function convertLaunch(RobynProtocolFeeRouter router, IERC20 token, uint256 amount, uint256 minimumOut) external {
        router.convertAndRouteLaunchFees(token, amount, minimumOut, block.timestamp + 1);
    }

    function claimDao(RobynDaoToken token) external {
        token.claimRewards();
    }

    function claimCreator(RobynProtocolFeeRouter router) external {
        router.claimCreatorFees();
    }

    function transferDao(RobynDaoToken token, address to, uint256 amount) external {
        token.transfer(to, amount);
    }
}

contract DaoFeesTest {
    DaoFeeActor private member;
    DaoFeeActor private secondMember;
    DaoFeeActor private treasury;
    DaoFeeActor private creator;
    DaoFeeActor private market;
    DaoFeeActor private locker;
    RobynDaoToken private daoToken;
    DaoFeeMockERC20 private base;
    FeeBasketVault private vault;
    RobynLaunchToken private launchToken;
    RobynProtocolFeeRouter private router;
    DaoFeeNativeConverter private converter;

    receive() external payable {}

    function setUp() external {
        member = new DaoFeeActor();
        secondMember = new DaoFeeActor();
        treasury = new DaoFeeActor();
        creator = new DaoFeeActor();
        market = new DaoFeeActor();
        locker = new DaoFeeActor();

        address[] memory recipients = new address[](2);
        recipients[0] = address(member);
        recipients[1] = address(treasury);
        uint256[] memory allocations = new uint256[](2);
        allocations[0] = 600_000_000 ether;
        allocations[1] = 400_000_000 ether;
        daoToken = new RobynDaoToken(recipients, allocations);
        base = new DaoFeeMockERC20("Mock USD", "mUSD");
        DaoFeeMockERC20 reward = new DaoFeeMockERC20("Reward", "RWD");
        DaoFeeBasketConverter basketConverter = new DaoFeeBasketConverter();
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        vault = new FeeBasketVault(base, basketConverter, address(this), assets, weights, 1, 1);
        launchToken =
            new RobynLaunchToken("Launch", "LCH", address(locker), 1_000_000_000 ether, address(vault), assets);
        vault.bindLaunchToken(launchToken);

        router = new RobynProtocolFeeRouter(base, daoToken, payable(address(treasury)), address(this));
        address[] memory exclusions = new address[](2);
        exclusions[0] = address(treasury);
        exclusions[1] = address(router);
        daoToken.sealRewardExclusions(exclusions);
        daoToken.bindRewardDepositor(address(router));
        router.bindCoordinator(address(this));
        converter = new DaoFeeNativeConverter();
        (bool funded,) = address(converter).call{value: 2_000 ether}("");
        require(funded, "fund converter");
        router.setConverter(converter);
        router.registerLaunch(launchToken, address(creator), vault, address(market), address(locker));
    }

    function testFixedSupplyTransferAwareRewardsAndFeeConservation() external {
        base.mint(address(market), 1_000 ether);
        market.approve(base, address(router), 1_000 ether);
        market.route(router, launchToken, 1_000 ether);
        RobynProtocolFeeRouter.LaunchFeeAccount memory account = router.launchAccount(address(launchToken));
        require(vault.totalFeesReceived() == 500 ether, "basket 50");
        require(account.pendingCreatorBase == 250 ether, "creator 25");
        require(account.pendingDaoRewardBase == 200 ether, "dao 20");
        require(account.pendingTreasuryBase == 50 ether, "treasury 5");

        uint256 treasuryBefore = address(treasury).balance;
        router.convertPendingToNative(launchToken, 500 ether, 500 ether, block.timestamp + 1);
        require(router.creatorNativeClaims(address(creator)) == 250 ether, "creator native");
        uint256 memberClaimable = daoToken.claimableRewardOf(address(member));
        require(memberClaimable >= 200 ether - 1 && memberClaimable <= 200 ether, "member native");
        require(address(treasury).balance - treasuryBefore == 50 ether, "treasury native");

        member.transferDao(daoToken, address(secondMember), 300_000_000 ether);
        require(daoToken.claimableRewardOf(address(member)) == memberClaimable, "sender keeps accrued");
        require(daoToken.claimableRewardOf(address(secondMember)) == 0, "recipient no retroactive");
        uint256 memberBefore = address(member).balance;
        member.claimDao(daoToken);
        require(address(member).balance - memberBefore == memberClaimable, "member claim");
        uint256 creatorBefore = address(creator).balance;
        creator.claimCreator(router);
        require(address(creator).balance - creatorBefore == 250 ether, "creator claim");
        require(daoToken.totalSupply() == 1_000_000_000 ether, "fixed supply");
    }

    function testLaunchTokenFeesAreSoldThenSplit() external {
        locker.approve(launchToken, address(router), 100 ether);
        locker.convertLaunch(router, launchToken, 100 ether, 100 ether);
        require(vault.totalFeesReceived() == 50 ether, "launch fee basket");
        RobynProtocolFeeRouter.LaunchFeeAccount memory account = router.launchAccount(address(launchToken));
        require(account.cumulativeLaunchFeesConverted == 100 ether, "launch fee tracked");
        require(
            account.pendingCreatorBase + account.pendingDaoRewardBase + account.pendingTreasuryBase == 50 ether,
            "native queue"
        );
    }

    function testNativeConversionUsesBoundedProportionalBatches() external {
        base.mint(address(market), 1_000 ether);
        market.approve(base, address(router), 1_000 ether);
        market.route(router, launchToken, 1_000 ether);

        router.convertPendingToNative(launchToken, 100 ether, 100 ether, block.timestamp + 1);
        RobynProtocolFeeRouter.LaunchFeeAccount memory afterFirst = router.launchAccount(address(launchToken));
        require(afterFirst.pendingCreatorBase == 200 ether, "creator remainder");
        require(afterFirst.pendingDaoRewardBase == 160 ether, "dao remainder");
        require(afterFirst.pendingTreasuryBase == 40 ether, "treasury remainder");
        require(router.creatorNativeClaims(address(creator)) == 50 ether, "creator first batch");
        require(router.totalDaoNativeRewards() == 40 ether, "dao first batch");
        require(router.totalTreasuryNative() == 10 ether, "treasury first batch");

        router.convertPendingToNative(launchToken, type(uint256).max, 400 ether, block.timestamp + 1);
        RobynProtocolFeeRouter.LaunchFeeAccount memory afterSecond = router.launchAccount(address(launchToken));
        require(
            afterSecond.pendingCreatorBase + afterSecond.pendingDaoRewardBase + afterSecond.pendingTreasuryBase == 0,
            "queue drained"
        );
        require(router.creatorNativeClaims(address(creator)) == 250 ether, "creator total");
        require(router.totalDaoNativeRewards() == 200 ether, "dao total");
        require(router.totalTreasuryNative() == 50 ether, "treasury total");
    }
}
