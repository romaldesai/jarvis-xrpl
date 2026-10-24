// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockRLUSD
/// @notice TESTNET ONLY stand-in for RLUSD (18 decimals). Not the real Ripple USD token.
contract MockRLUSD is ERC20, Ownable {
    uint256 public constant FAUCET_LIMIT = 1_000 ether;

    constructor(address admin) ERC20("Mock RLUSD (testnet)", "RLUSD") Ownable(admin) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Anyone can grab up to 1,000 test RLUSD per call. Testnet convenience.
    function faucet(uint256 amount) external {
        require(amount <= FAUCET_LIMIT, "faucet limit");
        _mint(msg.sender, amount);
    }
}
