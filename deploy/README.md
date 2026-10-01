# Shared test chain on AWS

One server runs a private test blockchain and the whole platform on it, so the
three admins can use the portal from their own browsers, with their own keys,
before anything touches a public network.

| Service  | What it is                                                     | Reachable at                   |
| -------- | -------------------------------------------------------------- | ------------------------------ |
| anvil    | Test chain, chain id 31337, a block every 2 seconds, state kept | inside Docker only             |
| postgres | Database for the API                                           | inside Docker only             |
| api      | API, settlement worker, token indexer, on-chain onboarding     | `https://api.eqowa.com`        |
| web      | Investor portal and admin dashboard                            | `https://app.eqowa.com`        |
| caddy    | TLS certificates and the two host names                        | ports 80 and 443               |

The chain's JSON-RPC is served as `POST https://api.eqowa.com/rpc`. It allows
reads and signed transactions only. Anvil's built-in accounts are unlocked, so
Anvil itself is never exposed.

Nothing on this chain has value. Its built-in keys are public, the "Safe" is a
plain test account, and a reset wipes it.

## 1. Server

- EC2 `t3.small` (2 GB) or larger, Ubuntu 24.04, 30 GB disk, in the account's
  usual region.
- Elastic IP attached. Current server: `13.49.200.188`.
- Security group: inbound 22 from the admins' IPs only, 80 and 443 from anywhere.
  Nothing else.
- Optional, for documents in S3: an instance role with `s3:PutObject`,
  `s3:GetObject` and `s3:DeleteObject` on the bucket. No access keys go on the
  server.

Install Docker:

```
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu   # log out and in again
```

## 2. DNS

Two A records pointing at the elastic IP:

```
app.eqowa.com  A  13.49.200.188
api.eqowa.com  A  13.49.200.188
```

Check with `nslookup app.eqowa.com` before starting Caddy, or the certificate
request fails and Let's Encrypt rate-limits retries.

## 3. Configure

```
git clone https://github.com/Flip9ght/eqowa-rwa-platform.git
cd eqowa-rwa-platform/deploy
cp .env.example .env
nano .env        # fill in every empty value except ADMIN_API_KEY and DOCUMENTS_BUCKET
chmod 600 .env
```

## 4. Start and seed

```
docker compose -f docker-compose.aws.yml up -d --build
docker compose -f docker-compose.aws.yml --profile seed run --rm seed
docker compose -f docker-compose.aws.yml restart api
```

The seed deploys the token suite and the settlement contracts with the same
scripts used on Amoy, runs the lifecycle simulation (three investors, a
purchase, a freeze, a refund) and writes the contract addresses to the state
volume. It takes a few minutes. Running it again keeps the existing contracts.

Check:

```
curl https://api.eqowa.com/health
curl https://api.eqowa.com/assets
docker compose -f docker-compose.aws.yml logs -f api
```

## 5. Admins

Invite each admin from the server. Each command prints a one-time link valid
for 72 hours; send it to the person directly.

```
docker compose -f docker-compose.aws.yml exec api npm --prefix apps/api run admin:invite -- larryjacob@eqowa.com operations "Larry Jacob"
docker compose -f docker-compose.aws.yml exec api npm --prefix apps/api run admin:invite -- info@eqowa.com ceo "CEO"
docker compose -f docker-compose.aws.yml exec api npm --prefix apps/api run admin:invite -- legal@eqowa.com compliance "Compliance"
```

Each admin opens the link on `https://app.eqowa.com`, enrols a passkey or
YubiKey, then a second one from the Account page. Keys enrolled here work only
on `app.eqowa.com`.

## 6. Wallets

In MetaMask, add a network:

| Field           | Value                          |
| --------------- | ------------------------------ |
| Network name    | EQOWA test chain               |
| RPC URL         | `https://api.eqowa.com/rpc`    |
| Chain ID        | `31337`                        |
| Currency symbol | `ETH`                          |

Investors need no gas: approvals and deposits are relayed. To give a test
investor MockUSDT (its mint is open on test chains), from the server:

```
docker compose -f docker-compose.aws.yml exec -e SHARED_RPC_URL=http://anvil:8545 api sh -c "cd /repo && npx hardhat console --network shared"
> const usdt = await ethers.getContractAt('MockUSDT', '<USDT_ADDRESS from /state/shared.env>')
> await usdt.mint('<investor wallet>', 10_000_000_000n)   // 10,000 USDT, 6 decimals
```

`cat` the addresses with
`docker compose -f docker-compose.aws.yml exec api cat /state/shared.env`.

## Updating

```
git pull
docker compose -f docker-compose.aws.yml up -d --build
```

The chain, database, documents and certificates live in named volumes and
survive updates. Scan a pulled tree before building.

## Reset

Wipes the chain and the database, keeps certificates:

```
docker compose -f docker-compose.aws.yml down
docker volume rm eqowa-shared_chain eqowa-shared_pg eqowa-shared_state
```

Then step 4 again, and invite the admins again.

## Backups

The test chain needs none. For the database:

```
docker compose -f docker-compose.aws.yml exec postgres pg_dump -U eqowa eqowa > eqowa-$(date +%F).sql
```
