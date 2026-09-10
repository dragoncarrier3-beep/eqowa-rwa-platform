# Amoy deployment runbook

Polygon Amoy, chain 80002. Official Safe UI has no Amoy, so the Safe is created
from this repo.

Do not commit `.env`. Discard `DEPLOYER_PRIVATE_KEY` after ownership has moved
to the Safe.

## Prerequisites

1. Copy `.env.example` to `.env` on the deploy machine.
2. Set `DEPLOYER_PRIVATE_KEY` for `0xbc21a3Bbe16A830834E6C3a069098AB11852e71C`.
3. Set `POLYGONSCAN_API_KEY`.
4. Fund that deployer with about 1.5 to 2 POL. `create-safe:amoy` needs 0.05 POL.
   `deploy:amoy` needs 1.5 POL. Scripts refuse to broadcast below those floors.
5. Optional: set `CLAIM_ISSUER_ADDRESS`. If empty, deploy creates a ClaimIssuer
   whose management key is the deployer. Move that key after handover.

Token name, caps, lock-up and the country list are not read from `.env`. They
live in `config/eqowa.ts`.

Confirmed wallets are in `config/wallets.ts`. The deployer and the Fintech Ops
agent must not be Safe owners.

## Order of operations

```
npm ci
npx hardhat compile
npx hardhat test

npm run create-safe:amoy
```

Put the printed Safe address in `.env` as `GNOSIS_SAFE_ADDRESS`.

```
npm run deploy:amoy
npm run verify:amoy
npm run transfer-ownership:amoy
npx hardhat run scripts/publishAddresses.ts --network amoy
```

`deploy:amoy` keeps the deployer as owner and as a temporary agent so it can
unpause. `transfer-ownership:amoy` then:

- leaves only the Fintech Ops wallet as `AGENT_ROLE`
- recovers `IdentityRegistryStorage` from the factory (T-REX leaves it there)
- moves the token, registries, compliance, factory, both implementation
  authorities and all five module proxies to the Safe

`publishAddresses.ts` writes the public summary to `addresses.json`. Commit that
file after the suite is live. Tag `v0.1.0-m1` only after that commit.

## Checks after handover

On each of token, identity registry, compliance, both claim registries, IRS,
factory, TREX implementation authority, ONCHAINID factory, ONCHAINID
implementation authority, and the five module proxies:

- `owner()` is the Safe
- the deployer is not `owner()`
- the deployer is not an agent on the token or the identity registry
- the Fintech Ops wallet is an agent on the token and the identity registry

The handover script already asserts this. Re-read `deployments/amoy.json`
(gitignored) if you need the raw addresses.

## What verify covers

`verify:amoy` submits the T-REX implementations, the suite proxies, the five
module implementations and their proxies, the factory and the TREX
implementation authority. ONCHAINID factory bytecode comes from the npm
package and is not verified from this repo.

## Do not

- Broadcast without a Safe that already has code on Amoy.
- Re-use the issue #2 Safe addresses. One is unused, one looks like Polygon
  mainnet.
- Add the deployer or the Fintech Ops agent as a Safe owner.
- Commit `.env` or `deployments/amoy.json`.
