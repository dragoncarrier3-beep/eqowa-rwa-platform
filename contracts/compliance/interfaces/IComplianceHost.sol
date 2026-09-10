// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @title IComplianceHost
 * @notice The only part of the modular compliance contract that Eqowa's
 * modules need to read.
 *
 * @dev Declared first-party, rather than importing the upstream interface, to
 * keep Eqowa's modules free of upstream licence obligations. Only the members
 * actually called are declared.
 */
interface IComplianceHost {
    /// @notice Address of the token this compliance contract governs.
    function getTokenBound() external view returns (address);
}

/**
 * @title ITokenSupply
 * @notice The only part of the token that Eqowa's modules need to read.
 */
interface ITokenSupply {
    /// @notice Total tokens in circulation.
    function totalSupply() external view returns (uint256);
}
