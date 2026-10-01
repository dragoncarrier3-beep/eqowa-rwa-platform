# Handover checklist

What Eqowa does, in order, to take full control of the platform from the
developer. Tick each line. Nothing here needs the developer's keys; none of
the developer's keys should survive it.

## Repository and accounts

- [ ] The GitHub repository `Flip9ght/eqowa-rwa-platform` is owned by an Eqowa
      account. Remove the developer's access, or reduce it to read.
- [ ] Branch ruleset on `main`: pull request required, CI (`Compile and test`,
      `Web app`) required, no force pushes, no deletions.
- [ ] Rotate every GitHub token and deploy key that was ever shared.
- [ ] AWS: deactivate and delete any IAM access key that was sent by message
      or email. Check CloudTrail for its use. Servers use instance roles, not
      keys.
- [ ] Sumsub, WalletConnect, Polygonscan and the RPC provider: accounts in
      Eqowa's name, API keys regenerated after handover.

## Secrets

- [ ] New `AUTH_SECRET` on every host (sessions signed with the old one stop
      working, which is intended).
- [ ] New Postgres password.
- [ ] Unset `ADMIN_API_KEY` once every admin has two keys enrolled. From then
      on the admin API accepts security keys only.
- [ ] Sumsub webhook secret regenerated and set as `SUMSUB_WEBHOOK_SECRET`.

## Admin keys

- [ ] Each admin enrols two YubiKeys on the production host
      (`WEBAUTHN_RP_ID` = the production host name). Passkeys from testing are
      removed from the Account page.
- [ ] Each admin signs in once with each key.
- [ ] One test recovery run end to end on the test chain, so the operations
      team has done it once before it is needed (see
      [ADMIN_AUTH.md](ADMIN_AUTH.md)).

## Chain

- [ ] The 2-of-3 Safe owns every contract (`npm run preflight:polygon` after
      the handover script; see [MAINNET.md](MAINNET.md)).
- [ ] The deployer key holds no role and no POL, and is destroyed.
- [ ] The agent key is in AWS KMS (`KMS_KEY_ARN`), not in `.env`.
- [ ] The API's claim signing key is a purpose-3 key on the ClaimIssuer, and
      the ClaimIssuer's management key is held by Eqowa, not the deployer.
- [ ] The relayer and the agent have enough POL, with an alert on low balance.

## Operations

- [ ] Backups of the production database, tested by one restore.
- [ ] `deployments/polygon.json` backed up outside the server.
- [ ] The documents bucket is private, with versioning on.
- [ ] Monitoring on `/health` and on the settlement worker's log.
- [ ] `config/eqowa.ts`, the legal pages and the terms version reviewed by
      legal. The legal pages still say "Draft, pending legal review" until then.

## Where things are

| Topic | Document |
| --- | --- |
| Testnet deploy | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Mainnet deploy | [MAINNET.md](MAINNET.md) |
| Shared test chain on AWS | [../deploy/README.md](../deploy/README.md) |
| Admin sign-in and recovery | [ADMIN_AUTH.md](ADMIN_AUTH.md) |
| Lifecycle simulation | [SIMULATION.md](SIMULATION.md) |
| Error codes | [ERRORS.md](ERRORS.md) |
| Gas costs | [GAS.md](GAS.md) |
