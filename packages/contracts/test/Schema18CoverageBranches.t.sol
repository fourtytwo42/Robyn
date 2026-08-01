// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RobynBootstrapTimelock } from "../src/dao/RobynBootstrapTimelock.sol";
import { RobynDaoToken } from "../src/dao/RobynDaoToken.sol";
import { IRobynSchema18BootstrapFinalizer, RobynDaoTokenV3 } from "../src/dao/RobynDaoTokenV3.sol";

contract Schema18CoverageFinalizer is IRobynSchema18BootstrapFinalizer {
    address public override bootstrapToken;
    address public override bootstrapOwner;
    bool public finalized;

    function configure(address token, address owner) external {
        bootstrapToken = token;
        bootstrapOwner = owner;
    }

    function finalizeBootstrapFromToken() external override {
        require(msg.sender == bootstrapToken, "token");
        finalized = true;
    }
}

    contract Schema18CoverageBranchesTest is Test {
        address private constant GUARDIAN = address(0xCAFE);
        address private constant RECIPIENT = address(0xBEEF);
        bytes32 private constant DOMAIN = keccak256("SCHEMA18_COVERAGE");

        function testDaoV3ConstructorRejectsEveryBootstrapShapeBoundary() external {
            address[] memory recipients = new address[](0);
            uint256[] memory amounts = new uint256[](0);
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            new RobynDaoTokenV3(recipients, amounts, 1 hours, address(this));

            recipients = new address[](1);
            amounts = new uint256[](1);
            recipients[0] = RECIPIENT;
            amounts[0] = 1_000_000_000 ether;
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            new RobynDaoTokenV3(recipients, amounts, 1 hours, address(this));

            recipients[0] = address(this);
            amounts[0] -= 1;
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            new RobynDaoTokenV3(recipients, amounts, 1 hours, address(this));

            recipients[0] = address(0);
            amounts[0] = 1_000_000_000 ether;
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            new RobynDaoTokenV3(recipients, amounts, 1 hours, address(0));
        }

        function testDaoV3BindingRejectsUnauthorizedZeroEoaMismatchAndRepeat() external {
            RobynDaoTokenV3 token = _newToken();
            Schema18CoverageFinalizer finalizer = new Schema18CoverageFinalizer();

            vm.prank(RECIPIENT);
            vm.expectRevert(RobynDaoToken.Unauthorized.selector);
            token.bindBootstrapController(address(finalizer));
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            token.bindBootstrapController(address(0));
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            token.bindBootstrapController(RECIPIENT);

            finalizer.configure(RECIPIENT, address(this));
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            token.bindBootstrapController(address(finalizer));
            finalizer.configure(address(token), RECIPIENT);
            vm.expectRevert(RobynDaoToken.InvalidConfiguration.selector);
            token.bindBootstrapController(address(finalizer));

            finalizer.configure(address(token), address(this));
            token.bindBootstrapController(address(finalizer));
            vm.expectRevert(RobynDaoTokenV3.BootstrapControllerAlreadyBound.selector);
            token.bindBootstrapController(address(finalizer));
        }

        function testDaoV3DistributionRequiresBindingAndFinalizesExactlyOnce() external {
            RobynDaoTokenV3 unbound = _newToken();
            vm.expectRevert(RobynDaoTokenV3.BootstrapControllerNotBound.selector);
            unbound.transfer(RECIPIENT, 1);

            RobynDaoTokenV3 token = _newToken();
            Schema18CoverageFinalizer finalizer = new Schema18CoverageFinalizer();
            finalizer.configure(address(token), address(this));
            token.bindBootstrapController(address(finalizer));

            token.transfer(address(this), 1);
            token.transfer(RECIPIENT, 0);
            assertFalse(finalizer.finalized());
            token.transfer(RECIPIENT, 1);
            assertTrue(finalizer.finalized());
            vm.prank(RECIPIENT);
            token.transfer(address(0xD00D), 1);
        }

        function testBootstrapConstructorAndPlanIndexBoundaries() external {
            RobynDaoTokenV3 token = _newToken();
            bytes32[2] memory hashes = [keccak256("one"), keccak256("two")];

            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(IERC20(address(0)), address(this), GUARDIAN, DOMAIN, hashes);
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(token, address(0), GUARDIAN, DOMAIN, hashes);
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(token, address(this), address(0), DOMAIN, hashes);
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(token, address(this), address(this), DOMAIN, hashes);
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(token, address(this), GUARDIAN, bytes32(0), hashes);
            hashes[0] = bytes32(0);
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(token, address(this), GUARDIAN, DOMAIN, hashes);
            hashes = [keccak256("same"), keccak256("same")];
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            new RobynBootstrapTimelock(token, address(this), GUARDIAN, DOMAIN, hashes);

            hashes = [keccak256("one"), keccak256("two")];
            RobynBootstrapTimelock timelock =
                new RobynBootstrapTimelock(token, address(this), GUARDIAN, DOMAIN, hashes);
            vm.expectRevert(
                abi.encodeWithSelector(RobynBootstrapTimelock.InvalidBootstrapStep.selector, 0, 2)
            );
            timelock.bootstrapPlanHash(2);
        }

        function testBootstrapMalformedTargetsAndAuthorizationBoundaries() external {
            (RobynDaoTokenV3 token, RobynBootstrapTimelock timelock) = _emptyPlanTimelock();
            token;
            address[] memory targets = new address[](0);
            uint256[] memory values = new uint256[](0);
            bytes[] memory payloads = new bytes[](0);
            vm.expectRevert(RobynBootstrapTimelock.InvalidConfiguration.selector);
            timelock.executeBootstrapStep(0, targets, values, payloads);

            vm.prank(RECIPIENT);
            vm.expectRevert(RobynBootstrapTimelock.Unauthorized.selector);
            timelock.finalizeBootstrap();
            vm.prank(RECIPIENT);
            vm.expectRevert(RobynBootstrapTimelock.Unauthorized.selector);
            timelock.abortBootstrap();
            vm.prank(RECIPIENT);
            vm.expectRevert(RobynBootstrapTimelock.Unauthorized.selector);
            timelock.finalizeBootstrapFromToken();
            vm.expectRevert(RobynBootstrapTimelock.BootstrapInactive.selector);
            timelock.finalizeExpiredBootstrap();

            timelock.finalizeBootstrap();
            vm.expectRevert(RobynBootstrapTimelock.BootstrapInactive.selector);
            timelock.finalizeBootstrap();
        }

        function _newToken() private returns (RobynDaoTokenV3 token) {
            address[] memory recipients = new address[](1);
            recipients[0] = address(this);
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = 1_000_000_000 ether;
            token = new RobynDaoTokenV3(recipients, amounts, 1 hours, address(this));
        }

        function _emptyPlanTimelock()
            private
            returns (RobynDaoTokenV3 token, RobynBootstrapTimelock timelock)
        {
            token = _newToken();
            address[] memory targets = new address[](0);
            uint256[] memory values = new uint256[](0);
            bytes[] memory payloads = new bytes[](0);
            bytes32[2] memory hashes;
            hashes[0] =
                keccak256(abi.encode(block.chainid, DOMAIN, uint8(0), targets, values, payloads));
            hashes[1] =
                keccak256(abi.encode(block.chainid, DOMAIN, uint8(1), targets, values, payloads));
            timelock = new RobynBootstrapTimelock(token, address(this), GUARDIAN, DOMAIN, hashes);
            token.bindBootstrapController(address(timelock));
        }
    }
