// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Operator-minted test asset for the Robinhood testnet rehearsal only.
/// @dev This contract is forbidden from mainnet deployment manifests.
contract TestnetMockERC20 is ERC20, Ownable {
    string public constant TESTNET_MOCK_ONLY = "robinhood-testnet-mock";
    uint256 public immutable faucetAmount;
    mapping(address => bool) public faucetClaimed;

    error FaucetDisabled();
    error FaucetAlreadyClaimed();
    error InvalidRecipient();

    event FaucetClaimed(address indexed recipient, uint256 amount);

    constructor(string memory name_, string memory symbol_, address owner_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        faucetAmount = faucetAmount_;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function claimFaucet(address recipient) external {
        if (faucetAmount == 0) revert FaucetDisabled();
        if (recipient == address(0)) revert InvalidRecipient();
        if (faucetClaimed[recipient]) revert FaucetAlreadyClaimed();
        faucetClaimed[recipient] = true;
        _mint(recipient, faucetAmount);
        emit FaucetClaimed(recipient, faucetAmount);
    }
}
