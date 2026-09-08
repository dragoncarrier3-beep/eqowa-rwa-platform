# Vendored T-REX v4.1.6

Everything in this directory is third-party code, copied byte-identical from the
upstream reference implementation. Do not edit these files. Eqowa-specific
contracts live in `contracts/compliance/modules`.

## Provenance

| | |
| --- | --- |
| Source | https://github.com/TokenySolutions/T-REX |
| Version | 4.1.6 |
| Vendored on | 8 September 2026 |
| Compiler | Solidity 0.8.17, optimizer enabled, 200 runs |

## Why this source rather than the maintained fork

`TokenySolutions/T-REX` was archived on 28 October 2025 and maintenance moved to
`ERC-3643/ERC-3643`. That fork was evaluated first and rejected for two reasons:

1. It sits at v4.1.3, behind this one.
2. It ships only the abstract module bases — `AbstractModule`,
   `AbstractModuleUpgradeable`, `IModule`, `ModuleProxy` and `TestModule`. The
   concrete compliance modules this project needs, including
   `CountryAllowModule` and `MaxBalanceModule`, exist only in the Tokeny repo.

The trade-off is that an archived upstream receives no further security patches,
which reinforces the recommendation for an independent audit before mainnet.

## Licence

GPL-3.0, per `LICENSE.md` in the upstream repository. Each contract header
additionally states Creative Commons Attribution-NonCommercial 4.0
International. Eqowa Fintech confirmed on 23 August 2026 that its legal team had
cleared use of this code; note that the clearance referred to AGPL-3.0, which is
a different licence, and that the NonCommercial clause has been raised with the
client for confirmation.

## Modules used by Eqowa Phase 1

Bound to `ModularCompliance` at deployment:

- `CountryAllowModule` — allow-list of permitted jurisdictions
- `MaxBalanceModule` — maximum balance per identity

Not used in Phase 1: `ConditionalTransferModule`, `CountryRestrictModule`,
`ExchangeMonthlyLimitsModule`, `SupplyLimitModule`, `TimeExchangeLimitsModule`,
`TimeTransfersLimitsModule`, `TokenListingRestrictionsModule`,
`TransferFeesModule`, `TransferRestrictModule`.

Holder-count cap and time-based lockup have no upstream equivalent and are
implemented in `contracts/compliance/modules`.
