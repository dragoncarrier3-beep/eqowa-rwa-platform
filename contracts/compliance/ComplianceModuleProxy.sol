// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ComplianceModuleProxy
 * @notice Proxy that Eqowa's compliance modules are deployed behind.
 *
 * @dev A first-party equivalent of the upstream module proxy, built on
 * OpenZeppelin's MIT-licensed ERC1967Proxy, so that deploying an Eqowa module
 * pulls in no upstream licensed code. The implementation is set at construction
 * and `_data` initialises it in the same transaction.
 */
contract ComplianceModuleProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory _data) ERC1967Proxy(implementation, _data) {}
}
