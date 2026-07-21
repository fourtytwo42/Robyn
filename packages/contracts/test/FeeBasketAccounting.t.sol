// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { FeeBasketAccounting, IERC20Minimal } from "./fixtures/FeeBasketAccounting.sol";

contract MockBaseAsset is IERC20Minimal {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FeeBasketAccountingTest {
    MockBaseAsset private base;
    FeeBasketAccounting private accounting;

    function setUp() public {
        base = new MockBaseAsset();
        accounting = _deploy(_assets(), _weights());
        base.approve(address(accounting), type(uint256).max);
    }

    function testConservesUnevenFeeAllocation() public {
        base.mint(address(this), 101);
        accounting.recordFees(101);

        require(accounting.totalDeposited() == 101, "deposited");
        require(accounting.totalPending() == 101, "pending");
        require(accounting.totalConsumed() == 0, "consumed");
        require(accounting.leg(0).pendingBase == 41, "leg 0 residual");
        require(accounting.leg(1).pendingBase == 40, "leg 1");
        require(accounting.leg(2).pendingBase == 20, "leg 2");
    }

    function testFuzzConservation(uint96 rawAmount) public {
        uint256 amount = uint256(rawAmount) + 1;
        base.mint(address(this), amount);
        accounting.recordFees(amount);

        require(accounting.totalPending() + accounting.totalConsumed() == amount, "conservation");
        require(base.balanceOf(address(accounting)) == amount, "vault balance");
    }

    function testConsumptionKeepsOtherLegsIsolated() public {
        base.mint(address(this), 1_000);
        accounting.recordFees(1_000);
        address recipient = address(0xBEEF);

        accounting.consumeLeg(1, 250, recipient);

        require(accounting.leg(0).pendingBase == 400, "leg 0 changed");
        require(accounting.leg(1).pendingBase == 150, "leg 1 pending");
        require(accounting.leg(1).consumedBase == 250, "leg 1 consumed");
        require(accounting.leg(2).pendingBase == 200, "leg 2 changed");
        require(accounting.totalPending() == 750, "total pending");
        require(accounting.totalConsumed() == 250, "total consumed");
        require(base.balanceOf(recipient) == 250, "recipient");
    }

    function testRejectsDuplicateAssets() public {
        address[] memory assets = _assets();
        assets[2] = assets[0];

        try new FeeBasketAccounting(base, address(this), assets, _weights()) {
            revert("duplicate accepted");
        } catch { }
    }

    function testRejectsInvalidWeightTotal() public {
        uint16[] memory weights = _weights();
        weights[2] = 1_999;

        try new FeeBasketAccounting(base, address(this), _assets(), weights) {
            revert("invalid total accepted");
        } catch { }
    }

    function _deploy(address[] memory assets, uint16[] memory weights)
        private
        returns (FeeBasketAccounting)
    {
        return new FeeBasketAccounting(base, address(this), assets, weights);
    }

    function _assets() private pure returns (address[] memory assets) {
        assets = new address[](3);
        assets[0] = address(0xA11CE);
        assets[1] = address(0xB0B);
        assets[2] = address(0xCAFE);
    }

    function _weights() private pure returns (uint16[] memory weights) {
        weights = new uint16[](3);
        weights[0] = 4_000;
        weights[1] = 4_000;
        weights[2] = 2_000;
    }
}
