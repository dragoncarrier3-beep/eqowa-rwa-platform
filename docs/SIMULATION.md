# Lifecycle simulation

Milestone 3 evidence: the whole payment-to-mint lifecycle run against deployed
contracts, with a report of what was expected, what happened and the
transactions behind each step.

The simulation runs the production code, not a copy: the Sumsub webhook
handler, the payment-to-mint pipeline, the settlement worker and the agent mint
executor. Only two things are stand-ins, and the report says so:

- Sumsub is replaced by GREEN review payloads fed to the real webhook handler.
- The Safe approval for the 100,000 USDT mint uses a labelled placeholder hash,
  because signing a Safe transaction is not part of the run.

## Local chain (no POL needed)

```
npm run simulate:local
```

This starts a Hardhat node, deploys the suite and the settlement contracts with
the production deploy scripts, runs the simulation and stops the node. It takes
about a minute. CI runs it on every pull request.

## Polygon Amoy

After the Amoy pass in `docs/DEPLOYMENT.md` (suite, settlement, verify):

```
npm run simulate:amoy
```

It needs, in `.env`:

- `AMOY_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`, used as operator: funds test wallets, deploys their
  identities and signs their KYC claims as the ClaimIssuer management key
- `AGENT_SIGNER_PRIVATE_KEY`, the EQOWA Fintech Ops key: registers identities,
  relays the gasless deposit and sends every mint

Waiting for real blocks makes it take several minutes. Budget about 0.2 POL on
the deployer: it tops the agent up to 0.1 POL and gives each test investor 0.02.
Each run uses fresh investor wallets, so it can be repeated.

## What it checks

| Step | Scenario |
| --- | --- |
| S01-S02 | Preflight and gas for the test wallets |
| S03-S05 | Alice (Nigeria) and David (United States) get verified identities; Charlie has none |
| S06-S07 | Sumsub GREEN approves Alice; GREEN from the United States is rejected |
| S08-S09 | 10 USDT quote for 2 shares, then a gasless deposit through the forwarder |
| S10 | Deposits for every exception case |
| S11-S12 | Worker mints after 12 blocks; 7 USDT mints 1 share and queues 2 USDT remainder |
| S13-S16 | Amount mismatch, expired quote, non-KYC payer and unknown intent go to the queue |
| S17-S18 | 100,000 USDT waits for Safe sign-off, then mints 20,000 shares |
| S19 | Alice holds 20,003 shares |
| S20-S22 | On-chain: mint to Charlie reverts, transfer to the United States reverts, new shares are locked |
| S23 | Mints, the Safe hold and the approval are in the audit log |

## Report

Each run writes `reports/<network>-<time>.md` and `.json`. The folder is
git-ignored. Commit the Amoy report on purpose as Milestone 3 evidence:

```
git add -f reports/amoy-<time>.md
```

The report contains addresses and transaction hashes only, never keys. On Amoy
every transaction links to Polygonscan.
