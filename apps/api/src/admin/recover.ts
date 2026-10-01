import { approveRecovery } from '../auth/recovery.ts';
import { createStores, loadEnv } from '../bootstrap.ts';

/**
 * Last-resort break-glass from the server itself, for when no other
 * operations admin can approve a recovery in the portal (for example the only
 * operations admin lost both keys):
 *
 *   npm run api:admin:recover -- larryjacob@eqowa.com 0x<safe tx hash> "Both YubiKeys lost"
 *
 * Needs shell access to the server and the hash of the Safe transaction or
 * message in which the Safe signers agreed. Prints a fresh invite link.
 */
async function main() {
  loadEnv();
  const [email, safeTxHash, ...reasonParts] = process.argv.slice(2);
  const reason = reasonParts.join(' ').trim();
  if (!email || !safeTxHash || !reason) {
    console.error('usage: npm run api:admin:recover -- <email> <safe tx hash> "<reason>"');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const stores = createStores();
  try {
    const admin = await stores.admins.getAdminByEmail(email);
    if (!admin) {
      console.error(`No admin with email ${email}.`);
      process.exitCode = 1;
      return;
    }
    const now = new Date();
    const ticket =
      (await stores.recoveries.openFor(admin.id)) ??
      (await stores.recoveries.open({ adminId: admin.id, requestedBy: 'server-shell', reason, now }));
    const result = await approveRecovery({
      tickets: stores.recoveries,
      admins: stores.admins,
      ticketId: ticket.id,
      approver: { actor: 'server-cli', adminId: null },
      safeTxHash,
      webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
      audit: (entry) => stores.mintStore.appendAudit(entry),
      now,
    });
    if ('error' in result) {
      console.error(`Recovery refused: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Keys of ${admin.email} removed. New invite, valid until ${result.expiresAt.toISOString()}:`);
    console.log(result.inviteUrl);
  } finally {
    await stores.pool?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
