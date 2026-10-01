# Polygon mainnet runbook

Polygon PoS, chain 137. This is the order of operations for Eqowa's launch
engineer. The scripts are ready and tested; running them is Eqowa's call and is
outside Phase 1. Nothing here has been executed on mainnet.

The Amoy runbook in [DEPLOYMENT.md](DEPLOYMENT.md) is the same flow. Differences
on mainnet:

| | Amoy | Polygon mainnet |
| --- | --- | --- |
| USDT | MockUSDT, deployed by the settlement script | Native USDT `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`, not deployed |
| Gas price | Pinned at 30 gwei | Quoted by the network (EIP-1559) |
| Deployer key | `DEPLOYER_PRIVATE_KEY` | `POLYGON_DEPLOYER_PRIVATE_KEY`, a new key used only for this |
| Safe | Created by `create-safe:amoy` | Created in the Safe app (app.safe.global), owners on hardware wallets |
| Preflight | Inside the deploy scripts | `npm run preflight:polygon`, before and after |

## 1. Decide and prepare

1. **RPC provider.** A paid Polygon endpoint (Alchemy, QuickNode, Infura or
   similar). Public RPCs rate-limit `eth_getLogs`, which the indexer and the
   settlement worker depend on. Set `POLYGON_RPC_URL`.
2. **Safe.** Create a 2-of-3 Safe on Polygon in the Safe app. Owners are three
   people on hardware wallets. The deployer, the agent and the relayer must
   not be owners. Set `GNOSIS_SAFE_ADDRESS` and `MAINNET_SAFE_OWNERS`
   (comma separated).
3. **Keys.**
   - Deployer: a fresh key, `POLYGON_DEPLOYER_PRIVATE_KEY`, and its address as
     `DEPLOYER_ADDRESS_POLYGON`. Discard it after the handover.
   - Agent (mints, burns, freezes, registers investors): AWS KMS
     (`KMS_KEY_ARN`), not a key in `.env`. Its address is
     `AGENT_WALLET_ADDRESS`.
   - Relayer (pays gas for investors' approvals and deposits):
     `RELAYER_PRIVATE_KEY` on the server only, its address as
     `RELAYER_ADDRESS`. It can be the agent.
4. **Claim issuer.** Either an existing ClaimIssuer (`CLAIM_ISSUER_ADDRESS`), or
   leave it empty and the deploy creates one whose management key is the
   deployer. In that case add the API's claim signing key (purpose 3) and a
   Safe-held management key, then remove the deployer key, before launch.
   Set `CLAIM_SIGNER_ADDRESS` to the claim signing key's address.
5. **Money.** 10 POL on the deployer covers the deploy at up to about 220
   gwei. 5 POL or more on the agent and on the relayer, topped up as volume
   grows.

Token name, supply rules, caps, lock-up and the country list come from
`config/eqowa.ts`, the same file Amoy used. Review it with legal before the
deploy. Changes afterwards are Safe transactions.

## 2. Rehearse on a fork

Run the whole sequence against a local fork of mainnet first. It uses the real
USDT and the real Safe and costs nothing.

```
anvil --fork-url $POLYGON_RPC_URL --chain-id 137 --hardfork prague
```

In another shell, point the `polygon` network at the fork and use Anvil's
first test key as the deployer:

```
POLYGON_RPC_URL=http://127.0.0.1:8545 \
POLYGON_DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
DEPLOYER_ADDRESS_POLYGON=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  npm run deploy:polygon && npm run deploy-settlement:polygon && npm run preflight:polygon
```

The ownership handover cannot be rehearsed end to end on a fork without the
Safe owners' keys; check that the Safe is the pending owner instead.

Delete `deployments/polygon.json` after the rehearsal.

`deployTREXSuite` is one transaction that needs a gas limit of about 19.6M
(it uses about 6.5M). If Polygon has enabled a per-transaction gas cap
(EIP-7825, 16,777,216) by launch day, the fork shows it. In that case send
that call with an explicit `gasLimit` of 16,000,000.

## 3. Preflight

```
npm run preflight:polygon
```

Read-only. Before the deploy it checks:

- USDT has code, 6 decimals, and the meta-transaction domain the contract
  reports matches the one `config/usdtMetaTx.ts` builds. If this fails, gasless
  approvals would all be refused.
- The Safe has code, a threshold of at least 2, the owners in
  `MAINNET_SAFE_OWNERS`, and none of the deployer, agent or relayer as owner.
- The deployer, agent and relayer hold enough POL.

Every line must read PASS before going on.

## 4. Deploy

```
npm run deploy:polygon
npm run deploy-settlement:polygon
npm run verify:polygon
```

`deploy:polygon` refuses to run when the Safe has no code. `deploy-settlement`
sees chain 137, skips MockUSDT and binds the escrow to native USDT, with the
Safe as escrow owner from construction. `deployments/polygon.json` holds every
address; it is gitignored, so back it up.

## 5. Hand over ownership

```
npm run transfer-ownership:polygon
```

Moves the token, registries, compliance, both implementation authorities, the
factories and all five modules to the Safe, leaves only the agent with
`AGENT_ROLE`, and asserts that the deployer holds nothing. The escrow already
belongs to the Safe.

Then run the preflight again. With `deployments/polygon.json` present it also
checks:

- the agent is an agent of the token and of the identity registry
- the claim signing key is a purpose-3 key on the ClaimIssuer
- the token, identity registry, compliance and escrow are owned by the Safe

## 6. Point the platform at mainnet

On the production host, in `.env`:

```
RPC_URL=<POLYGON_RPC_URL>
CHAIN_ID=137
TOKEN_ADDRESS, USDT_ADDRESS, ESCROW_ADDRESS, FORWARDER_ADDRESS,
IDENTITY_REGISTRY_ADDRESS, IDENTITY_IMPLEMENTATION_AUTHORITY_ADDRESS,
CLAIM_ISSUER_ADDRESS, GNOSIS_SAFE_ADDRESS and the five *_MODULE_ADDRESS values
  from deployments/polygon.json
INDEX_FROM_BLOCK=<settlement.escrowDeployBlock>
TOKEN_INDEX_FROM_BLOCK=<block of the deployTREXSuite transaction>
KMS_KEY_ARN=<agent key>
RELAYER_PRIVATE_KEY=<relayer key>
CLAIM_ISSUER_SIGNING_KEY=<claim signing key>
```

Leave `RPC_PROXY_URL` unset: `/rpc` is for the test chain only. Web build:
`NEXT_PUBLIC_CHAIN_ID=137` and `NEXT_PUBLIC_RPC_URL` set to a public read
endpoint. The wallet network guard then asks investors for Polygon.

Use a new, empty database and new `AUTH_SECRET`. Admin keys are bound to the
host name, so admins enrol on the production host even if they already did on
the test chain (see [ADMIN_AUTH.md](ADMIN_AUTH.md)).

## 7. First purchase

Before announcing, one real purchase end to end with a small amount from a
team wallet: KYC, quote, gasless approval, deposit, 12 confirmations, mint,
shares in the portfolio. Then the handover checklist in
[HANDOVER.md](HANDOVER.md).
