// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {IModularCompliance} from "../../trex/compliance/modular/IModularCompliance.sol";
import {AbstractModuleUpgradeable} from "../../trex/compliance/modular/modules/AbstractModuleUpgradeable.sol";
import {IToken} from "../../trex/token/IToken.sol";

/**
 * @title HolderCountCapModule
 * @notice Caps the number of distinct investors who may hold the token.
 *
 * Holders are counted per ONCHAINID identity rather than per wallet, so an
 * investor who spreads a position across several wallets still occupies a
 * single slot. That is the count a share register and a regulator care about.
 *
 * T-REX calls `transferred` before the token updates its balances, so the
 * module cannot read balances from the token at action time. It therefore
 * maintains its own per-identity balances purely to detect the two moments
 * that matter: an identity crossing from zero to non-zero, and back again.
 *
 * @dev A cap of zero blocks every incoming transfer. This is deliberate: a
 * compliance module should fail closed, so forgetting to configure the cap
 * halts issuance rather than silently allowing unlimited holders.
 */
contract HolderCountCapModule is AbstractModuleUpgradeable {
    /// Maximum number of distinct identities allowed, per compliance contract.
    mapping(address => uint256) private _maxHolderCount;

    /// Current number of identities holding a non-zero balance.
    mapping(address => uint256) private _holderCount;

    /// Balance held by each identity, tracked to detect zero crossings.
    mapping(address => mapping(address => uint256)) private _idBalance;

    /// Emitted when the cap is changed for a compliance contract.
    event MaxHolderCountSet(address indexed _compliance, uint256 _maxHolderCount);

    /// Emitted whenever the number of distinct holders changes.
    event HolderCountChanged(address indexed _compliance, uint256 _holderCount);

    /// Raised when an action would push the holder count above the cap.
    error MaxHolderCountExceeded(address _compliance, uint256 _maxHolderCount);

    /// Raised when a wallet involved in an action has no registered identity.
    error IdentityNotFound(address _compliance, address _userAddress);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Locks the implementation so it can only ever be used behind a proxy.
        _disableInitializers();
    }

    /**
     * @notice Initialises the module. Called once, by ModuleProxy's constructor.
     */
    function initialize() external initializer {
        __AbstractModule_init();
    }

    /**
     * @notice Sets the maximum number of distinct holders.
     * @dev Reachable only through `ModularCompliance.callModuleFunction`, so in
     * practice only the compliance owner, the Gnosis Safe, can call it.
     * Lowering the cap below the current count is allowed; existing holders are
     * left alone and no new holder can join until the count falls back below.
     * @param _max Maximum number of distinct ONCHAINID identities.
     */
    function setMaxHolderCount(uint256 _max) external onlyComplianceCall {
        _maxHolderCount[msg.sender] = _max;
        emit MaxHolderCountSet(msg.sender, _max);
    }

    /**
     * @dev See {IModule-moduleTransferAction}.
     */
    function moduleTransferAction(address _from, address _to, uint256 _value) external override onlyComplianceCall {
        address idFrom = _getIdentity(msg.sender, _from);
        address idTo = _getIdentity(msg.sender, _to);

        // Moving tokens between two wallets of the same investor leaves the
        // holder set untouched.
        if (idFrom == idTo) {
            return;
        }

        _credit(msg.sender, idTo, _value);
        _debit(msg.sender, idFrom, _value);

        _assertWithinCap(msg.sender);
    }

    /**
     * @dev See {IModule-moduleMintAction}.
     */
    function moduleMintAction(address _to, uint256 _value) external override onlyComplianceCall {
        _credit(msg.sender, _getIdentity(msg.sender, _to), _value);

        _assertWithinCap(msg.sender);
    }

    /**
     * @dev See {IModule-moduleBurnAction}.
     */
    function moduleBurnAction(address _from, uint256 _value) external override onlyComplianceCall {
        _debit(msg.sender, _getIdentity(msg.sender, _from), _value);
    }

    /**
     * @dev See {IModule-moduleCheck}. Returns true when the transfer would
     * leave the holder count at or below the cap.
     */
    function moduleCheck(
        address _from,
        address _to,
        uint256 _value,
        address _compliance
    ) external view override returns (bool) {
        if (_value == 0) {
            return true;
        }

        address idTo = _identityOrZero(_compliance, _to);
        if (idTo == address(0)) {
            return false;
        }

        // Topping up an existing holder never changes the count.
        if (_idBalance[_compliance][idTo] > 0) {
            return true;
        }

        uint256 projected = _holderCount[_compliance] + 1;

        // A mint has no sender, so it can never free a slot.
        if (_from != address(0)) {
            address idFrom = _identityOrZero(_compliance, _from);

            if (idFrom == idTo) {
                return true;
            }

            // A sender moving their entire position out frees their slot.
            if (idFrom != address(0) && _idBalance[_compliance][idFrom] == _value) {
                projected -= 1;
            }
        }

        return projected <= _maxHolderCount[_compliance];
    }

    /**
     * @notice Maximum number of distinct holders configured for a compliance.
     */
    function getMaxHolderCount(address _compliance) external view returns (uint256) {
        return _maxHolderCount[_compliance];
    }

    /**
     * @notice Current number of distinct identities holding a balance.
     */
    function getHolderCount(address _compliance) external view returns (uint256) {
        return _holderCount[_compliance];
    }

    /**
     * @notice Balance the module has recorded against an identity.
     */
    function getIDBalance(address _compliance, address _identity) external view returns (uint256) {
        return _idBalance[_compliance][_identity];
    }

    /**
     * @dev See {IModule-canComplianceBind}. The module can only start counting
     * from a clean slate, so it refuses to bind to a token that already has
     * holders it never observed.
     */
    function canComplianceBind(address _compliance) external view override returns (bool) {
        address tokenBound = IModularCompliance(_compliance).getTokenBound();

        if (tokenBound == address(0)) {
            return true;
        }

        return IToken(tokenBound).totalSupply() == 0;
    }

    /**
     * @dev See {IModule-isPlugAndPlay}. False, because binding depends on the
     * bound token having zero supply.
     */
    function isPlugAndPlay() external pure override returns (bool) {
        return false;
    }

    /**
     * @dev See {IModule-name}.
     */
    function name() public pure override returns (string memory _name) {
        return "HolderCountCapModule";
    }

    /**
     * @dev Adds to an identity's balance, counting a new holder if it was zero.
     */
    function _credit(address _compliance, address _identity, uint256 _value) private {
        if (_value == 0) {
            return;
        }

        uint256 balanceBefore = _idBalance[_compliance][_identity];
        _idBalance[_compliance][_identity] = balanceBefore + _value;

        if (balanceBefore == 0) {
            _holderCount[_compliance] += 1;
            emit HolderCountChanged(_compliance, _holderCount[_compliance]);
        }
    }

    /**
     * @dev Subtracts from an identity's balance, dropping the holder if it
     * reaches zero.
     */
    function _debit(address _compliance, address _identity, uint256 _value) private {
        if (_value == 0) {
            return;
        }

        uint256 balanceAfter = _idBalance[_compliance][_identity] - _value;
        _idBalance[_compliance][_identity] = balanceAfter;

        if (balanceAfter == 0) {
            _holderCount[_compliance] -= 1;
            emit HolderCountChanged(_compliance, _holderCount[_compliance]);
        }
    }

    /**
     * @dev Defence in depth. `moduleCheck` should already have rejected any
     * transfer that breaches the cap.
     */
    function _assertWithinCap(address _compliance) private view {
        if (_holderCount[_compliance] > _maxHolderCount[_compliance]) {
            revert MaxHolderCountExceeded(_compliance, _maxHolderCount[_compliance]);
        }
    }

    /**
     * @dev Resolves a wallet to its ONCHAINID, reverting when absent.
     */
    function _getIdentity(address _compliance, address _userAddress) private view returns (address) {
        address identity = _identityOrZero(_compliance, _userAddress);

        if (identity == address(0)) {
            revert IdentityNotFound(_compliance, _userAddress);
        }

        return identity;
    }

    /**
     * @dev Resolves a wallet to its ONCHAINID, returning zero when absent so
     * that view calls stay total.
     */
    function _identityOrZero(address _compliance, address _userAddress) private view returns (address) {
        address tokenBound = IModularCompliance(_compliance).getTokenBound();

        if (tokenBound == address(0)) {
            return address(0);
        }

        return address(IToken(tokenBound).identityRegistry().identity(_userAddress));
    }
}
