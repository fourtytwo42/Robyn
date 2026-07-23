// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { FeeBasketVault, IRobynConversionRouter } from "../src/FeeBasketVault.sol";
import { RobynLaunchToken } from "../src/RobynLaunchToken.sol";
import { INativeFeeConverter } from "../src/dao/INativeFeeConverter.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { RobynProtocolFeeRouter } from "../src/dao/RobynProtocolFeeRouter.sol";

contract DaoFeeMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

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
    receive() external payable { }

    function convertBaseToNative(
        IERC20 baseAsset,
        uint256 amount,
        uint256 minimumNativeOut,
        uint256 deadline,
        address payable recipient
    ) external returns (uint256) {
        require(deadline >= block.timestamp && amount >= minimumNativeOut, "invalid");
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        (bool sent,) = recipient.call{ value: amount }("");
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
    receive() external payable { }

    function approve(IERC20 token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function route(RobynProtocolFeeRouter router, IERC20 token, uint256 amount) external {
        router.routeBaseFees(token, amount);
    }

    function convertLaunch(
        RobynProtocolFeeRouter router,
        IERC20 token,
        uint256 amount,
        uint256 minimumOut
    ) external {
        router.convertAndRouteLaunchFees(token, amount, minimumOut, block.timestamp + 1);
    }

    function claimDao(RobynDaoToken token) external {
        token.claimRewards();
    }

    function claimCreator(RobynProtocolFeeRouter router, address token) external {
        router.claimCreatorFees(token);
    }

    function claimCreatorTo(RobynProtocolFeeRouter router, address token, address payable recipient)
        external
    {
        router.claimCreatorFeesTo(token, recipient);
    }

    function claimCreatorBatch(RobynProtocolFeeRouter router, address[] calldata tokens) external {
        router.claimCreatorFeesBatch(tokens);
    }

    function claimCreatorBatchTo(
        RobynProtocolFeeRouter router,
        address[] calldata tokens,
        address payable recipient
    ) external {
        router.claimCreatorFeesBatchTo(tokens, recipient);
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

    receive() external payable { }

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
        launchToken = new RobynLaunchToken(
            "Launch", "LCH", address(locker), 1_000_000_000 ether, address(vault), assets
        );
        vault.bindLaunchToken(launchToken);

        router =
            new RobynProtocolFeeRouter(base, daoToken, payable(address(treasury)), address(this));
        address[] memory exclusions = new address[](2);
        exclusions[0] = address(treasury);
        exclusions[1] = address(router);
        daoToken.sealRewardExclusions(exclusions);
        daoToken.bindRewardDepositor(address(router));
        router.bindCoordinator(address(this));
        converter = new DaoFeeNativeConverter();
        (bool funded,) = address(converter).call{ value: 2_000 ether }("");
        require(funded, "fund converter");
        router.setConverter(converter);
        router.registerLaunch(
            launchToken, address(creator), vault, address(market), address(locker)
        );
    }

    function testFixedSupplyTransferAwareRewardsAndFeeConservation() external {
        base.mint(address(market), 1_000 ether);
        market.approve(base, address(router), 1_000 ether);
        market.route(router, launchToken, 1_000 ether);
        RobynProtocolFeeRouter.LaunchFeeAccount memory account =
            router.launchAccount(address(launchToken));
        require(vault.totalFeesReceived() == 500 ether, "basket 50");
        require(account.pendingCreatorBase == 250 ether, "creator 25");
        require(account.pendingDaoRewardBase == 200 ether, "dao 20");
        require(account.pendingTreasuryBase == 50 ether, "treasury 5");

        uint256 treasuryBefore = address(treasury).balance;
        router.convertPendingToNative(launchToken, 500 ether, 500 ether, block.timestamp + 1);
        account = router.launchAccount(address(launchToken));
        require(account.claimableCreatorNative == 250 ether, "creator native");
        require(account.cumulativeCreatorNative == 250 ether, "creator lifetime");
        uint256 memberClaimable = daoToken.claimableRewardOf(address(member));
        require(memberClaimable >= 200 ether - 1 && memberClaimable <= 200 ether, "member native");
        require(address(treasury).balance - treasuryBefore == 50 ether, "treasury native");

        member.transferDao(daoToken, address(secondMember), 300_000_000 ether);
        require(
            daoToken.claimableRewardOf(address(member)) == memberClaimable, "sender keeps accrued"
        );
        require(daoToken.claimableRewardOf(address(secondMember)) == 0, "recipient no retroactive");
        uint256 memberBefore = address(member).balance;
        member.claimDao(daoToken);
        require(address(member).balance - memberBefore == memberClaimable, "member claim");
        uint256 creatorBefore = address(creator).balance;
        creator.claimCreator(router, address(launchToken));
        require(address(creator).balance - creatorBefore == 250 ether, "creator claim");
        account = router.launchAccount(address(launchToken));
        require(account.claimableCreatorNative == 0, "token claim cleared");
        require(account.claimedCreatorNative == 250 ether, "token claim history");
        require(daoToken.totalSupply() == 1_000_000_000 ether, "fixed supply");
    }

    function testLaunchTokenFeesAreSoldThenSplit() external {
        locker.approve(launchToken, address(router), 100 ether);
        locker.convertLaunch(router, launchToken, 100 ether, 100 ether);
        require(vault.totalFeesReceived() == 50 ether, "launch fee basket");
        RobynProtocolFeeRouter.LaunchFeeAccount memory account =
            router.launchAccount(address(launchToken));
        require(account.cumulativeLaunchFeesConverted == 100 ether, "launch fee tracked");
        require(
            account.pendingCreatorBase + account.pendingDaoRewardBase + account.pendingTreasuryBase
                == 50 ether,
            "native queue"
        );
    }

    function testNativeConversionUsesBoundedProportionalBatches() external {
        base.mint(address(market), 1_000 ether);
        market.approve(base, address(router), 1_000 ether);
        market.route(router, launchToken, 1_000 ether);

        router.convertPendingToNative(launchToken, 100 ether, 100 ether, block.timestamp + 1);
        RobynProtocolFeeRouter.LaunchFeeAccount memory afterFirst =
            router.launchAccount(address(launchToken));
        require(afterFirst.pendingCreatorBase == 200 ether, "creator remainder");
        require(afterFirst.pendingDaoRewardBase == 160 ether, "dao remainder");
        require(afterFirst.pendingTreasuryBase == 40 ether, "treasury remainder");
        require(afterFirst.claimableCreatorNative == 50 ether, "creator first batch");
        require(router.totalDaoNativeRewards() == 40 ether, "dao first batch");
        require(router.totalTreasuryNative() == 10 ether, "treasury first batch");

        router.convertPendingToNative(
            launchToken, type(uint256).max, 400 ether, block.timestamp + 1
        );
        RobynProtocolFeeRouter.LaunchFeeAccount memory afterSecond =
            router.launchAccount(address(launchToken));
        require(
            afterSecond.pendingCreatorBase + afterSecond.pendingDaoRewardBase
                    + afterSecond.pendingTreasuryBase == 0,
            "queue drained"
        );
        require(afterSecond.claimableCreatorNative == 250 ether, "creator total");
        require(router.totalDaoNativeRewards() == 200 ether, "dao total");
        require(router.totalTreasuryNative() == 50 ether, "treasury total");
    }

    function testCreatorClaimsAreTokenSpecificAndBatchable() external {
        (RobynLaunchToken secondToken, FeeBasketVault secondVault, DaoFeeActor secondMarket,) =
            _createSecondLaunch(creator, "Second", "TWO");

        base.mint(address(market), 400 ether);
        market.approve(base, address(router), 400 ether);
        market.route(router, launchToken, 400 ether);
        base.mint(address(secondMarket), 800 ether);
        secondMarket.approve(base, address(router), 800 ether);
        secondMarket.route(router, secondToken, 800 ether);
        router.convertPendingToNative(
            launchToken, type(uint256).max, 200 ether, block.timestamp + 1
        );
        router.convertPendingToNative(
            secondToken, type(uint256).max, 400 ether, block.timestamp + 1
        );

        RobynProtocolFeeRouter.LaunchFeeAccount memory first =
            router.launchAccount(address(launchToken));
        RobynProtocolFeeRouter.LaunchFeeAccount memory second =
            router.launchAccount(address(secondToken));
        require(first.claimableCreatorNative == 100 ether, "first token claim");
        require(second.claimableCreatorNative == 200 ether, "second token claim");
        require(first.pendingCreatorBase == 0 && second.pendingCreatorBase == 0, "base converted");
        require(secondVault.totalFeesReceived() == 400 ether, "second basket isolated");

        uint256 beforeSingle = address(creator).balance;
        creator.claimCreator(router, address(launchToken));
        require(address(creator).balance - beforeSingle == 100 ether, "single claim amount");
        first = router.launchAccount(address(launchToken));
        second = router.launchAccount(address(secondToken));
        require(first.claimableCreatorNative == 0, "first cleared");
        require(first.claimedCreatorNative == 100 ether, "first claimed lifetime");
        require(second.claimableCreatorNative == 200 ether, "second preserved");
        require(router.totalCreatorNativeLiability() == 200 ether, "liability preserved");

        address[] memory tokens = new address[](2);
        tokens[0] = address(secondToken);
        tokens[1] = address(secondToken);
        uint256 beforeBatch = address(creator).balance;
        creator.claimCreatorBatch(router, tokens);
        require(address(creator).balance - beforeBatch == 200 ether, "batch pays once");
        second = router.launchAccount(address(secondToken));
        require(second.claimableCreatorNative == 0, "batch cleared");
        require(second.claimedCreatorNative == 200 ether, "batch claimed lifetime");
        require(router.totalCreatorNativeLiability() == 0, "liability cleared");
    }

    function testForeignCreatorAndFailedRecipientRevertWithoutLosingClaim() external {
        base.mint(address(market), 400 ether);
        market.approve(base, address(router), 400 ether);
        market.route(router, launchToken, 400 ether);
        router.convertPendingToNative(
            launchToken, type(uint256).max, 200 ether, block.timestamp + 1
        );

        (bool foreignSuccess,) = address(secondMember)
            .call(abi.encodeCall(DaoFeeActor.claimCreator, (router, address(launchToken))));
        require(!foreignSuccess, "foreign creator rejected");
        DaoFeeRejectingRecipient rejecting = new DaoFeeRejectingRecipient();
        (bool recipientSuccess,) = address(creator)
            .call(
                abi.encodeCall(
                    DaoFeeActor.claimCreatorTo,
                    (router, address(launchToken), payable(address(rejecting)))
                )
            );
        require(!recipientSuccess, "failed recipient rejected");
        RobynProtocolFeeRouter.LaunchFeeAccount memory account =
            router.launchAccount(address(launchToken));
        require(account.claimableCreatorNative == 100 ether, "claim restored");
        require(account.claimedCreatorNative == 0, "history restored");
        require(router.totalCreatorNativeLiability() == 100 ether, "liability restored");
    }

    function _createSecondLaunch(
        DaoFeeActor launchCreator,
        string memory name,
        string memory symbol
    )
        private
        returns (
            RobynLaunchToken token,
            FeeBasketVault launchVault,
            DaoFeeActor launchMarket,
            DaoFeeActor launchLocker
        )
    {
        DaoFeeMockERC20 reward = new DaoFeeMockERC20("Second Reward", "R2");
        DaoFeeBasketConverter basketConverter = new DaoFeeBasketConverter();
        address[] memory assets = new address[](1);
        assets[0] = address(reward);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        launchVault =
            new FeeBasketVault(base, basketConverter, address(this), assets, weights, 1, 1);
        launchMarket = new DaoFeeActor();
        launchLocker = new DaoFeeActor();
        token = new RobynLaunchToken(
            name, symbol, address(launchLocker), 1_000_000_000 ether, address(launchVault), assets
        );
        launchVault.bindLaunchToken(token);
        router.registerLaunch(
            token, address(launchCreator), launchVault, address(launchMarket), address(launchLocker)
        );
    }
}

contract DaoFeeRejectingRecipient {
    receive() external payable {
        revert("reject");
    }
}
