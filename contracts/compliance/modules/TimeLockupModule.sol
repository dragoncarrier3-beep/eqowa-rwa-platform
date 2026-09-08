// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {IModularCompliance} from "../../trex/compliance/modular/IModularCompliance.sol";
import {AbstractModuleUpgradeable} from "../../trex/compliance/modular/modules/AbstractModuleUpgradeable.sol";
import {IToken} from "../../trex/token/IToken.sol";

/**
 * @title TimeLockupModule
 * @notice Locks each minted tranche for a fixed period measured from its own
 * mint, so an investor's tokens unlock progressively rather than all at once.
 *
 * Every mint records a tranche of (amount, releaseTime). An investor may move
 * their balance less the total still-locked amount. Tranches are held per
 * ONCHAINID rather than per wallet, so the lock survives an investor moving
 * between their own wallets and survives `recoveryAddress`.
 *
 * Tokens arriving by transfer are not re-locked. They do not need to be: the
 * module refuses to let locked tokens be transferred in the first place, so
 * anything that arrives has already served its lock-up.
 *
 * @dev A duration of zero disables the lock-up for future mints. Unlike a
 * holder cap, an unset duration is the permissive case, so the deploy script
 * must set it explicitly. Existing tranches keep the duration they were
 * created with; changing the duration never retro-dates a lock.
 */
contract TimeLockupModule is AbstractModuleUpgradeable {
    /// A parcel of tokens locked until `releaseTime`. Packs into one slot.
    struct Tranche {
        uint128 amount;
        uint64 releaseTime;
    }

    /// Lock-up applied to new mints, in seconds, per compliance contract.
    mapping(address => uint256) private _lockupDuration;

    /// Balance held by each identity, aggregated across all its wallets.
    mapping(address => mapping(address => uint256)) private _idBalance;

    /// Lock-up tranches per identity, appended in mint order.
    mapping(address => mapping(address => Tranche[])) private _tranches;

    /// Index of the first tranche still worth reading; everything before is spent or expired.
    mapping(address => mapping(address => uint256)) private _cursor;

    /// Emitted when the lock-up applied to future mints changes.
    event LockupDurationSet(address indexed _compliance, uint256 _duration);

    /// Emitted when a mint puts a new tranche under lock.
    event TrancheLocked(address indexed _compliance, address indexed _identity, uint256 _amount, uint256 _releaseTime);

    /// Emitted when a forced transfer carries locked tokens to another identity.
    event LockedTokensMoved(address indexed _compliance, address indexed _from, address indexed _to, uint256 _amount);

    /// Emitted when the compliance owner releases a lock ahead of its term.
    event LockupWaived(address indexed _compliance, address indexed _identity, uint256 _amount);

    /// Raised when a single mint is larger than a tranche can represent.
    error AmountExceedsTrancheLimit(uint256 _value);

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
     * @notice Sets the lock-up applied to tranches minted from now on.
     * @dev Reachable only through `ModularCompliance.callModuleFunction`, so in
     * practice only the compliance owner, the Gnosis Safe, can call it.
     * Tranches already under lock are untouched, so shortening the duration
     * cannot release existing holders early and lengthening it cannot trap them.
     * @param _duration Lock-up in seconds. Zero mints future tranches unlocked.
     */
    function setLockupDuration(uint256 _duration) external onlyComplianceCall {
        _lockupDuration[msg.sender] = _duration;
        emit LockupDurationSet(msg.sender, _duration);
    }

    /**
     * @notice Releases an investor's locked tokens ahead of their term.
     * @dev Reachable only through `ModularCompliance.callModuleFunction`, so in
     * practice this needs a Gnosis Safe quorum. It exists for the cases a
     * lock-up cannot anticipate: a court order, an estate passing to heirs, or
     * a regulator-approved exemption. It frees tokens without minting or
     * burning any, so the investor's balance is unchanged.
     *
     * Tranches are released soonest-to-unlock first, so a partial waiver
     * leaves the longest-dated tranches locked. Passing an amount at or above
     * the identity's locked total clears the lock entirely.
     * @param _identity ONCHAINID of the investor being released.
     * @param _amount Maximum amount to release.
     */
    function waiveLockup(address _identity, uint256 _amount) external onlyComplianceCall {
        uint256 waived = _consumeLocked(msg.sender, _identity, address(0), _amount);
        emit LockupWaived(msg.sender, _identity, waived);
    }

    /**
     * @dev See {IModule-moduleTransferAction}.
     */
    function moduleTransferAction(address _from, address _to, uint256 _value) external override onlyComplianceCall {
        address idFrom = _getIdentity(msg.sender, _from);
        address idTo = _getIdentity(msg.sender, _to);

        // Moving tokens between two wallets of the same investor changes
        // nothing: the tranches already sit against that one identity.
        if (idFrom == idTo) {
            return;
        }

        uint256 balanceFrom = _idBalance[msg.sender][idFrom];
        uint256 remaining = balanceFrom - _value;

        _idBalance[msg.sender][idFrom] = remaining;
        _idBalance[msg.sender][idTo] += _value;

        _prune(msg.sender, idFrom);

        uint256 locked = _lockedAmount(msg.sender, idFrom);

        // Only reachable through forcedTransfer and recoveryAddress, which move
        // tokens without consulting canTransfer. Carry the lock across to the
        // recipient so a forced move cannot be used to free locked tokens.
        if (locked > remaining) {
            uint256 carried = _consumeLocked(msg.sender, idFrom, idTo, locked - remaining);
            emit LockedTokensMoved(msg.sender, idFrom, idTo, carried);
        }
    }

    /**
     * @dev See {IModule-moduleMintAction}. Each mint starts its own lock-up.
     */
    function moduleMintAction(address _to, uint256 _value) external override onlyComplianceCall {
        address idTo = _getIdentity(msg.sender, _to);

        _prune(msg.sender, idTo);
        _idBalance[msg.sender][idTo] += _value;

        uint256 duration = _lockupDuration[msg.sender];

        if (duration == 0 || _value == 0) {
            return;
        }

        _pushTranche(msg.sender, idTo, _value, block.timestamp + duration);
    }

    /**
     * @dev See {IModule-moduleBurnAction}. Burning through a lock destroys the
     * locked tranches along with the tokens.
     */
    function moduleBurnAction(address _from, uint256 _value) external override onlyComplianceCall {
        address idFrom = _getIdentity(msg.sender, _from);

        uint256 remaining = _idBalance[msg.sender][idFrom] - _value;
        _idBalance[msg.sender][idFrom] = remaining;

        _prune(msg.sender, idFrom);

        uint256 locked = _lockedAmount(msg.sender, idFrom);

        if (locked > remaining) {
            _consumeLocked(msg.sender, idFrom, address(0), locked - remaining);
        }
    }

    /**
     * @dev See {IModule-moduleCheck}. Allows a transfer only out of the
     * sender's unlocked balance.
     */
    function moduleCheck(
        address _from,
        address /*_to*/,
        uint256 _value,
        address _compliance
    ) external view override returns (bool) {
        // Minting is what creates a lock-up, so it is never blocked by one.
        if (_from == address(0) || _value == 0) {
            return true;
        }

        address idFrom = _identityOrZero(_compliance, _from);

        if (idFrom == address(0)) {
            return false;
        }

        return _value <= _spendableAmount(_compliance, idFrom);
    }

    /**
     * @notice Lock-up in seconds applied to new mints under this compliance.
     */
    function getLockupDuration(address _compliance) external view returns (uint256) {
        return _lockupDuration[_compliance];
    }

    /**
     * @notice Balance the module has recorded against an identity.
     */
    function getIDBalance(address _compliance, address _identity) external view returns (uint256) {
        return _idBalance[_compliance][_identity];
    }

    /**
     * @notice Total still under lock for an identity at the current block.
     */
    function getLockedAmount(address _compliance, address _identity) external view returns (uint256) {
        return _lockedAmount(_compliance, _identity);
    }

    /**
     * @notice Amount an identity may transfer right now.
     */
    function getSpendableAmount(address _compliance, address _identity) external view returns (uint256) {
        return _spendableAmount(_compliance, _identity);
    }

    /**
     * @notice Outstanding lock-up tranches for an identity, for statements and
     * the operations runbook.
     * @return amounts Locked amount of each tranche.
     * @return releaseTimes Timestamp at which each tranche unlocks.
     */
    function getLockedTranches(
        address _compliance,
        address _identity
    ) external view returns (uint256[] memory amounts, uint256[] memory releaseTimes) {
        Tranche[] storage list = _tranches[_compliance][_identity];
        uint256 length = list.length;
        uint256 start = _cursor[_compliance][_identity];
        uint256 live;

        for (uint256 i = start; i < length; i++) {
            if (_isLive(list[i])) {
                live++;
            }
        }

        amounts = new uint256[](live);
        releaseTimes = new uint256[](live);
        uint256 next;

        for (uint256 i = start; i < length; i++) {
            if (_isLive(list[i])) {
                amounts[next] = list[i].amount;
                releaseTimes[next] = list[i].releaseTime;
                next++;
            }
        }
    }

    /**
     * @dev See {IModule-canComplianceBind}. The module can only account for
     * mints it observed, so it refuses a token that already has supply.
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
        return "TimeLockupModule";
    }

    /**
     * @dev Records a new locked tranche against an identity.
     */
    function _pushTranche(address _compliance, address _identity, uint256 _amount, uint256 _releaseTime) private {
        if (_amount > type(uint128).max) {
            revert AmountExceedsTrancheLimit(_amount);
        }

        _tranches[_compliance][_identity].push(
            Tranche({amount: uint128(_amount), releaseTime: uint64(_releaseTime)})
        );

        emit TrancheLocked(_compliance, _identity, _amount, _releaseTime);
    }

    /**
     * @dev Takes up to `_amount` out of an identity's live tranches, soonest to
     * unlock first. When `_to` is set the tranches are re-created against it
     * with their original release times; otherwise they are discarded. Only
     * the lock is touched, never a balance.
     * @return consumed Amount actually released, which is lower than `_amount`
     * when the identity had less than that under lock.
     */
    function _consumeLocked(
        address _compliance,
        address _from,
        address _to,
        uint256 _amount
    ) private returns (uint256 consumed) {
        Tranche[] storage list = _tranches[_compliance][_from];
        uint256 length = list.length;
        uint256 index = _cursor[_compliance][_from];
        uint256 outstanding = _amount;

        while (outstanding > 0 && index < length) {
            Tranche storage tranche = list[index];

            if (!_isLive(tranche)) {
                index++;
                continue;
            }

            uint256 taken = tranche.amount <= outstanding ? tranche.amount : outstanding;
            tranche.amount -= uint128(taken);
            outstanding -= taken;

            if (_to != address(0)) {
                _pushTranche(_compliance, _to, taken, tranche.releaseTime);
            }

            if (tranche.amount == 0) {
                index++;
            }
        }

        consumed = _amount - outstanding;
    }

    /**
     * @dev Advances the cursor past tranches that are spent or expired, so the
     * scans above stay short for long-lived holders.
     */
    function _prune(address _compliance, address _identity) private {
        Tranche[] storage list = _tranches[_compliance][_identity];
        uint256 length = list.length;

        if (length == 0) {
            return;
        }

        uint256 index = _cursor[_compliance][_identity];

        while (index < length && !_isLive(list[index])) {
            index++;
        }

        if (index == length) {
            delete _tranches[_compliance][_identity];
            _cursor[_compliance][_identity] = 0;
            return;
        }

        if (index != _cursor[_compliance][_identity]) {
            _cursor[_compliance][_identity] = index;
        }
    }

    /**
     * @dev Sum of an identity's tranches that have not yet reached release.
     */
    function _lockedAmount(address _compliance, address _identity) private view returns (uint256 locked) {
        Tranche[] storage list = _tranches[_compliance][_identity];
        uint256 length = list.length;

        for (uint256 i = _cursor[_compliance][_identity]; i < length; i++) {
            if (_isLive(list[i])) {
                locked += list[i].amount;
            }
        }
    }

    /**
     * @dev Balance an identity may move. Clamped at zero so a forced transfer
     * that outruns the ledger can never underflow.
     */
    function _spendableAmount(address _compliance, address _identity) private view returns (uint256) {
        uint256 balance = _idBalance[_compliance][_identity];
        uint256 locked = _lockedAmount(_compliance, _identity);

        return balance > locked ? balance - locked : 0;
    }

    /**
     * @dev A tranche still holds tokens and has not reached its release time.
     */
    function _isLive(Tranche storage _tranche) private view returns (bool) {
        return _tranche.amount > 0 && _tranche.releaseTime > block.timestamp;
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
