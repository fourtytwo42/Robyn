// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Operator-minted test asset for the controlled Robyn devnet only.
/// @dev This contract is forbidden from testnet and production deployment manifests.
contract DevnetMockERC20 is ERC20, Ownable {
    string public constant DEVNET_ONLY = "robyn-devnet";

    constructor(string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    { }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
