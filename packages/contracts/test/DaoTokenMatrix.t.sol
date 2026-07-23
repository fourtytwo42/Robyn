// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";

interface DaoTokenMatrixVm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function prank(address caller) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract DaoRewardDepositor {
    function deposit(RobynDaoToken token) external payable {
        token.depositRewards{ value: msg.value }();
    }
}

contract DaoRewardRejector {
    receive() external payable {
        revert("reject");
    }
}

contract DaoTokenMatrixTest {
    DaoTokenMatrixVm private constant vm =
        DaoTokenMatrixVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant HOLDER_KEY = 0xA11CE;
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

    address private holder;
    address private excluded = address(0xBEEF);
    RobynDaoToken private token;
    DaoRewardDepositor private depositor;

    function setUp() external {
        holder = vm.addr(HOLDER_KEY);
        address[] memory recipients = new address[](2);
        recipients[0] = holder;
        recipients[1] = excluded;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 900_000_000 ether;
        amounts[1] = 100_000_000 ether;
        token = new RobynDaoToken(recipients, amounts);
        depositor = new DaoRewardDepositor();
        address[] memory exclusions = new address[](1);
        exclusions[0] = excluded;
        token.sealRewardExclusions(exclusions);
        token.bindRewardDepositor(address(depositor));
        vm.deal(address(this), 100 ether);
    }

    function testPermitTransferFromAndReplayProtection() external {
        address spender = address(0xCAFE);
        uint256 amount = 10_000 ether;
        uint256 deadline = block.timestamp + 1 days;
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, holder, spender, amount, 0, deadline));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_KEY, digest);
        token.permit(holder, spender, amount, deadline, v, r, s);
        require(token.allowance(holder, spender) == amount, "permit allowance");

        vm.prank(spender);
        token.transferFrom(holder, spender, amount);
        require(token.balanceOf(spender) == amount, "permit transfer");
        try token.permit(holder, spender, amount, deadline, v, r, s) {
            revert("permit replay accepted");
        } catch { }
    }

    function testDelegationBySignatureAndReplayProtection() external {
        address delegatee = address(0xD1E6A7E);
        uint256 expiry = block.timestamp + 1 days;
        bytes32 structHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, 0, expiry));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_KEY, digest);
        token.delegateBySig(delegatee, 0, expiry, v, r, s);
        require(token.delegates(holder) == delegatee, "delegatee");
        require(token.getVotes(delegatee) == 900_000_000 ether, "delegated votes");
        try token.delegateBySig(delegatee, 0, expiry, v, r, s) {
            revert("delegation replay accepted");
        } catch { }

        vm.warp(expiry + 1);
        bytes32 expiredHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, 1, expiry));
        bytes32 expiredDigest =
            keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), expiredHash));
        (v, r, s) = vm.sign(HOLDER_KEY, expiredDigest);
        try token.delegateBySig(delegatee, 1, expiry, v, r, s) {
            revert("expired delegation accepted");
        } catch { }
    }

    function testRewardClaimToFailureRollbackAndExclusionRules() external {
        depositor.deposit{ value: 9 ether }(token);
        uint256 claimable = token.claimableRewardOf(holder);
        require(claimable > 0, "holder reward");
        address payable recipient = payable(address(0x1234));
        uint256 beforeBalance = recipient.balance;
        vm.prank(holder);
        token.claimRewardsTo(recipient);
        require(recipient.balance - beforeBalance == claimable, "claim-to amount");

        depositor.deposit{ value: 9 ether }(token);
        uint256 secondClaim = token.claimableRewardOf(holder);
        DaoRewardRejector rejector = new DaoRewardRejector();
        vm.prank(holder);
        try token.claimRewardsTo(payable(address(rejector))) {
            revert("rejecting recipient accepted");
        } catch { }
        require(token.claimableRewardOf(holder) == secondClaim, "failed claim lost reward");

        vm.prank(excluded);
        try token.claimRewards() {
            revert("excluded claim accepted");
        } catch { }
        vm.prank(holder);
        try token.depositRewards{ value: 1 }() {
            revert("unauthorized deposit accepted");
        } catch { }
    }

    function testInitializationAndFixedSupplyValidation() external {
        try token.bindRewardDepositor(address(depositor)) {
            revert("reward depositor rebound");
        } catch { }
        try token.sealRewardExclusions(new address[](1)) {
            revert("exclusions resealed");
        } catch { }
        require(token.totalSupply() == 1_000_000_000 ether, "fixed supply");

        address[] memory invalidRecipients = new address[](1);
        invalidRecipients[0] = address(this);
        uint256[] memory invalidAmounts = new uint256[](1);
        invalidAmounts[0] = 999_999_999 ether;
        try new RobynDaoToken(invalidRecipients, invalidAmounts) {
            revert("invalid supply accepted");
        } catch { }
    }
}
