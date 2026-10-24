// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// UNCERTAIN: U-25
/// @title MockFrxUSD
/// @notice Test stand-in for frxUSD with 18 decimals and an open mint (FR-C18). The deploy script only deploys it
/// when the network config sets `frxUSD` to null, and never on Fraxtal mainnet (chain 252).
contract MockFrxUSD is ERC20 {
    /// @notice Deploys the mock token.
    constructor() ERC20("Mock frxUSD", "frxUSD") {}

    /// @notice Mints tokens to anyone. Backs "Simulate ASUC payout" on testnets (FR-B10).
    /// @param to The recipient.
    /// @param amount The amount, 18 decimals.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
