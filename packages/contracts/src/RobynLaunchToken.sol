// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-supply token with transfer-aware, immediate multi-asset rewards.
contract RobynLaunchToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant MAX_REWARD_ASSETS = 5;
    uint8 public constant MAX_EXCLUDED_ACCOUNTS = 16;
    uint256 public constant MAGNITUDE = 2 ** 128;
    uint256 public constant REWARD_STREAM_DURATION = 0;
    string public constant CONTRACT_VERSION = "4.0.0";

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
    error TooManyExcludedAccounts(uint256 count);
    error InvalidTokenUri();
    error NoEligibleRewardSupply();

    struct RewardStream {
        uint256 rewardRate;
        uint256 periodFinish;
        uint256 lastUpdateTime;
        uint256 streamStartTime;
        uint256 streamTotal;
        uint256 streamReleased;
    }

    address public immutable controller;
    address public immutable initializationAuthority;
    uint256 public immutable rewardAssetCount;
    uint256 public eligibleSupply;
    bool public exclusionsSealed;
    mapping(address => bool) public isExcluded;
    IERC20[] private _rewardAssets;
    RewardStream[] private _streams;
    uint256[] public magnifiedRewardPerShare;
    uint256[] public pendingWithoutSupply;
    uint256[] public totalRewardsReceived;
    uint256[] public totalRewardsDistributed;
    uint256[] public totalRewardsClaimed;
    mapping(address => mapping(uint256 => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(uint256 => uint256)) private _accruedRewards;
    mapping(address => mapping(uint256 => uint256)) private _withdrawn;
    string private _tokenUri;

    event RewardReceived(
        uint256 indexed assetIndex,
        address indexed asset,
        uint256 received,
        uint256 distributed,
        uint256 pendingWithoutSupply
    );
    event RewardStreamUpdated(
        uint256 indexed assetIndex,
        uint256 rewardRate,
        uint256 periodFinish,
        uint256 queuedRewards,
        uint256 eligibleSupply
    );
    event RewardStreamPaused(uint256 indexed assetIndex, uint256 queuedRewards);
    event RewardDistributed(uint256 indexed assetIndex, uint256 amount, uint256 eligibleSupply);
    event RewardClaimed(address indexed account, uint256 indexed assetIndex, address indexed asset, uint256 amount);
    event ExclusionsSealed(address[] accounts, uint256 eligibleSupply);

    constructor(
        string memory name_,
        string memory symbol_,
        address creator_,
        uint256 initialSupply_,
        address controller_,
        address[] memory rewardAssets_,
        string memory tokenUri_
    ) ERC20(name_, symbol_) {
        if (creator_ == address(0) || controller_ == address(0)) {
            revert InvalidAccount();
        }
        if (initialSupply_ == 0) revert InvalidAmount();
        _validateTokenUri(tokenUri_);
        uint256 count = rewardAssets_.length;
        if (count == 0 || count > MAX_REWARD_ASSETS) revert InvalidAssetCount();
        for (uint256 i; i < count; ++i) {
            if (rewardAssets_[i] == address(0)) revert InvalidAsset(i);
            for (uint256 j; j < i; ++j) {
                if (rewardAssets_[i] == rewardAssets_[j]) revert DuplicateAsset(j, i);
            }
            _rewardAssets.push(IERC20(rewardAssets_[i]));
            _streams.push(RewardStream(0, 0, 0, 0, 0, 0));
            magnifiedRewardPerShare.push(0);
            pendingWithoutSupply.push(0);
            totalRewardsReceived.push(0);
            totalRewardsDistributed.push(0);
            totalRewardsClaimed.push(0);
        }
        controller = controller_;
        initializationAuthority = msg.sender;
        rewardAssetCount = count;
        _tokenUri = tokenUri_;
        _mint(creator_, initialSupply_);
    }

    function tokenURI() external view returns (string memory) {
        return _tokenUri;
    }

    function sealExclusions(address[] calldata accounts) external {
        if (msg.sender != initializationAuthority) revert Unauthorized();
        if (exclusionsSealed) revert ExclusionsAlreadySealed();
        if (accounts.length > MAX_EXCLUDED_ACCOUNTS) {
            revert TooManyExcludedAccounts(accounts.length);
        }
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

    function rewardStream(uint256 index) external view returns (RewardStream memory) {
        _validateAssetIndex(index);
        return _streams[index];
    }

    function lastTimeRewardApplicable(uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        uint256 finish = _streams[index].periodFinish;
        return block.timestamp < finish ? block.timestamp : finish;
    }

    function currentRewardPerToken(uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        uint256 supply = eligibleSupply;
        if (supply == 0) return magnifiedRewardPerShare[index];
        return magnifiedRewardPerShare[index];
    }

    function streamingRewards(uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        return 0;
    }

    function totalRewardsVested(uint256 index) external view returns (uint256) {
        _validateAssetIndex(index);
        return totalRewardsDistributed[index];
    }

    function distributeReward(uint256 index, uint256 requestedAmount) external nonReentrant returns (uint256 received) {
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
        pendingWithoutSupply[index] += received;
        uint256 supply = eligibleSupply;
        uint256 distributed;
        if (supply != 0) distributed = _distributePending(index, supply);
        emit RewardReceived(index, address(asset), received, distributed, pendingWithoutSupply[index]);
    }

    function activateQueuedRewards(uint256 index) external nonReentrant {
        _validateAssetIndex(index);
        if (eligibleSupply == 0) revert NoEligibleRewardSupply();
        if (pendingWithoutSupply[index] == 0) revert NoRewardAvailable();
        _distributePending(index, eligibleSupply);
    }

    function accumulativeRewardOf(address account, uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        if (isExcluded[account]) return 0;
        return _withdrawn[account][index] + withdrawableRewardOf(account, index);
    }

    function withdrawnRewardOf(address account, uint256 index) external view returns (uint256) {
        _validateAssetIndex(index);
        return _withdrawn[account][index];
    }

    function withdrawableRewardOf(address account, uint256 index) public view returns (uint256) {
        _validateAssetIndex(index);
        if (isExcluded[account]) return 0;
        return _accruedRewards[account][index]
            + (balanceOf(account) * (currentRewardPerToken(index) - userRewardPerTokenPaid[account][index])) / MAGNITUDE;
    }

    function claim(uint256 index) public nonReentrant returns (uint256 amount) {
        _validateAssetIndex(index);
        return _claimAsset(msg.sender, index);
    }

    function claimAll() external nonReentrant returns (uint256 claimed) {
        for (uint256 i; i < rewardAssetCount; ++i) {
            _updateAccount(msg.sender, i);
            uint256 amount = _accruedRewards[msg.sender][i];
            if (amount != 0) {
                claimed += _claimUpdatedAsset(msg.sender, i, amount);
            }
        }
        if (claimed == 0) revert NoRewardAvailable();
    }

    function _claimAsset(address account, uint256 index) private returns (uint256 amount) {
        _updateAccount(account, index);
        amount = _accruedRewards[account][index];
        if (amount == 0) revert NoRewardAvailable();
        return _claimUpdatedAsset(account, index, amount);
    }

    function _claimUpdatedAsset(address account, uint256 index, uint256 amount) private returns (uint256) {
        _accruedRewards[account][index] = 0;
        _withdrawn[account][index] += amount;
        totalRewardsClaimed[index] += amount;
        _rewardAssets[index].safeTransfer(account, amount);
        emit RewardClaimed(account, index, address(_rewardAssets[index]), amount);
        return amount;
    }

    function _update(address from, address to, uint256 value) internal override {
        for (uint256 i; i < rewardAssetCount; ++i) {
            _updateAccount(from, i);
            if (to != from) _updateAccount(to, i);
        }
        super._update(from, to, value);
        if (value != 0) {
            bool fromEligible = from != address(0) && !isExcluded[from];
            bool toEligible = to != address(0) && !isExcluded[to];
            if (fromEligible && !toEligible) eligibleSupply -= value;
            if (!fromEligible && toEligible) eligibleSupply += value;
        }
        for (uint256 i; i < rewardAssetCount; ++i) {
            _reconcileEligibleSupply(i);
        }
    }

    function _updateAccount(address account, uint256 index) private {
        if (account != address(0) && !isExcluded[account]) {
            _accruedRewards[
                    account
                ][
                    index
                ] += (balanceOf(account) * (magnifiedRewardPerShare[index] - userRewardPerTokenPaid[account][index]))
                / MAGNITUDE;
            userRewardPerTokenPaid[account][index] = magnifiedRewardPerShare[index];
        }
    }

    function _reconcileEligibleSupply(uint256 index) private {
        if (eligibleSupply != 0 && pendingWithoutSupply[index] != 0) {
            _distributePending(index, eligibleSupply);
        }
    }

    function _distributePending(uint256 index, uint256 supply) private returns (uint256 distributed) {
        distributed = pendingWithoutSupply[index];
        pendingWithoutSupply[index] = 0;
        magnifiedRewardPerShare[index] += (distributed * MAGNITUDE) / supply;
        totalRewardsDistributed[index] += distributed;
        emit RewardDistributed(index, distributed, supply);
        emit RewardStreamUpdated(index, 0, block.timestamp, 0, supply);
    }

    function _validateAssetIndex(uint256 index) private view {
        if (index >= rewardAssetCount) revert InvalidAssetIndex(index);
    }

    function _validateTokenUri(string memory value) private pure {
        bytes memory uri = bytes(value);
        if (
            uri.length < 28 || uri.length > 140 || uri[0] != "i" || uri[1] != "p" || uri[2] != "f" || uri[3] != "s"
                || uri[4] != ":" || uri[5] != "/" || uri[6] != "/" || uri[7] != "b"
        ) revert InvalidTokenUri();
        for (uint256 i = 8; i < uri.length; ++i) {
            bytes1 character = uri[i];
            bool lowercase = character >= "a" && character <= "z";
            bool digit = character >= "2" && character <= "7";
            if (!lowercase && !digit) revert InvalidTokenUri();
        }
    }
}
