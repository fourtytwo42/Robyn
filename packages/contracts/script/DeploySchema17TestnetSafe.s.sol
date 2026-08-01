// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

interface ISchema17SafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISchema17SafeSetup {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory array, address next);
}

/// @notice Deploys a canonical, module-free 1-of-1 Safe for Schema-17 Testnet qualification.
contract DeploySchema17TestnetSafe is Script {
    address private constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address private constant SAFE_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address private constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address private constant SENTINEL_OWNERS = address(0x1);

    function run() external {
        require(block.chainid == 46630, "Testnet Safe chain mismatch");
        address owner = vm.envAddress("SCHEMA17_SAFE_OWNER");
        uint256 saltNonce = vm.envUint("SCHEMA17_SAFE_SALT_NONCE");
        require(owner != address(0), "Safe owner required");
        require(SAFE_PROXY_FACTORY.code.length != 0, "Safe factory missing");
        require(SAFE_SINGLETON.code.length != 0, "Safe singleton missing");
        require(FALLBACK_HANDLER.code.length != 0, "Safe fallback missing");

        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory initializer = abi.encodeCall(
            ISchema17SafeSetup.setup,
            (owners, 1, address(0), bytes(""), FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );
        vm.startBroadcast();
        address safe = ISchema17SafeProxyFactory(SAFE_PROXY_FACTORY)
            .createProxyWithNonce(SAFE_SINGLETON, initializer, saltNonce);
        vm.stopBroadcast();

        require(safe.code.length != 0, "Safe proxy missing");
        address[] memory actualOwners = ISchema17SafeSetup(safe).getOwners();
        require(actualOwners.length == 1 && actualOwners[0] == owner, "Safe owner mismatch");
        require(ISchema17SafeSetup(safe).getThreshold() == 1, "Safe threshold mismatch");
        (address[] memory modules, address next) =
            ISchema17SafeSetup(safe).getModulesPaginated(SENTINEL_OWNERS, 10);
        require(modules.length == 0 && next == SENTINEL_OWNERS, "unexpected Safe module");
        console2.log("SCHEMA17_TESTNET_SAFE", safe);
    }
}
