// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {AbstractComplianceModule} from "../AbstractComplianceModule.sol";
import {IComplianceHost, IInvestorRegistry, ITokenIdentityRegistry} from "../interfaces/IComplianceHost.sol";

/**
 * @title BalanceCapModule
 * @notice Caps how many tokens a single ONCHAINID may hold.
 *
 * The cap is per identity, not per wallet, so an investor cannot evade it by
 * spreading a position across several addresses. The module keeps its own
 * per-identity balances because token balances are per wallet and there is no
 * way to enumerate the wallets behind an ONCHAINID.
 *
 * A cap of zero blocks every incoming transfer, so a misconfigured deployment
 * fails closed.
 *
 * First-party MIT replacement for Tokeny's MaxBalanceModule, which carries a
 * Creative Commons NonCommercial clause.
 */
contract BalanceCapModule is AbstractComplianceModule {
    /// Maximum balance per identity, per compliance contract.
    mapping(address => uint256) private _maxBalance;

    /// Balance held by each identity, aggregated across its wallets.
    mapping(address => mapping(address => uint256)) private _idBalance;

    event MaxBalanceSet(address indexed _compliance, uint256 _maxBalance);

    error MaxBalanceExceeded(address _compliance, uint256 _value);
    error IdentityNotFound(address _compliance, address _userAddress);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __AbstractComplianceModule_init();
    }

    /**
     * @notice Sets the per-identity balance cap.
     * @dev Reachable only through `callModuleFunction`, so in production this
     * needs a Safe quorum. Lowering the cap does not force existing holders
     * to sell; it only blocks further incoming transfers that would exceed it.
     */
    function setMaxBalance(uint256 _max) external onlyComplianceCall {
        _maxBalance[msg.sender] = _max;
        emit MaxBalanceSet(msg.sender, _max);
    }

    function moduleTransferAction(address _from, address _to, uint256 _value) external override onlyComplianceCall {
        address idFrom = _getIdentity(msg.sender, _from);
        address idTo = _getIdentity(msg.sender, _to);

        if (idFrom == idTo) {
            return;
        }

        _idBalance[msg.sender][idTo] += _value;
        _idBalance[msg.sender][idFrom] -= _value;

        _assertWithinCap(msg.sender, idTo, _value);
    }

    function moduleMintAction(address _to, uint256 _value) external override onlyComplianceCall {
        address idTo = _getIdentity(msg.sender, _to);
        _idBalance[msg.sender][idTo] += _value;
        _assertWithinCap(msg.sender, idTo, _value);
    }

    function moduleBurnAction(address _from, uint256 _value) external override onlyComplianceCall {
        address idFrom = _getIdentity(msg.sender, _from);
        _idBalance[msg.sender][idFrom] -= _value;
    }

    /**
     * @dev See {IComplianceModule-moduleCheck}.
     */
    function moduleCheck(
        address _from,
        address _to,
        uint256 _value,
        address _compliance
    ) external view override returns (bool) {
        uint256 cap = _maxBalance[_compliance];

        if (_value > cap) {
            return false;
        }

        address idTo = _identityOrZero(_compliance, _to);

        if (idTo == address(0)) {
            return false;
        }

        // Moving tokens between wallets of the same investor does not
        // increase that identity's aggregate balance.
        if (_from != address(0) && _identityOrZero(_compliance, _from) == idTo) {
            return true;
        }

        return _idBalance[_compliance][idTo] + _value <= cap;
    }

    function getMaxBalance(address _compliance) external view returns (uint256) {
        return _maxBalance[_compliance];
    }

    function getIDBalance(address _compliance, address _identity) external view returns (uint256) {
        return _idBalance[_compliance][_identity];
    }

    function name() public pure override returns (string memory _name) {
        return "BalanceCapModule";
    }

    function _assertWithinCap(address _compliance, address _identity, uint256 _value) private view {
        if (_idBalance[_compliance][_identity] > _maxBalance[_compliance]) {
            revert MaxBalanceExceeded(_compliance, _value);
        }
    }

    function _getIdentity(address _compliance, address _userAddress) private view returns (address) {
        address identity = _identityOrZero(_compliance, _userAddress);

        if (identity == address(0)) {
            revert IdentityNotFound(_compliance, _userAddress);
        }

        return identity;
    }

    function _identityOrZero(address _compliance, address _userAddress) private view returns (address) {
        address tokenBound = IComplianceHost(_compliance).getTokenBound();

        if (tokenBound == address(0)) {
            return address(0);
        }

        address registry = ITokenIdentityRegistry(tokenBound).identityRegistry();

        if (registry == address(0)) {
            return address(0);
        }

        return IInvestorRegistry(registry).identity(_userAddress);
    }
}
