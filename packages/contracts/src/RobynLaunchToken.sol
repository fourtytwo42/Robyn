// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Fixed-supply token with transfer-aware, multi-asset holder rewards.
contract RobynLaunchToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant MAX_REWARD_ASSETS = 5;
    uint256 public constant MAGNITUDE = 2 ** 128;
    string public constant CONTRACT_VERSION = "1.0.0";

    error Unauthorized();
    error InvalidAssetCount();
    error InvalidAsset(uint256 index);
    error DuplicateAsset(uint256 firstIndex, uint256 secondIndex);
    error InvalidAccount();
    error InvalidAmount();
    error InvalidAssetIndex(uint256 index);
    error NoRewardAvailable();
    error ExclusionsAlreadySealed();
    error ExclusionsNotSealed();
    error DuplicateExcludedAccount(address account);

    address public immutable controller;
    address public immutable initializationAuthority;
    uint256 public immutable rewardAssetCount;
    uint256 public eligibleSupply;
    bool public exclusionsSealed;
    mapping(address => bool) public isExcluded;
    IERC20[] private _rewardAssets;
    uint256[] public magnifiedRewardPerShare;
    uint256[] public pendingWithoutSupply;
    uint256[] public totalRewardsReceived;
    uint256[] public totalRewardsDistributed;
    uint256[] public totalRewardsClaimed;
    mapping(address => mapping(uint256 => int256)) private _magnifiedCorrections;
    mapping(address => mapping(uint256 => uint256)) private _withdrawn;

    event RewardReceived(
        uint256 indexed assetIndex,
        address indexed asset,
        uint256 received,
        uint256 distributed,
        uint256 pendingWithoutSupply
    );
    event RewardClaimed(
        address indexed account, uint256 indexed assetIndex, address indexed asset, uint256 amount
    );
    event ExclusionsSealed(address[] accounts, uint256 eligibleSupply);

    constructor(
        string memory name_,
        string memory symbol_,
        address creator_,
        uint256 initialSupply_,
        address controller_,
        address[] memory rewardAssets_
    ) ERC20(name_, symbol_) {
        if (creator_ == address(0) || controller_ == address(0)) {
            revert InvalidAccount();
        }
        if (initialSupply_ == 0) revert InvalidAmount();
        uint256 count = rewardAssets_.length;
        if (count == 0 || count > MAX_REWARD_ASSETS) revert InvalidAssetCount();
        for (uint256 i; i < count; ++i) {
            if (rewardAssets_[i] == address(0)) revert InvalidAsset(i);
            for (uint256 j; j < i; ++j) {
                if (rewardAssets_[i] == rewardAssets_[j]) revert DuplicateAsset(j, i);
            }
            _rewardAssets.push(IERC20(rewardAssets_[i]));
            magnifiedRewardPerShare.push(0);
            pendingWithoutSupply.push(0);
            totalRewardsReceived.push(0);
            totalRewardsDistributed.push(0);
            totalRewardsClaimed.push(0);
        }
        controller = controller_;
        initializationAuthority = msg.sender;
        rewardAssetCount = count;
        _mint(creator_, initialSupply_);
    }

    /// @notice Finalizes accounts that never participate in reward supply or claims.
    /// @dev This one-time call must happen before a controller can distribute any reward.
    function sealExclusions(address[] calldata accounts) external {
        if (msg.sender != initializationAuthority) revert Unauthorized();
        if (exclusionsSealed) revert ExclusionsAlreadySealed();
        for (uint256 i; i < accounts.length; ++i) {
            address account = accounts[i];
            if (account == address(0)) revert InvalidAccount();
            if (isExcluded[account]) revert DuplicateExcludedAccount(account);
            isExcluded[account] = true;
            eligibleSupply -= balanceOf(account);
        }
        exclusionsSealed = true;
        emit ExclusionsSealed(accounts, eligibleSupply);
    }

    function rewardAsset(uint256 index) public view returns (address) {
        _validateAssetIndex(index);
        return address(_rewardAssets[index]);
    }

    function distributeReward(uint256 index, uint256 requestedAmount)
        external
        nonReentrant
        returns (uint256 received)
    {
        if (msg.sender != controller) revert Unauthorized();
        if (!exclusionsSealed) revert ExclusionsNotSealed();
        _validateAssetIndex(index);
        if (requestedAmount == 0) revert InvalidAmount();
        IERC20 asset = _rewardAssets[index];
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), requestedAmount);
        received = asset.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert InvalidAmount();
        totalRewardsReceived[index] += received;
        uint256 supply = eligibleSupply;
        if (supply == 0) {
            pendingWithoutSupply[index] += received;
            emit RewardReceived(index, address(asset), received, 0, pendingWithoutSupply[index]);
            return received;
        }
        uint256 distributable = received + pendingWithoutSupply[index];
        pendingWithoutSupply[index] = 0;
        magnifiedRewardPerShare[index] += (distributable * MAGNITUDE) / supply;
        totalRewardsDistributed[index] += distributable;
        emit RewardReceived(index, address(asset), received, distributable, 0);
    }

    function accumulativeRewardOf(address account, uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        if (isExcluded[account]) return 0;
        int256 magnified = SafeCast.toInt256(magnifiedRewardPerShare[index] * balanceOf(account))
            + _magnifiedCorrections[account][index];
        if (magnified <= 0) return 0;
        // The positive check above proves that conversion to uint256 cannot truncate the sign.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(magnified) / MAGNITUDE;
    }

    function withdrawnRewardOf(address account, uint256 index) external view returns (uint256) {
        _validateAssetIndex(index);
        return _withdrawn[account][index];
    }

    function withdrawableRewardOf(address account, uint256 index) public view returns (uint256) {
        uint256 accumulated = accumulativeRewardOf(account, index);
        uint256 withdrawn = _withdrawn[account][index];
        return accumulated > withdrawn ? accumulated - withdrawn : 0;
    }

    function claim(uint256 index) public nonReentrant returns (uint256 amount) {
        _validateAssetIndex(index);
        amount = withdrawableRewardOf(msg.sender, index);
        if (amount == 0) revert NoRewardAvailable();
        _withdrawn[msg.sender][index] += amount;
        totalRewardsClaimed[index] += amount;
        _rewardAssets[index].safeTransfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, index, address(_rewardAssets[index]), amount);
    }

    function claimAll() external returns (uint256 claimed) {
        for (uint256 i; i < rewardAssetCount; ++i) {
            if (withdrawableRewardOf(msg.sender, i) != 0) claimed += claim(i);
        }
        if (claimed == 0) revert NoRewardAvailable();
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        for (uint256 i; i < rewardAssetCount; ++i) {
            int256 correction = SafeCast.toInt256(magnifiedRewardPerShare[i] * value);
            if (from != address(0)) _magnifiedCorrections[from][i] += correction;
            if (to != address(0)) _magnifiedCorrections[to][i] -= correction;
        }
        if (value != 0) {
            bool fromEligible = from != address(0) && !isExcluded[from];
            bool toEligible = to != address(0) && !isExcluded[to];
            if (fromEligible && !toEligible) eligibleSupply -= value;
            if (!fromEligible && toEligible) eligibleSupply += value;
        }
    }

    function _validateAssetIndex(uint256 index) private view {
        if (index >= rewardAssetCount) revert InvalidAssetIndex(index);
    }
}
