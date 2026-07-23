// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { FeeBasketVault } from "../FeeBasketVault.sol";
import { RobynProtocolFeeRouter } from "../dao/RobynProtocolFeeRouter.sol";
import { INonfungiblePositionManager } from "./UniswapV3Interfaces.sol";

/// @notice Permanently locks one Uniswap v3 position while permissionlessly harvesting fees.
/// @dev This contract intentionally exposes no NFT approval/transfer or liquidity-decrease path.
contract RewardFeePositionLocker is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant CONTRACT_VERSION = "1.0.0";

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidPosition();
    error PositionAlreadyBound();
    error PositionNotBound();
    error EmptyHarvest();
    error FeeRouterAlreadyBound();
    error InvalidAmount();

    INonfungiblePositionManager public immutable positionManager;
    IERC20 public immutable baseAsset;
    IERC20 public immutable launchToken;
    FeeBasketVault public immutable feeVault;
    address public immutable graduationAdapter;
    uint24 public immutable poolFee;

    uint256 public positionTokenId;
    uint256 public cumulativeBaseFees;
    uint256 public cumulativeLaunchTokenFeesLocked;
    uint256 public pendingLaunchTokenFees;
    bool public positionBound;
    RobynProtocolFeeRouter public feeRouter;

    event PositionBound(
        uint256 indexed tokenId,
        address indexed token0,
        address indexed token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper
    );
    event FeesHarvested(
        address indexed caller,
        uint256 baseFeesRouted,
        uint256 launchTokenFeesLocked,
        uint256 cumulativeBaseFees,
        uint256 cumulativeLaunchTokenFeesLocked
    );
    event FeeRouterBound(address indexed feeRouter);
    event LaunchFeesConverted(address indexed caller, uint256 launchAmount, uint256 baseOutput);

    constructor(
        INonfungiblePositionManager positionManager_,
        IERC20 baseAsset_,
        IERC20 launchToken_,
        FeeBasketVault feeVault_,
        address graduationAdapter_,
        uint24 poolFee_
    ) {
        if (
            address(positionManager_) == address(0) || address(baseAsset_) == address(0)
                || address(launchToken_) == address(0) || address(feeVault_) == address(0)
                || graduationAdapter_ == address(0) || poolFee_ == 0
                || address(feeVault_.baseAsset()) != address(baseAsset_)
                || address(feeVault_.launchToken()) != address(launchToken_)
        ) revert InvalidConfiguration();
        positionManager = positionManager_;
        baseAsset = baseAsset_;
        launchToken = launchToken_;
        feeVault = feeVault_;
        graduationAdapter = graduationAdapter_;
        poolFee = poolFee_;
    }

    function bindFeeRouter(RobynProtocolFeeRouter feeRouter_) external {
        if (msg.sender != graduationAdapter) revert Unauthorized();
        if (address(feeRouter) != address(0)) revert FeeRouterAlreadyBound();
        if (
            positionBound || address(feeRouter_) == address(0)
                || address(feeRouter_).code.length == 0
        ) {
            revert InvalidConfiguration();
        }
        feeRouter = feeRouter_;
        emit FeeRouterBound(address(feeRouter_));
    }

    function onERC721Received(address operator, address, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        if (msg.sender != address(positionManager) || operator != graduationAdapter) {
            revert Unauthorized();
        }
        _bindPosition(tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Binds a position minted directly to this locker by canonical Uniswap v3.
    /// @dev The canonical position manager uses ERC721 `_mint`, so no receiver callback occurs.
    function bindPosition(uint256 tokenId) external {
        if (msg.sender != graduationAdapter) revert Unauthorized();
        if (positionBound && positionTokenId == tokenId) return;
        _bindPosition(tokenId);
    }

    function _bindPosition(uint256 tokenId) private {
        if (positionBound) revert PositionAlreadyBound();
        if (positionManager.ownerOf(tokenId) != address(this)) revert InvalidPosition();

        (,, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper,,,,,) =
            positionManager.positions(tokenId);
        bool validPair = (token0 == address(baseAsset) && token1 == address(launchToken))
            || (token0 == address(launchToken) && token1 == address(baseAsset));
        if (!validPair || fee != poolFee || tickLower >= tickUpper) revert InvalidPosition();

        positionTokenId = tokenId;
        positionBound = true;
        emit PositionBound(tokenId, token0, token1, fee, tickLower, tickUpper);
    }

    /// @notice Collects every accrued fee. Quote-side fees fund the basket; launch-token fees stay locked.
    function harvest() external nonReentrant returns (uint256 baseFees, uint256 launchFees) {
        if (!positionBound) revert PositionNotBound();
        uint256 baseBefore = baseAsset.balanceOf(address(this));
        uint256 launchBefore = launchToken.balanceOf(address(this));
        // The complete harvest is nonReentrant. Post-collect balance deltas are
        // required because the canonical position manager does not return them.
        // slither-disable-next-line reentrancy-balance
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionTokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        baseFees = baseAsset.balanceOf(address(this)) - baseBefore;
        launchFees = launchToken.balanceOf(address(this)) - launchBefore;
        if (baseFees == 0 && launchFees == 0) revert EmptyHarvest();

        if (baseFees != 0) {
            cumulativeBaseFees += baseFees;
            if (address(feeRouter) == address(0)) {
                baseAsset.forceApprove(address(feeVault), baseFees);
                feeVault.recordFees(baseFees);
                baseAsset.forceApprove(address(feeVault), 0);
            } else {
                baseAsset.forceApprove(address(feeRouter), baseFees);
                feeRouter.routeBaseFees(launchToken, baseFees);
                baseAsset.forceApprove(address(feeRouter), 0);
            }
        }
        if (launchFees != 0) {
            cumulativeLaunchTokenFeesLocked += launchFees;
            pendingLaunchTokenFees += launchFees;
        }
        emit FeesHarvested(
            msg.sender, baseFees, launchFees, cumulativeBaseFees, cumulativeLaunchTokenFeesLocked
        );
    }

    function convertLaunchFees(uint256 amount, uint256 minimumBaseOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 baseOut)
    {
        if (address(feeRouter) == address(0)) revert InvalidConfiguration();
        if (amount == 0 || amount > pendingLaunchTokenFees || minimumBaseOut == 0) {
            revert InvalidAmount();
        }
        pendingLaunchTokenFees -= amount;
        launchToken.forceApprove(address(feeRouter), amount);
        baseOut = feeRouter.convertAndRouteLaunchFees(launchToken, amount, minimumBaseOut, deadline);
        launchToken.forceApprove(address(feeRouter), 0);
        emit LaunchFeesConverted(msg.sender, amount, baseOut);
    }
}
