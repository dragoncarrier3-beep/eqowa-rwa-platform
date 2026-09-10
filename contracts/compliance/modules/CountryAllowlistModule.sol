// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {AbstractComplianceModule} from "../AbstractComplianceModule.sol";
import {IComplianceHost, IInvestorRegistry, ITokenIdentityRegistry} from "../interfaces/IComplianceHost.sol";

/**
 * @title CountryAllowlistModule
 * @notice Permits transfers only when the recipient's registered country is on
 * the allow-list for this compliance contract.
 *
 * Countries are ISO 3166-1 numeric codes, which is how T-REX stores residency
 * on the identity registry. An empty list blocks every incoming transfer, so a
 * misconfigured deployment fails closed.
 *
 * First-party MIT replacement for Tokeny's CountryAllowModule, which carries a
 * Creative Commons NonCommercial clause. Same ABI surface the factory uses
 * (`batchAllowCountries`, `isCountryAllowed`).
 */
contract CountryAllowlistModule is AbstractComplianceModule {
    /// Allowance status per country, per compliance contract.
    mapping(address => mapping(uint16 => bool)) private _allowedCountries;

    /// Emitted when a country is added to the allow-list.
    event CountryAllowed(address indexed _compliance, uint16 _country);

    /// Emitted when a country is removed from the allow-list.
    event CountryUnallowed(address indexed _compliance, uint16 _country);

    error CountryAlreadyAllowed(address _compliance, uint16 _country);
    error CountryNotAllowed(address _compliance, uint16 _country);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __AbstractComplianceModule_init();
    }

    /**
     * @notice Adds countries to the allow-list in one call.
     * @dev Split large lists across several transactions. A single 80-country
     * batch can approach the block gas limit on Amoy.
     */
    function batchAllowCountries(uint16[] calldata _countries) external onlyComplianceCall {
        for (uint256 i = 0; i < _countries.length; i++) {
            _allowedCountries[msg.sender][_countries[i]] = true;
            emit CountryAllowed(msg.sender, _countries[i]);
        }
    }

    function batchDisallowCountries(uint16[] calldata _countries) external onlyComplianceCall {
        for (uint256 i = 0; i < _countries.length; i++) {
            _allowedCountries[msg.sender][_countries[i]] = false;
            emit CountryUnallowed(msg.sender, _countries[i]);
        }
    }

    function addAllowedCountry(uint16 _country) external onlyComplianceCall {
        if (_allowedCountries[msg.sender][_country]) {
            revert CountryAlreadyAllowed(msg.sender, _country);
        }

        _allowedCountries[msg.sender][_country] = true;
        emit CountryAllowed(msg.sender, _country);
    }

    function removeAllowedCountry(uint16 _country) external onlyComplianceCall {
        if (!_allowedCountries[msg.sender][_country]) {
            revert CountryNotAllowed(msg.sender, _country);
        }

        _allowedCountries[msg.sender][_country] = false;
        emit CountryUnallowed(msg.sender, _country);
    }

    function moduleTransferAction(address, address, uint256) external override onlyComplianceCall {}

    function moduleMintAction(address, uint256) external override onlyComplianceCall {}

    function moduleBurnAction(address, uint256) external override onlyComplianceCall {}

    /**
     * @dev See {IComplianceModule-moduleCheck}. Only the recipient's country
     * is checked. A sender already holding tokens is allowed to exit.
     */
    function moduleCheck(
        address /*_from*/,
        address _to,
        uint256 /*_value*/,
        address _compliance
    ) external view override returns (bool) {
        return _allowedCountries[_compliance][_countryOf(_compliance, _to)];
    }

    function isCountryAllowed(address _compliance, uint16 _country) external view returns (bool) {
        return _allowedCountries[_compliance][_country];
    }

    /**
     * @dev Stateless against existing holders, so any compliance can bind.
     */
    function canComplianceBind(address) external view override returns (bool) {
        return true;
    }

    function isPlugAndPlay() external pure override returns (bool) {
        return true;
    }

    function name() public pure override returns (string memory _name) {
        return "CountryAllowlistModule";
    }

    function _countryOf(address _compliance, address _userAddress) private view returns (uint16) {
        address tokenBound = IComplianceHost(_compliance).getTokenBound();

        if (tokenBound == address(0)) {
            return 0;
        }

        address registry = ITokenIdentityRegistry(tokenBound).identityRegistry();

        if (registry == address(0)) {
            return 0;
        }

        return IInvestorRegistry(registry).investorCountry(_userAddress);
    }
}
