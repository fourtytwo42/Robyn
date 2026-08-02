// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract ScopedActivityEmitter {
    event Activity(uint256 indexed sequence);

    function emitActivity(uint256 sequence) external {
        emit Activity(sequence);
    }
}

contract ScopedPoolEmitter {
    event Initialize(
        bytes32 indexed id,
        address indexed currency0,
        address indexed currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint160 sqrtPriceX96,
        int24 tick
    );
    event ModifyLiquidity(
        bytes32 indexed id,
        address indexed sender,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        bytes32 salt
    );
    event Swap(
        bytes32 indexed id,
        address indexed sender,
        int128 amount0,
        int128 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick,
        uint24 fee
    );
    event Donate(bytes32 indexed id, address indexed sender, uint256 amount0, uint256 amount1);

    function emitSwap(bytes32 id, uint256 sequence) external {
        emit Swap(id, msg.sender, int128(int256(sequence)), -1, 1, 1, 0, 3_000);
    }

    function emitNoise(bytes32 id, uint256 count) external {
        for (uint256 index; index < count; ++index) {
            emit Swap(id, msg.sender, int128(int256(index + 1)), -1, 1, 1, 0, 3_000);
        }
    }
}

contract ScopedNoiseEmitter {
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function emitNoise(uint256 count) external {
        for (uint256 index; index < count; ++index) {
            emit Transfer(msg.sender, address(this), index + 1);
        }
    }
}

contract ScopedIndexerCoordinator {
    struct GraduationProfileSnapshot {
        uint64 version;
        uint256 targetGraduationNative;
        uint256 actualGraduationNative;
        uint256 maximumCurvePurchase;
        uint256 initialVirtualNativeReserve;
        uint256 terminalNativePerTokenX18;
        uint160 terminalSqrtPriceX96;
    }

    struct AtomicV4LaunchReceipt {
        address vault;
        address market;
        address adapter;
        address poolManager;
        bytes32 poolId;
        address positionManager;
        address hook;
        address locker;
        uint24 poolFeePips;
        int24 tickSpacing;
        bytes32 configurationHash;
        bytes32 launchSaltHash;
        bytes32 metadataUriHash;
        GraduationProfileSnapshot graduationProfile;
        bytes32 graduationProfileHash;
    }

    event AtomicV4LaunchCreated(
        uint256 indexed launchId, address indexed creator, address indexed token, AtomicV4LaunchReceipt receipt
    );

    function emitLaunchAndActivity(address token, address poolManager, bytes32 poolId) external {
        AtomicV4LaunchReceipt memory receipt = AtomicV4LaunchReceipt({
            vault: token,
            market: token,
            adapter: token,
            poolManager: poolManager,
            poolId: poolId,
            positionManager: address(0x1234),
            hook: address(0x5678),
            locker: token,
            poolFeePips: 3_000,
            tickSpacing: 60,
            configurationHash: keccak256("configuration"),
            launchSaltHash: keccak256("salt"),
            metadataUriHash: keccak256("metadata"),
            graduationProfile: GraduationProfileSnapshot({
                version: 1,
                targetGraduationNative: 0.01 ether,
                actualGraduationNative: 0.01 ether,
                maximumCurvePurchase: 0.001 ether,
                initialVirtualNativeReserve: 1,
                terminalNativePerTokenX18: 1,
                terminalSqrtPriceX96: 1
            }),
            graduationProfileHash: keccak256("profile")
        });
        emit AtomicV4LaunchCreated(1, msg.sender, token, receipt);
        ScopedActivityEmitter(token).emitActivity(1);
        ScopedPoolEmitter(poolManager).emitSwap(poolId, 1);
    }
}
