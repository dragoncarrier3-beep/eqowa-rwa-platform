// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @title IComplianceModule
 * @notice First-party declaration of the compliance module interface that an
 * ERC-3643 modular compliance contract expects of a bound module.
 *
 * @dev Declared here rather than imported from the upstream T-REX source so
 * that Eqowa's own modules carry no upstream licence obligations. This is safe
 * because the compliance contract dispatches to modules purely by ABI selector
 * and never type-checks or registers them, so an independently declared
 * interface with matching signatures interoperates identically.
 */
interface IComplianceModule {
    /// Emitted when a compliance contract binds itself to the module.
    event ComplianceBound(address indexed _compliance);

    /// Emitted when a compliance contract unbinds itself from the module.
    event ComplianceUnbound(address indexed _compliance);

    /**
     * @notice Binds the calling compliance contract to this module.
     * @dev Called by the compliance contract itself from `addModule`.
     */
    function bindCompliance(address _compliance) external;

    /**
     * @notice Unbinds the calling compliance contract from this module.
     * @dev Called by the compliance contract itself from `removeModule`.
     */
    function unbindCompliance(address _compliance) external;

    /**
     * @notice Updates module state following a transfer.
     */
    function moduleTransferAction(address _from, address _to, uint256 _value) external;

    /**
     * @notice Updates module state following a mint.
     */
    function moduleMintAction(address _to, uint256 _value) external;

    /**
     * @notice Updates module state following a burn.
     */
    function moduleBurnAction(address _from, uint256 _value) external;

    /**
     * @notice Returns true when the module permits the proposed transfer.
     * @dev A mint arrives with `_from` set to the zero address.
     */
    function moduleCheck(address _from, address _to, uint256 _value, address _compliance) external view returns (bool);

    /**
     * @notice Whether the given compliance contract is bound to this module.
     */
    function isComplianceBound(address _compliance) external view returns (bool);

    /**
     * @notice Whether the module is willing to bind to the given compliance.
     */
    function canComplianceBind(address _compliance) external view returns (bool);

    /**
     * @notice False when binding requires the `canComplianceBind` check.
     */
    function isPlugAndPlay() external pure returns (bool);

    /**
     * @notice Human-readable module name.
     */
    function name() external pure returns (string memory _name);
}
