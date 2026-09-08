# Milestone 1 progress

ERC-3643 contract layer for EQOWA Group Shares. Four working days, Tue 8 to Fri 11
September 2026. Acceptance is a live Polygon Amoy deployment plus a passing Hardhat
suite merged to `main`.

Tracking issue [#1](https://github.com/Flip9ght/eqowa-rwa-platform/issues/1).
Client specification [#2](https://github.com/Flip9ght/eqowa-rwa-platform/issues/2).

## Status

| Task | Description | Status | PR |
| --- | --- | --- | --- |
| M1-01 | Hardhat and TypeScript scaffold, Amoy config, solhint, prettier | Merged | [#4](https://github.com/Flip9ght/eqowa-rwa-platform/pull/4) |
| M1-02 | Vendor T-REX v4.1.6 unmodified, solc pinned at 0.8.17 | Merged | [#6](https://github.com/Flip9ght/eqowa-rwa-platform/pull/6) |
| M1-03 | GitHub Actions CI, `.gitattributes` line-ending normalisation | Merged | [#8](https://github.com/Flip9ght/eqowa-rwa-platform/pull/8) |
| M1-04 | Full-suite deployment fixture via `TREXFactory`, smoke tests | Merged | [#10](https://github.com/Flip9ght/eqowa-rwa-platform/pull/10) |
| M1-05 | `HolderCountCapModule` | Merged | [#12](https://github.com/Flip9ght/eqowa-rwa-platform/pull/12) |
| M1-06 | `TimeLockupModule` | Merged | [#14](https://github.com/Flip9ght/eqowa-rwa-platform/pull/14) |
| M1-07 | Configure `CountryAllowModule` and `MaxBalanceModule` | Next | — |
| M1-08 | Full transfer-restriction and role-boundary test suite | Not started | — |
| M1-09 | Parameterised deploy script and ownership-transfer script | Not started | — |
| M1-10 | Deploy to Polygon Amoy, verify on Polygonscan | Not started | — |
| M1-11 | Transfer ownership to the 2-of-3 Gnosis Safe | Not started | — |
| M1-12 | README, deployment runbook, `addresses.json`, tag `v0.1.0-m1` | Not started | — |

## Test suite

52 passing. `npx hardhat test`.

| Suite | Tests | Covers |
| --- | --- | --- |
| `test/suite.smoke.test.ts` | 12 | Deployment, governance, compliance wiring, verified transfer |
| `test/compliance/holderCountCap.test.ts` | 16 | Holder counting, cap enforcement, access control |
| `test/compliance/timeLockup.test.ts` | 24 | Tranche locking, staged release, forced transfers, waivers |

## Contracts written

Everything under `contracts/trex/` is vendored upstream and unmodified. First-party
code is limited to the two modules that do not exist in T-REX v4.

### `HolderCountCapModule`

Caps the number of distinct investors, counted per ONCHAINID rather than per wallet,
so an investor holding across several wallets occupies one slot of the 500.

At the cap, a sender moving their entire position frees a slot and the transfer
succeeds, so the register can rotate. A partial transfer to a new holder is rejected.
A cap of zero blocks all incoming transfers, so a misconfigured deployment fails
closed rather than running uncapped.

### `TimeLockupModule`

Applies a 730-day lock-up to each mint tranche, measured from that tranche's own
mint, so an investor topped up over several rounds unlocks progressively.

Tranches are held against the ONCHAINID, so a lock survives an investor moving
between their own wallets and survives `recoveryAddress`. Tokens arriving by ordinary
transfer are not re-locked, because the module refuses to let locked tokens move in
the first place, so anything that arrives has already served its term.

`forcedTransfer` calls `transferred()` without calling `canTransfer`, bypassing
`moduleCheck` entirely. Left unhandled, an agent could move locked tokens to another
wallet and they would arrive free. The module detects a debit exceeding the sender's
unlocked balance and re-creates the affected tranches against the recipient with their
original release times.

`waiveLockup` lets the Safe release a lock ahead of term, for the cases a fixed term
cannot anticipate: a court order, an estate, a regulator-approved exemption. It moves
only the lock, never a balance.

Both modules refuse to bind to a compliance whose token already has supply, since
neither can account for holders it never observed. Both call `_disableInitializers()`
in the constructor, which upstream T-REX modules omit; without it the implementation
behind `ModuleProxy` can be initialised by anyone, handing them its UUPS upgrade path.

## Configuration

Token and compliance parameters live in `config/eqowa.ts`, read by both the tests and
the deploy script, and taken from issue #2.

| Parameter | Value |
| --- | --- |
| Name / symbol / decimals | EQOWA Group Shares / EQOWAG / 6 |
| Claim topics | 1 (KYC), 2 (residency) |
| Maximum balance per identity | 150,000 shares |
| Maximum holders | 500 |
| Lock-up | 730 days per mint tranche |
| Gnosis Safe (Amoy) | `0x98bC42F1e63a8B733d82C3f628198fA2b45EE189` |

## Blockers

Ordered by when they bite.

1. **Country allow-list as ISO-3166 numeric codes.** Direct input to M1-07, which is
   the next task. Proposed: 54 African Union member states, EU27 and GB. Needs
   sign-off before the list can be committed.
2. **Testnet POL for the deployer wallet.** Needed before M1-10 can run.
3. **`AGENT_ROLE` hot wallet address.** Needed before M1-11 can assign it.

Resolved: the 2-of-3 Safe address arrived in issue #2.

## Open questions

**Lock-up semantics on secondary sales.** As built, the 730 days is served once, by
the shares: an investor buying in a secondary trade receives tokens that have already
completed their term and can move them on immediately. The alternative is that each
holder serves their own 730 days from their own acquisition date. Issue #2 says "per
mint tranche", which is why the first reading was implemented. The two behave very
differently from year three onward and this is expensive to change after deployment.

**Licence.** T-REX is GPL-3.0, and every contract header additionally asserts Creative
Commons Attribution-NonCommercial 4.0. Eqowa's legal team cleared AGPL-3.0, which is a
different licence, and the NonCommercial clause in particular should go back to them
in writing.

## Change requests

Raised against issue #2 and outside the agreed Milestone 1 scope.

- **250,000-token daily mint cap.** Specified in #2 but not part of the Milestone 1
  deliverables. Requires a new compliance module with rolling-window accounting.
  Awaiting a decision on scope and fee.
