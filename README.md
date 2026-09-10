# EQOWA RWA Platform

Institutional RWA tokenization and compliance engine for Eqowa Fintech.

Milestone 1 is the ERC-3643 contract layer for **EQOWA Group Shares** (`EQOWAG`).
Acceptance is a passing Hardhat suite on `main` plus a live Polygon Amoy
deployment owned by a 2-of-3 Gnosis Safe.

Tracking: [issue #1](https://github.com/Flip9ght/eqowa-rwa-platform/issues/1).
Handover spec: [issue #2](https://github.com/Flip9ght/eqowa-rwa-platform/issues/2).

## What is in this repo

- Vendored [T-REX v4.1.6](https://github.com/TokenySolutions/T-REX) under
  `contracts/trex/`, Solidity 0.8.17, unmodified
- First-party compliance modules for holder count, lock-up, daily mint, country
  allow-list and per-identity balance
- A Hardhat fixture and 119 tests covering wiring, restrictions and handover
- Scripts to create the Amoy Safe, deploy, verify on Polygonscan, and move
  every leftover admin right to the Safe

The suite is not on Amoy yet. Public wallets and parameters are in
[`addresses.json`](addresses.json). Contract addresses land there after
`npm run publish-addresses`. The operational steps are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Token

| | |
| --- | --- |
| Name / symbol / decimals | EQOWA Group Shares / EQOWAG / 6 |
| Claim topics | 1 (KYC), 2 (residency) |
| Max balance per ONCHAINID | 150,000 shares |
| Max holders | 500, counted per identity, not per wallet |
| Lock-up | 730 days per mint tranche. Served once by the shares |
| Daily mint cap | 250,000 shares, global, rolling 24 hours. Burns do not restore allowance |
| Country allow-list | 82 codes: 54 African Union, EU27, GB. United States excluded |

Parameters live in `config/eqowa.ts` so tests and deploy share one source of
truth.

## Roles

T-REX has no `COMPLIANCE_ADMIN` role. The names map like this:

| Role | Who | What |
| --- | --- | --- |
| Owner | 2-of-3 Safe | Token, registries, compliance, factory, both implementation authorities, module proxies |
| Agent | Fintech Ops hot wallet `0xbbE038AA2406199FA565f58bbcfE2Fabaa0E6a26` | Mint, burn, freeze, register identities |
| Deployer | `0xbc21a3Bbe16A830834E6C3a069098AB11852e71C` | Pays gas, then loses every admin right |

Safe owners (threshold 2), confirmed 10 September 2026:

- `0x50D22edFE63F2fCF012125A5E50640eE5a6cD196`
- `0x10840351E6cC06f153931023E98C5895e60026dD`
- `0x7C568dd505DFeDf60BA29Ae1245f642fB1d6156c`

The deployer and the agent must not be Safe owners. Official Safe UI has no
Amoy. Create the Safe with `npm run create-safe:amoy`.

## Compliance modules

| Module | Licence | Rule |
| --- | --- | --- |
| `CountryAllowlistModule` | MIT | Recipient country must be on the allow-list |
| `BalanceCapModule` | MIT | 150,000 shares per ONCHAINID |
| `DailyMintCapModule` | MIT | 250,000 shares across the whole token per rolling day |
| `HolderCountCapModule` | GPL-3.0 | 500 holders, counted per identity |
| `TimeLockupModule` | GPL-3.0 | 730-day lock per mint tranche, plus `waiveLockup` for the Safe |

Tokeny's `CountryAllowModule` and `MaxBalanceModule` are vendored and unused.
Both carry a NonCommercial clause.

`forcedTransfer` skips `canTransfer`. `TimeLockupModule` carries the remaining
lock to the recipient so an agent cannot unlock shares by moving them.

## Development

Node 22. From the repo root:

```
npm ci
npx hardhat compile
npx hardhat test
npm run lint:sol
```

CI runs compile, solhint on first-party Solidity, and the full suite on every
pull request.

## Amoy commands

```
npm run create-safe:amoy
npm run deploy:amoy
npm run verify:amoy
npm run transfer-ownership:amoy
npm run publish-addresses
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before broadcasting. You need a
local `.env` (never committed) and about 1.5 POL on the deployer.

## Licence

The top-level `LICENSE` file is Eqowa's proprietary notice.

Vendored T-REX core is GPL-3.0, dual-licensed by Tokeny. `HolderCountCapModule`
and `TimeLockupModule` inherit that GPL base. The MIT modules
(`CountryAllowlistModule`, `BalanceCapModule`, `DailyMintCapModule` and their
shared base) do not import `contracts/trex/`.

Eqowa legal cleared AGPL-3.0. The code in use is GPL-3.0. That difference
should be confirmed with them in writing. A commercial licence for the T-REX
core is available from Tokeny.

## Layout

```
config/          Token parameters, country list, confirmed wallets
contracts/trex/  Vendored T-REX v4.1.6
contracts/compliance/  First-party modules and MIT base
scripts/         Safe, deploy, verify, handover, publish-addresses
test/            Fixture, unit, restriction, role and handover suites
docs/            Amoy runbook
addresses.json   Public wallets and, after deploy, contract addresses
```
