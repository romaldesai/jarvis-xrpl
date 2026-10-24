// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockRLUSD
/// @notice TESTNET ONLY stand-in for RLUSD (decimals set at deploy). Not the real Ripple USD token.
contract MockRLUSD is ERC20, Ownable {
    uint8 private immutable _decimals;
    uint256 public immutable FAUCET_LIMIT;

    /// @param decimals_ 18 (RLUSD on EVM chains) by default in our scripts; configurable via RLUSD_DECIMALS.
    constructor(address admin, uint8 decimals_) ERC20("Mock RLUSD (testnet)", "mRLUSD") Ownable(admin) {
        require(decimals_ >= 2 && decimals_ <= 18, "decimals");
        _decimals = decimals_;
        FAUCET_LIMIT = 1_000 * 10 ** uint256(decimals_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Anyone can grab up to 1,000 test RLUSD per call. Testnet convenience.
    function faucet(uint256 amount) external {
        require(amount <= FAUCET_LIMIT, "faucet limit");
        _mint(msg.sender, amount);
    }
}
