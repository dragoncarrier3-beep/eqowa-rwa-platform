// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {IComplianceModule} from "./interfaces/IComplianceModule.sol";
import {IComplianceHost, ITokenSupply} from "./interfaces/IComplianceHost.sol";

/**
 * @title AbstractComplianceModule
 * @notice Base class for Eqowa's compliance modules, handling the binding
 * handshake with a modular compliance contract and the upgrade authority.
 *
 * @dev This is a first-party replacement for the upstream T-REX module base,
 * built only on MIT-licensed OpenZeppelin primitives so that modules derived
 * from it carry no upstream licence obligations. Behaviour matches what an
 * ERC-3643 compliance contract expects, since it dispatches by ABI selector.
 *
 * Derived modules must implement the four module hooks and `name`.
 */
abstract contract AbstractComplianceModule is IComplianceModule, Initializable, OwnableUpgradeable, UUPSUpgradeable {
    /// Compliance contracts currently bound to this module.
    mapping(address => bool) private _complianceBound;

    /// Reserved so this base can gain state without shifting derived storage.
    uint256[49] private __gap;

    /// Raised when a zero address is supplied where a contract is required.
    error ZeroAddress();

    /// Raised when binding a compliance contract that is already bound.
    error ComplianceAlreadyBound(address _compliance);

    /// Raised when a caller other than the compliance contract itself calls in.
    error CallerIsNotTheCompliance(address _caller);

    /// Raised when the caller is not a compliance contract bound to this module.
    error ComplianceNotBound(address _compliance);

    /**
     * @dev Restricts a function to compliance contracts bound to this module.
     * Combined with the compliance contract's own `onlyOwner` on
     * `callModuleFunction`, this means only the Safe can reach such functions.
     */
    modifier onlyComplianceCall() {
        if (!_complianceBound[msg.sender]) {
            revert ComplianceNotBound(msg.sender);
        }
        _;
    }

    /**
     * @inheritdoc IComplianceModule
     */
    function bindCompliance(address _compliance) external override {
        if (_compliance == address(0)) {
            revert ZeroAddress();
        }
        if (msg.sender != _compliance) {
            revert CallerIsNotTheCompliance(msg.sender);
        }
        if (_complianceBound[_compliance]) {
            revert ComplianceAlreadyBound(_compliance);
        }

        _complianceBound[_compliance] = true;
        emit ComplianceBound(_compliance);
    }

    /**
     * @inheritdoc IComplianceModule
     */
    function unbindCompliance(address _compliance) external override {
        if (msg.sender != _compliance) {
            revert CallerIsNotTheCompliance(msg.sender);
        }
        if (!_complianceBound[_compliance]) {
            revert ComplianceNotBound(_compliance);
        }

        _complianceBound[_compliance] = false;
        emit ComplianceUnbound(_compliance);
    }

    /**
     * @inheritdoc IComplianceModule
     */
    function isComplianceBound(address _compliance) external view override returns (bool) {
        return _complianceBound[_compliance];
    }

    /**
     * @inheritdoc IComplianceModule
     * @dev Modules that keep their own running totals can only account for
     * activity they observed, so binding is refused once the token has supply.
     * Override in a module whose accounting is stateless.
     */
    function canComplianceBind(address _compliance) external view virtual override returns (bool) {
        address tokenBound = IComplianceHost(_compliance).getTokenBound();

        if (tokenBound == address(0)) {
            return true;
        }

        return ITokenSupply(tokenBound).totalSupply() == 0;
    }

    /**
     * @inheritdoc IComplianceModule
     */
    function isPlugAndPlay() external pure virtual override returns (bool) {
        return false;
    }

    // solhint-disable-next-line func-name-mixedcase
    function __AbstractComplianceModule_init() internal onlyInitializing {
        __Ownable_init();
    }

    function _authorizeUpgrade(address /*newImplementation*/) internal override onlyOwner {}
}
