// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Project-owned wrapped native token for chain-46630 testing only.
/// @dev This is not an official Robinhood or Uniswap deployment.
contract TestnetWETH9 is ERC20 {
    string public constant TESTNET_PROVENANCE = "robyn-controlled-uniswap-v3-testnet";

    constructor() ERC20("Robyn Testnet Wrapped Ether", "rtWETH") { }

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = msg.sender.call{ value: amount }("");
        require(sent, "native transfer failed");
    }
}
