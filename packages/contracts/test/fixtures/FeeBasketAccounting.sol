// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Conservation-focused accounting primitive for a fee-funded immutable basket.
/// @dev This checkpoint tracks base-asset allocations only. Swap execution and holder rewards
///      are deliberately separate later components.
contract FeeBasketAccounting {
    uint16 public constant BPS = 10_000;
    uint8 public constant MAX_ASSETS = 3;

    error InvalidAssetCount();
    error InvalidAsset(uint256 index);
    error DuplicateAsset(uint256 firstIndex, uint256 secondIndex);
    error InvalidWeightTotal(uint256 total);
    error InvalidAmount();
    error InvalidLeg(uint256 index);
    error Unauthorized();
    error InsufficientPending(uint256 available, uint256 requested);
    error TokenTransferFailed();

    struct BasketLeg {
        address asset;
        uint16 weightBps;
        uint256 pendingBase;
        uint256 consumedBase;
    }

    IERC20Minimal public immutable baseAsset;
    address public immutable controller;
    uint256 public immutable legCount;
    uint256 public totalDeposited;
    uint256 public totalConsumed;
    BasketLeg[] private _legs;

    event FeesRecorded(address indexed payer, uint256 amount);
    event LegFunded(uint256 indexed legIndex, address indexed asset, uint256 amount);
    event LegConsumed(
        uint256 indexed legIndex, address indexed asset, address indexed recipient, uint256 amount
    );

    constructor(
        IERC20Minimal baseAsset_,
        address controller_,
        address[] memory assets_,
        uint16[] memory weights_
    ) {
        uint256 count = assets_.length;
        if (address(baseAsset_) == address(0)) revert InvalidAsset(0);
        if (controller_ == address(0)) revert Unauthorized();
        if (count == 0 || count > MAX_ASSETS || weights_.length != count) {
            revert InvalidAssetCount();
        }

        uint256 totalWeight;
        for (uint256 i; i < count; ++i) {
            if (assets_[i] == address(0)) revert InvalidAsset(i);
            for (uint256 j; j < i; ++j) {
                if (assets_[i] == assets_[j]) revert DuplicateAsset(j, i);
            }
            totalWeight += weights_[i];
            _legs.push(BasketLeg(assets_[i], weights_[i], 0, 0));
        }
        if (totalWeight != BPS) revert InvalidWeightTotal(totalWeight);

        baseAsset = baseAsset_;
        controller = controller_;
        legCount = count;
    }

    function leg(uint256 index) external view returns (BasketLeg memory) {
        if (index >= legCount) revert InvalidLeg(index);
        return _legs[index];
    }

    function totalPending() public view returns (uint256 pending) {
        for (uint256 i; i < legCount; ++i) {
            pending += _legs[i].pendingBase;
        }
    }

    function recordFees(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (!baseAsset.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }

        uint256 assigned;
        for (uint256 i = 1; i < legCount; ++i) {
            uint256 allocation = (amount * _legs[i].weightBps) / BPS;
            _legs[i].pendingBase += allocation;
            assigned += allocation;
            emit LegFunded(i, _legs[i].asset, allocation);
        }

        uint256 firstAllocation = amount - assigned;
        _legs[0].pendingBase += firstAllocation;
        totalDeposited += amount;
        emit LegFunded(0, _legs[0].asset, firstAllocation);
        emit FeesRecorded(msg.sender, amount);

        assert(totalPending() + totalConsumed == totalDeposited);
    }

    function consumeLeg(uint256 index, uint256 amount, address recipient) external {
        if (msg.sender != controller) revert Unauthorized();
        if (index >= legCount) revert InvalidLeg(index);
        if (amount == 0 || recipient == address(0)) revert InvalidAmount();

        BasketLeg storage selected = _legs[index];
        uint256 available = selected.pendingBase;
        if (amount > available) revert InsufficientPending(available, amount);

        selected.pendingBase = available - amount;
        selected.consumedBase += amount;
        totalConsumed += amount;
        if (!baseAsset.transfer(recipient, amount)) revert TokenTransferFailed();

        emit LegConsumed(index, selected.asset, recipient, amount);
        assert(totalPending() + totalConsumed == totalDeposited);
    }
}
