# Admin sign-in

Admins sign in with security keys only (WebAuthn / FIDO2): YubiKeys in
production, platform passkeys (Windows Hello, Touch ID) while testing. There
are no passwords. Investors sign in with their wallet (SIWE) and never see the
admin area.

## Roles

Defined in `config/adminRoles.ts`; the API checks the permission on every admin
route and the portal hides what a role cannot use.

| Role | Who | Can |
| --- | --- | --- |
| `ceo` | info@eqowa.com | View everything. Open a key recovery. High-value sign-off happens as a Safe signer, not in the portal |
| `operations` | larryjacob@eqowa.com | Everything: 100k mint approvals, mint, burn, pause, compliance changes (prepared for the Safe), documents, team, recovery approval |
| `compliance` | legal@eqowa.com | View everything, KYC review, freeze and unfreeze, the exception queue, open a key recovery |

## Keys

- Invites are one-time links, valid for 72 hours, printed by
  `npm run api:admin:invite -- <email> <role> [name]` or sent from the Team
  page by an operations admin.
- Each admin enrols two keys: one carried, one kept safe. The portal shows a
  banner until the second key is enrolled. Up to five keys per admin.
- The last key cannot be removed from the Account page.
- Sessions last 12 hours in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- Keys are bound to the host name (`WEBAUTHN_RP_ID`). Keys enrolled on
  `localhost` or the test chain host do not work on another host, so the
  production YubiKeys are enrolled on the production host.

## Lost keys (break-glass)

An admin who lost both keys cannot sign in. To reset them:

1. Any other admin opens a recovery on the Key recovery page, naming the admin
   and what happened.
2. Confirm the person's identity outside the portal (a call, in person).
3. Two Safe signers record their agreement in the Safe app (a signed message
   or a zero-value transaction). Copy its Safe transaction hash.
4. A different operations admin, not the one who opened it and not the one
   being reset, pastes the hash and approves.
5. All of that admin's keys are removed at once, open sessions stop working,
   and a new invite link is shown once. Send it to the person directly.

Everything is in the audit log (`admin.recovered`, `admin.recovery_rejected`).

If no other operations admin can approve (for example the only one lost both
keys), run the fallback on the server itself, with the same Safe evidence:

```
npm run api:admin:recover -- larryjacob@eqowa.com 0x<safe tx hash> "Both YubiKeys lost"
```

It needs shell access to the server and prints a fresh invite.

## Legacy admin key

`ADMIN_API_KEY` (header `x-admin-key`) still works and acts as the operations
role, for scripts written before WebAuthn. Unset it once every admin has two
keys; see [HANDOVER.md](HANDOVER.md).
