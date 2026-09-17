# Project progress

Eqowa RWA tokenization platform, Phase 1. Four milestones under the proposal of
1 September 2026. This file is the single status page for all of them.

| Milestone | Scope | Parent issue | Status |
| --- | --- | --- | --- |
| 1 | ERC-3643 contract layer for EQOWA Group Shares | [#1](https://github.com/Flip9ght/eqowa-rwa-platform/issues/1) | Code merged. Live Amoy deploy waits on POL |
| 2 | Backend, indexer, escrow, Sumsub, payment-to-mint | [#31](https://github.com/Flip9ght/eqowa-rwa-platform/issues/31) | Code merged. Awaiting client acceptance |
| 3 | Amoy testnet simulation | to be created | Starts Friday 19 September |
| 4 | Next.js portals, WebAuthn, mainnet runbook, handover | to be created | Not started |

Test suites: `npx hardhat test` 145 passing, `npm run api:test` 38 passing. CI runs
both on every pull request.

Client specification for the token: [#2](https://github.com/Flip9ght/eqowa-rwa-platform/issues/2).

## Milestone 1: contracts

Four working days, Tue 8 to Fri 11 September 2026. Acceptance is a live Polygon
Amoy deployment plus a passing Hardhat suite merged to `main`.

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
| M1-10 | Deploy to Polygon Amoy, verify on Polygonscan | Merged (tooling). Broadcast waits on POL | [#27](https://github.com/Flip9ght/eqowa-rwa-platform/pull/27) |
| M1-11 | Transfer ownership to the 2-of-3 Gnosis Safe | Blocked on live Amoy | script merged in #25 |
| M1-12 | README, deployment runbook, `addresses.json`, tag `v0.1.0-m1` | Merged (docs). Tag waits | [#29](https://github.com/Flip9ght/eqowa-rwa-platform/pull/29) |
| M1-13 | `DailyMintCapModule` (scope added 9 Sep) | Merged | [#17](https://github.com/Flip9ght/eqowa-rwa-platform/pull/17) |
| M1-14 | MIT `CountryAllowlistModule` and `BalanceCapModule` | Merged | [#19](https://github.com/Flip9ght/eqowa-rwa-platform/pull/19) |
| M1-15 | Pin Amoy fees, measure deploy gas, price the preflight | Merged | [#30](https://github.com/Flip9ght/eqowa-rwa-platform/pull/30) |

### What is left to close Milestone 1

All of it is one operational pass on the deploy machine, in this order, once the
deployer holds about 2 POL: `create-safe:amoy`, `deploy:amoy`, `verify:amoy`,
`transfer-ownership:amoy`, `publish-addresses`, commit `addresses.json`, tag
`v0.1.0-m1`, discard the deployer key. The runbook is `docs/DEPLOYMENT.md`.

### Contracts written

Everything under `contracts/trex/` is vendored upstream and unmodified. First-party
code is the five compliance modules, the MIT module base, and the escrow.

**`HolderCountCapModule`** caps the number of distinct investors, counted per
ONCHAINID rather than per wallet, so an investor holding across several wallets
occupies one slot of the 500. At the cap, a sender moving their entire position
frees a slot and the transfer succeeds. A partial transfer to a new holder is
rejected. A cap of zero blocks all incoming transfers, so a misconfigured
deployment fails closed.

**`TimeLockupModule`** applies a 730-day lock-up to each mint tranche, measured
from that tranche's own mint. Tranches are held against the ONCHAINID, so a lock
survives wallet moves and `recoveryAddress`. `forcedTransfer` bypasses
`canTransfer`, so the module detects a debit exceeding the unlocked balance and
re-creates the affected tranches against the recipient with their original
release times. `waiveLockup` lets the Safe release a lock ahead of term. The lock
is served once, by the shares: a later buyer of unlocked shares does not wait
again (confirmed 8 September).

**`DailyMintCapModule`** caps minting across the whole token at 250,000 shares
in any rolling 24 hours. Burning does not return allowance. Built clean of
upstream code on a first-party MIT base at the client's request of 9 September.

**`CountryAllowlistModule`** and **`BalanceCapModule`** are MIT replacements for
the two Tokeny modules that carry a NonCommercial clause.

All modules refuse to bind to a compliance whose token already has supply, and
call `_disableInitializers()` in the constructor, which upstream omits.

### Configuration

Token and compliance parameters live in `config/eqowa.ts`, read by tests, the
deploy script and the API.

| Parameter | Value |
| --- | --- |
| Name / symbol / decimals | EQOWA Group Shares / EQOWAG / 6 |
| Share price | 5 USDT per share: 4 USDT funds, 1 USDT Eqowa fee (confirmed 14 Sep) |
| Claim topics | 1 (KYC), 2 (residency) |
| Maximum balance per identity | 150,000 shares |
| Maximum holders | 500 |
| Lock-up | 730 days per mint tranche, served once |
| Daily mint cap | 250,000 shares, rolling 24 hours, global |
| Country allow-list | 82 codes: EU27, 54 AU states, GB. US excluded. Applied in chunks of 25 |
| Quote expiry / confirmations | 15 minutes / 12 blocks (`config/mint.ts`) |
| Gnosis Safe (Amoy) | Created by `create-safe:amoy` from the three confirmed signers, 2 of 3 |
| Deployer | `0xbc21a3Bbe16A830834E6C3a069098AB11852e71C` |
| Agent (`AGENT_ROLE`) | `0xbbE038AA2406199FA565f58bbcfE2Fabaa0E6a26` |

## Milestone 2: backend and indexer

Started Mon 14 September 2026 against issue #31. Code complete Wed 16 September.

| Task | Description | Status | PR |
| --- | --- | --- | --- |
| M2-01 | Fastify API scaffold, Postgres schema, Docker Compose, 5 USDT share price | Merged | [#33](https://github.com/Flip9ght/eqowa-rwa-platform/pull/33) |
| M2-02 | Indexer for `Transfer` and `AddressFrozen`, idempotent on (tx, log index) | Merged | [#35](https://github.com/Flip9ght/eqowa-rwa-platform/pull/35), [#36](https://github.com/Flip9ght/eqowa-rwa-platform/pull/36) |
| M2-03 | `Escrow.deposit(intentId, amount)` with ERC-2771, mock 6-decimal USDT | Merged | [#38](https://github.com/Flip9ght/eqowa-rwa-platform/pull/38) |
| M2-04 | Sumsub webhook with HMAC, GREEN in an allowed country issues claims 1 and 2 | Merged | [#40](https://github.com/Flip9ght/eqowa-rwa-platform/pull/40) |
| M2-05 | Payment-to-mint: 15-minute quote, 12-block gate, remainder as exception | Merged | [#42](https://github.com/Flip9ght/eqowa-rwa-platform/pull/42) |
| M2-06 | Agent signer (env now, AWS KMS when the ARN is set), deposit relayer | Merged | [#44](https://github.com/Flip9ght/eqowa-rwa-platform/pull/44) |
| M2-07 | Exception queue, one-shot admin resolve, append-only audit log | Merged | [#46](https://github.com/Flip9ght/eqowa-rwa-platform/pull/46) |
| M2-08 | KYC lookup and webhook delivery log for the sandbox test | Merged | [#48](https://github.com/Flip9ght/eqowa-rwa-platform/pull/48) |

### How the pipeline works

1. `POST /mint/quotes` locks 5 USDT per share for 15 minutes. Amounts below one
   share are refused.
2. The investor deposits USDT into the escrow against that intent. The relayer
   (`POST /relayer/deposit`) can submit the signed request so the investor pays
   no gas; the escrow still records the investor as payer.
3. `POST /mint/deposits` records the escrow payment. `POST /mint/settle` mints
   only after 12 confirmations, an exact amount match, and an approved KYC record.
4. Whole shares are minted through the agent signer. Leftover USDT never mints;
   it is stored as an open exception. Expired quotes, amount mismatches, missing
   KYC and failed mints are also queued.
5. `GET /admin/exceptions`, `POST /admin/exceptions/:id/resolve` and
   `GET /admin/audit` are behind `x-admin-key`. A resolved exception cannot be
   reopened. The audit log is insert only.
6. Sumsub `applicantReviewed` arrives at `POST /webhooks/sumsub`. GREEN in an
   allow-listed country stores `approved` and claims 1 and 2. RED, unknown
   country or US stores `rejected` with no claims. Every delivery is kept and
   can be read at `GET /admin/kyc/:applicantId`.

ONCHAINID writes are mocked until the Amoy suite exists. The Hardhat path in
`test/kyc/sumsubClaims.test.ts` proves the real registration and claim writes.

### Milestone 2 operational state

- Sumsub sandbox app token, secret key and webhook secret are held in the local
  `.env` only. The webhook URL is a temporary Cloudflare tunnel to the local API
  and changes on restart; Eqowa chose this over a staging host on 16 September.
- The first live webhook test is scheduled with Eqowa for Thu 18 September.
- No Postgres on the development machine yet, so KYC and mint state are held in
  memory between restarts. `DATABASE_URL` switches both stores to Postgres.
- AWS KMS is wired behind `KMS_KEY_ARN` and tested with a mocked client. The
  ARN has not been provisioned.

## Test suite

`npx hardhat test`, 145 passing.

| Suite | Tests | Covers |
| --- | --- | --- |
| `test/suite.smoke.test.ts` | 12 | Deployment, governance, all five modules wired, verified transfer |
| `test/suite.roles.test.ts` | 6 | Agent and Safe role boundaries, upgrade authority |
| `test/suite.restrictions.test.ts` | 9 | Unverified and blocked-country transfers, freeze, pause, modules together |
| `test/suite.handover.test.ts` | 8 | Production deploy path, Safe handover, factory-owned IRS recovery |
| `test/compliance/holderCountCap.test.ts` | 16 | Holder counting, cap enforcement, access control |
| `test/compliance/timeLockup.test.ts` | 24 | Tranche locking, staged release, forced transfers, waivers |
| `test/compliance/dailyMintCap.test.ts` | 20 | Global cap, rolling window, exclusions, access control |
| `test/compliance/countryAllowlist.test.ts` | 6 | Allow-list, US blocked, full production list on-chain |
| `test/compliance/balanceCap.test.ts` | 5 | Per-identity cap, multi-wallet pooling, access control |
| `test/config/countries.test.ts` | 4 | 82-country set, no US, chunking |
| `test/config/pricing.test.ts` | 4 | 5 USDT split into funds, fee and remainder |
| `test/config/mint.test.ts` | 5 | Quote expiry, 12-block gate, reject reasons |
| `test/config/exceptions.test.ts` | 2 | Resolve once, empty resolution refused |
| `test/escrow/escrow.test.ts` | 6 | Deposit, replay refused, wrong token, forwarder attribution, refund |
| `test/indexer/tokenEvents.test.ts` | 1 | Decoder against a live mint, transfer and freeze |
| `test/kyc/sumsubClaims.test.ts` | 2 | Real identity registration and claims 1 and 2 on the suite |
| `test/mint/paymentToMint.test.ts` | 1 | 10 USDT escrow deposit then 2 shares minted after 12 blocks |
| `test/relayer/relayDeposit.test.ts` | 2 | Relayed deposit still credits the investor, agent mint |
| `test/scripts/amoyPreflight.test.ts` | 6 | Pinned-fee POL floor, Safe-must-exist before deploy |
| `test/scripts/verificationTargets.test.ts` | 3 | Polygonscan target list and TokenProxy args |
| `test/scripts/publicAddresses.test.ts` | 3 | `addresses.json` stub and publish mapping |

`npm run api:test`, 38 passing across schema, indexer, KYC, mint, signer,
relayer and admin suites.

## Blockers

Ordered by when they bite.

1. **Testnet POL for the deployer.** Public faucets refuse wallets without old
   Ethereum history. The deployer holds 0.0005 POL. The Milestone 1 deploy is
   about 1.22 POL at the 30 gwei pinned in `config/amoyFees.ts` (floor 1.41).
   Milestone 3 adds the escrow, mock USDT, forwarder and the simulation
   transactions, so the target is about 3 POL in total. Eqowa is sourcing it.
   Blocks M1-10, M1-11 and all of Milestone 3 on-chain.
2. **Public host for the API.** Sumsub needs a public HTTPS URL. The tunnel is
   fine for the sandbox but not for a demo that must stay up. Needed by Milestone 4.
3. **Milestone 2 acceptance.** Issue #31 stays open until Eqowa confirms.

Resolved since the last update: share price (5 USDT, 14 Sep), Sumsub sandbox
keys and webhook secret (15 and 16 Sep), Safe signers (2 of 3, 10 Sep).

## Milestone 3 plan: Amoy testnet simulation

Proposal: full contract suite plus a mock ERC-20 USDT on Polygon Amoy, an
end-to-end payment-to-mint lifecycle, on-chain proof that unverified wallets are
blocked, gas profiling with standardised error messages. Half a week. Client test
scenarios of 23 August: escrow deposits, 6-decimal USDT math, 15-minute quote
expiry, 12 block confirmations, manual exception queue routing.

| Task | Description | Needs POL |
| --- | --- | --- |
| M3-01 | Amoy deploy script for mock USDT, forwarder and escrow, recorded in `deployments/amoy.json`, covered by verify and publish | Broadcast only |
| M3-02 | Settlement worker: watch escrow `Deposited`, wait 12 blocks, settle and mint automatically. Mints of 100,000 USDT or more wait for Safe sign-off (client rule of 23 August) | No |
| M3-03 | Lifecycle simulation script and evidence report with transaction links: KYC, quote, relayed deposit, mint, blocked unverified and US wallets, the four exception cases | Run only |
| M3-04 | Gas profile (`docs/GAS.md`) and one consistent revert scheme across first-party contracts, plus a revert-to-message map for the front end | No |
| M3-05 | Live pass: close Milestone 1 on Amoy, then run M3-01 and M3-03 on Amoy, point the API at the live addresses, tag | Yes |

## Milestone 4 plan: front end and handover

Proposal: unified Next.js codebase with the admin dashboard and the investor
portal, WebAuthn and FIDO2 hardware authentication for administrators, global
asset listing with live supply and holder metrics, compliance parameter panel,
wired mint, burn and freeze controls, mainnet deployment scripts and runbook,
repository and infrastructure handover. One week.

| Task | Description |
| --- | --- |
| M4-01 | `apps/web` Next.js App Router, Tailwind, standard component library, wagmi and viem, network guard for 80002 and 137 |
| M4-02 | Investor sign-in with SIWE and a JWT session cookie |
| M4-03 | Investor onboarding through the Sumsub WebSDK and a KYC status view |
| M4-04 | Investor portfolio: balances, lock-up timers, transaction history from the indexer |
| M4-05 | Investor checkout: quote, USDT approve, gasless deposit, status tracking with pre-flight checks |
| M4-06 | Admin WebAuthn: two keys per admin, login challenge, Safe-signed break-glass reset |
| M4-07 | Admin dashboard: asset listing, compliance panel (changes become Safe transactions), exception queue, audit log, KYC list |
| M4-08 | Admin mint, burn, freeze and pause controls through the agent signer, audited |
| M4-09 | Polygon mainnet network config, native USDT address, fee config, runbook, handover checklist |

Client items needed for Milestone 4: brand assets (logo, favicon, colour), the
number of admin accounts and whether YubiKeys have been procured, MetaMask only
or WalletConnect as well, and whether Eqowa provisions Vercel or AWS.

## Licence position

| Code | Licence | Commercial use |
| --- | --- | --- |
| Core T-REX stack | GPL-3.0, dual-licensed | Permitted under GPL terms, or by commercial licence from Tokeny |
| Vendored `CountryAllowModule`, `MaxBalanceModule` | GPL-3.0 plus CC-BY-NC-4.0 | Unused. Replaced by first-party MIT modules |
| `HolderCountCapModule`, `TimeLockupModule` | GPL-3.0 | Still inherit the GPL T-REX base |
| MIT stack (`DailyMintCapModule`, `CountryAllowlistModule`, `BalanceCapModule`, `Escrow`) | MIT | Unrestricted |
| Backend and front end | Proprietary | Talk to the contracts over RPC only |

Eqowa's legal team cleared AGPL-3.0, which is a different licence from the GPL-3.0
actually in use. A commercial licence for the core is available from Tokeny. That
is a conversation for Eqowa's legal team rather than an engineering change.

## Change requests

- **250,000-token daily mint cap.** Accepted into Milestone 1 scope by the client
  on 9 September and delivered as M1-13.
- **MIT replacements for the NonCommercial modules.** Requested 10 September,
  delivered as M1-14.
- **Safe sign-off for mints of 100,000 USDT or more.** Client rule of 23 August,
  not in the proposal text. Scheduled inside M3-02 at no extra charge because it
  is a small gate on the existing pipeline.
