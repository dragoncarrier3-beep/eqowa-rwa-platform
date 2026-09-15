// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice 6-decimal stand-in for native Polygon USDT. Amoy has no official
 * USDT. Tests and Milestone 3 use this. Not for mainnet.
 */
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
