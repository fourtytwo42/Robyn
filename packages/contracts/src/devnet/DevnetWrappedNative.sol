// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local-only wrapped native asset used by the controlled Anvil venue.
contract DevnetWrappedNative is ERC20 {
    error NativeTransferFailed();

    constructor() ERC20("Wrapped Ether", "WETH") { }

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = msg.sender.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();
    }
}

