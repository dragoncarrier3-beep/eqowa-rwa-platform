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
| M1-07 | Production country allow-list (EU27 + 54 AU + GB) | Merged | [#21](https://github.com/Flip9ght/eqowa-rwa-platform/pull/21) |
| M1-08 | Full transfer-restriction and role-boundary test suite | Merged | [#23](https://github.com/Flip9ght/eqowa-rwa-platform/pull/23) |
| M1-09 | Parameterised deploy script and ownership-transfer script | Merged | [#25](https://github.com/Flip9ght/eqowa-rwa-platform/pull/25) |
| M1-10 | Deploy to Polygon Amoy, verify on Polygonscan | Merged (tooling) | [#27](https://github.com/Flip9ght/eqowa-rwa-platform/pull/27) |
| M1-11 | Transfer ownership to the 2-of-3 Gnosis Safe | Blocked on live Amoy | — |
| M1-12 | README, deployment runbook, `addresses.json`, tag `v0.1.0-m1` | Merged (docs; tag waits) | [#29](https://github.com/Flip9ght/eqowa-rwa-platform/pull/29) |
| M1-13 | `DailyMintCapModule` (scope added 9 Sep) | Merged | [#17](https://github.com/Flip9ght/eqowa-rwa-platform/pull/17) |
| M1-14 | MIT `CountryAllowlistModule` and `BalanceCapModule` | Merged | [#19](https://github.com/Flip9ght/eqowa-rwa-platform/pull/19) |
| M1-15 | Pin Amoy fees, measure deploy gas, price the preflight | Open | branch `fix/m1-13-gas-preflight` |

## Test suite

121 passing. `npx hardhat test`.

| Suite | Tests | Covers |
| --- | --- | --- |
| `test/suite.smoke.test.ts` | 12 | Deployment, governance, compliance wiring, verified transfer |
| `test/compliance/holderCountCap.test.ts` | 16 | Holder counting, cap enforcement, access control |
| `test/compliance/timeLockup.test.ts` | 24 | Tranche locking, staged release, forced transfers, waivers |
| `test/compliance/dailyMintCap.test.ts` | 20 | Global cap, rolling window, exclusions, access control |
| `test/compliance/countryAllowlist.test.ts` | 6 | Allow-list, US blocked, full production list on-chain |
| `test/compliance/balanceCap.test.ts` | 5 | Per-identity cap, multi-wallet pooling, access control |
| `test/config/countries.test.ts` | 3 | 82-country set, no US, chunking |
| `test/suite.roles.test.ts` | 6 | Agent and Safe role boundaries, upgrade authority |
| `test/suite.restrictions.test.ts` | 9 | Unverified/blocked-country transfers, freeze, pause, all five modules |
| `test/suite.handover.test.ts` | 8 | Production deploy path, Safe handover, factory-owned IRS recovery |
| `test/scripts/amoyPreflight.test.ts` | 6 | Pinned-fee POL floor, Safe-must-exist before deploy |
| `test/scripts/verificationTargets.test.ts` | 3 | Polygonscan target list and TokenProxy args |
| `test/scripts/publicAddresses.test.ts` | 3 | `addresses.json` stub and publish mapping |

## Contracts written

Everything under `contracts/trex/` is vendored upstream and unmodified. First-party
code is limited to the three modules that do not exist in T-REX v4.

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

### `DailyMintCapModule`

Caps how much may be minted across the whole token within any rolling 24 hours, set
to 250,000 shares. The cap is global rather than per investor, so it bounds total
issuance velocity: a batch-minting error or a compromised agent key can mint at most
one day's cap before the Safe can intervene.

The window is rolling rather than calendar-based on purpose. A cap resetting at
midnight can be doubled by minting either side of the boundary, so each mint is aged
against its own timestamp. Only mints count. Transfers are unaffected, and burning
does not return allowance, because the cap limits issuance rate rather than net supply.

This module is built clean of upstream code, at the client's request of 9 September,
to keep Eqowa's issuance logic free of GPL obligations. It derives from a first-party
`AbstractComplianceModule` and first-party `IComplianceModule` and `IComplianceHost`
interfaces, and depends only on MIT-licensed OpenZeppelin primitives. It imports
nothing from `contracts/trex/`. This works because a modular compliance contract
dispatches to its modules purely by ABI selector and never type-checks or registers
them, so an independently declared interface interoperates identically.

### Common behaviour

All three modules refuse to bind to a compliance whose token already has supply, since
none can account for activity it never observed. All three call `_disableInitializers()`
in the constructor, which upstream T-REX modules omit; without it the implementation
behind the proxy can be initialised by anyone, handing them its UUPS upgrade path.

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
| Daily mint cap | 250,000 shares, rolling 24 hours, global |
| Country allow-list | 82 codes: EU27, 54 AU states, GB. US excluded. Applied in chunks of 25 |
| Gnosis Safe (Amoy) | Created by `create-safe:amoy`. Issue #2 addresses unused |
| Deployer | `0xbc21a3Bbe16A830834E6C3a069098AB11852e71C` |
| Agent (`AGENT_ROLE`) | `0xbbE038AA2406199FA565f58bbcfE2Fabaa0E6a26` |

## Blockers

Ordered by when they bite.

1. **Testnet POL for the deployer.** Public Polygon faucet is dead. The faucets
   that still hold a balance gate on a mainnet ETH balance, which this fresh
   deployer does not have. Deployer currently holds 0.0005 POL.

   The full deploy measures 40,757,565 gas. The gas price is pinned at 30 gwei
   in `config/amoyFees.ts` rather than read from the network, so the cost is
   about 1.22 POL and the preflight floor is 1.41. Target 2 POL.
   `create-safe:amoy` is only about 400,000 gas, roughly 0.014 POL, so the Safe
   can be created well before the rest of the gas arrives. Blocks M1-10.
2. **`.env` on the deploy machine.** `DEPLOYER_PRIVATE_KEY` locally only. Never
   commit it. Discard after Safe handover. Blocks M1-10.
3. **Amoy Safe.** Official Safe UI has no Amoy. Create it with
   `npm run create-safe:amoy` after the deployer has POL, then put the address in
   `GNOSIS_SAFE_ADDRESS`. Blocks M1-10.

Resolved: country list, lock-up semantics on resale, both wallet addresses, Safe
signers (2-of-3, confirmed 10 September). The two Safe addresses from issue #2
are unused (one is dead, one looks like Polygon mainnet).

## Open questions

**Commercial licence from Tokeny.** Stock NC modules were replaced in M1-14. The
core stack (token, identity registries, `ModularCompliance`) remains GPL-3.0.
Tokeny's headers offer the software under "a proprietary license or the GPL v.3",
so a commercial licence is available from them directly. That is a conversation
for Eqowa's legal team rather than an engineering change.

## Licence position

Established by reading the vendored headers on 10 September, since the picture is more
specific than first assumed.

| Code | Licence | Commercial use |
| --- | --- | --- |
| Core T-REX stack | GPL-3.0, dual-licensed | Permitted under GPL terms, or by commercial licence from Tokeny |
| Vendored `CountryAllowModule`, `MaxBalanceModule` | GPL-3.0 plus CC-BY-NC-4.0 | Unused. Replaced by first-party MIT modules |
| `HolderCountCapModule`, `TimeLockupModule` | GPL-3.0 | Still inherit the GPL T-REX base |
| MIT stack (`DailyMintCapModule`, `CountryAllowlistModule`, `BalanceCapModule`) | MIT | Unrestricted |

Eqowa's legal team cleared AGPL-3.0, which is a different licence from the GPL-3.0
actually in use. That difference, and the NonCommercial clause above, should be
confirmed with them in writing.

## Change requests

- **250,000-token daily mint cap.** Specified in issue #2 but not in the agreed
  Milestone 1 deliverables. Accepted into scope by the client on 9 September and
  delivered as M1-13. Adds roughly half a day against a four-day milestone.
