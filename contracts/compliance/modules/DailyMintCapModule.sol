// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {AbstractComplianceModule} from "../AbstractComplianceModule.sol";

/**
 * @title DailyMintCapModule
 * @notice Caps how much of a token may be minted within any rolling 24 hours.
 *
 * The cap is global across the whole token, not per investor, so it bounds
 * total issuance velocity. Its purpose is to contain damage: a scripting error
 * or a compromised agent key can mint at most one day's cap before the Safe
 * has a chance to intervene.
 *
 * The window is rolling rather than calendar-based on purpose. A cap that
 * resets at midnight can be doubled by minting either side of the boundary,
 * so a rolling window is measured against each individual mint's own age.
 *
 * Only mints are counted. Transfers are unaffected, and burning does not
 * restore allowance, because the cap limits issuance rate rather than net
 * supply.
 *
 * @dev A cap of zero blocks all minting. This is deliberate: a compliance
 * module should fail closed, so an unconfigured cap halts issuance rather
 * than leaving it unbounded.
 *
 * Built on first-party interfaces and MIT-licensed OpenZeppelin primitives
 * only, so it carries no upstream T-REX licence obligations.
 */
contract DailyMintCapModule is AbstractComplianceModule {
    /// A single mint, retained only until it ages out of the window.
    struct MintRecord {
        uint128 amount;
        uint64 timestamp;
    }

    /// Rolling period the cap is measured over.
    uint256 public constant MINT_WINDOW = 24 hours;

    /// Maximum mintable within one window, per compliance contract.
    mapping(address => uint256) private _mintCap;

    /// Mint history per compliance contract, appended in chronological order.
    mapping(address => MintRecord[]) private _mints;

    /// Index of the first record still inside the window.
    mapping(address => uint256) private _cursor;

    /// Emitted when the cap applied to a compliance contract changes.
    event DailyMintCapSet(address indexed _compliance, uint256 _cap);

    /// Emitted for each mint the module records.
    event MintRecorded(address indexed _compliance, uint256 _amount, uint256 _mintedInWindow);

    /// Raised when a mint would breach the cap for the current window.
    error DailyMintCapExceeded(address _compliance, uint256 _requested, uint256 _remaining);

    /// Raised when a single mint is larger than a record can represent.
    error AmountExceedsRecordLimit(uint256 _value);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Locks the implementation so it can only ever be used behind a proxy.
        _disableInitializers();
    }

    /**
     * @notice Initialises the module. Called once, by the proxy constructor.
     */
    function initialize() external initializer {
        __AbstractComplianceModule_init();
    }

    /**
     * @notice Sets the maximum mintable within any rolling 24 hours.
     * @dev Reachable only through the compliance contract's
     * `callModuleFunction`, so in production this needs a Safe quorum.
     * Lowering the cap does not undo mints already recorded; it only
     * constrains what may still be minted in the current window.
     * @param _cap Maximum amount in base units. Zero blocks all minting.
     */
    function setDailyMintCap(uint256 _cap) external onlyComplianceCall {
        _mintCap[msg.sender] = _cap;
        emit DailyMintCapSet(msg.sender, _cap);
    }

    /**
     * @dev See {IComplianceModule-moduleTransferAction}. Transfers move
     * existing supply and are never capped here.
     */
    function moduleTransferAction(
        address /*_from*/,
        address /*_to*/,
        uint256 /*_value*/
    ) external override onlyComplianceCall {}

    /**
     * @dev See {IComplianceModule-moduleMintAction}. Records the mint against
     * the current window. The check is repeated here as defence in depth;
     * `moduleCheck` should already have rejected anything over the cap.
     */
    function moduleMintAction(address /*_to*/, uint256 _value) external override onlyComplianceCall {
        _prune(msg.sender);

        uint256 minted = _mintedInWindow(msg.sender);
        uint256 cap = _mintCap[msg.sender];

        if (minted + _value > cap) {
            revert DailyMintCapExceeded(msg.sender, _value, cap > minted ? cap - minted : 0);
        }

        _record(msg.sender, _value);
    }

    /**
     * @dev See {IComplianceModule-moduleBurnAction}. Burning does not return
     * allowance. The cap limits issuance rate, so a mint and burn pair still
     * consumes the day's budget.
     */
    function moduleBurnAction(address /*_from*/, uint256 /*_value*/) external override onlyComplianceCall {}

    /**
     * @dev See {IComplianceModule-moduleCheck}. Only mints are subject to the
     * cap, so anything with a real sender passes straight through.
     */
    function moduleCheck(
        address _from,
        address /*_to*/,
        uint256 _value,
        address _compliance
    ) external view override returns (bool) {
        if (_from != address(0) || _value == 0) {
            return true;
        }

        return _mintedInWindow(_compliance) + _value <= _mintCap[_compliance];
    }

    /**
     * @notice Cap configured for a compliance contract.
     */
    function getDailyMintCap(address _compliance) external view returns (uint256) {
        return _mintCap[_compliance];
    }

    /**
     * @notice Amount minted within the last 24 hours.
     */
    function getMintedInWindow(address _compliance) external view returns (uint256) {
        return _mintedInWindow(_compliance);
    }

    /**
     * @notice Amount still mintable right now, for the agent's dashboard.
     */
    function getRemainingAllowance(address _compliance) external view returns (uint256) {
        uint256 cap = _mintCap[_compliance];
        uint256 minted = _mintedInWindow(_compliance);

        return cap > minted ? cap - minted : 0;
    }

    /**
     * @notice Timestamp at which the oldest in-window mint ages out, freeing
     * allowance. Zero when nothing is currently counted.
     */
    function getNextReleaseTime(address _compliance) external view returns (uint256) {
        MintRecord[] storage list = _mints[_compliance];
        uint256 length = list.length;
        uint256 cutoff = _windowStart();

        for (uint256 i = _cursor[_compliance]; i < length; i++) {
            if (list[i].timestamp > cutoff) {
                return list[i].timestamp + MINT_WINDOW;
            }
        }

        return 0;
    }

    /**
     * @dev See {IComplianceModule-name}.
     */
    function name() public pure override returns (string memory _name) {
        return "DailyMintCapModule";
    }

    /**
     * @dev Appends a mint to the window.
     */
    function _record(address _compliance, uint256 _amount) private {
        if (_amount > type(uint128).max) {
            revert AmountExceedsRecordLimit(_amount);
        }

        _mints[_compliance].push(MintRecord({amount: uint128(_amount), timestamp: uint64(block.timestamp)}));

        emit MintRecorded(_compliance, _amount, _mintedInWindow(_compliance));
    }

    /**
     * @dev Drops records that have aged out, so the scans below stay short
     * however long the token has been live.
     */
    function _prune(address _compliance) private {
        MintRecord[] storage list = _mints[_compliance];
        uint256 length = list.length;

        if (length == 0) {
            return;
        }

        uint256 index = _cursor[_compliance];
        uint256 cutoff = _windowStart();

        while (index < length && list[index].timestamp <= cutoff) {
            index++;
        }

        if (index == length) {
            delete _mints[_compliance];
            _cursor[_compliance] = 0;
            return;
        }

        if (index != _cursor[_compliance]) {
            _cursor[_compliance] = index;
        }
    }

    /**
     * @dev Sum of mints still inside the window.
     */
    function _mintedInWindow(address _compliance) private view returns (uint256 total) {
        MintRecord[] storage list = _mints[_compliance];
        uint256 length = list.length;
        uint256 cutoff = _windowStart();

        for (uint256 i = _cursor[_compliance]; i < length; i++) {
            if (list[i].timestamp > cutoff) {
                total += list[i].amount;
            }
        }
    }

    /**
     * @dev Oldest timestamp still counted. Mints at or before this have aged
     * out. Guarded against underflow for chains started near the epoch.
     */
    function _windowStart() private view returns (uint256) {
        return block.timestamp > MINT_WINDOW ? block.timestamp - MINT_WINDOW : 0;
    }
}
