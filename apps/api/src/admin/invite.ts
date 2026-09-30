import { isAdminRole, ADMIN_ROLES } from '../../../../config/adminRoles.ts';

import { inviteAdmin } from '../auth/adminAuth.ts';
import { createStores, loadEnv } from '../bootstrap.ts';

/**
 * Bootstraps an admin from the command line, for the first admin before
 * anyone can use the team page:
 *
 *   npm run api:admin:invite -- larryjacob@eqowa.com operations "Larry Jacob"
 *
 * Prints a single-use enrolment link, valid for 72 hours. Open it on the
 * machine with the security key; the key is bound to WEB_ORIGIN's host.
 */
async function main() {
  loadEnv();
  const [email, role, ...nameParts] = process.argv.slice(2);
  if (!email || !isAdminRole(role)) {
    console.error(`usage: npm run api:admin:invite -- <email> <${ADMIN_ROLES.join('|')}> [name]`);
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set: an invite in memory would vanish when this command exits.');
    process.exitCode = 1;
    return;
  }

  const stores = createStores();
  try {
    const result = await inviteAdmin({
      store: stores.admins,
      email,
      name: nameParts.join(' '),
      role,
      createdBy: 'cli',
      webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
      now: new Date(),
    });
    if ('error' in result) {
      console.error(result.error === 'admin_active' ? `${email} is already active.` : `${email} is not a valid email.`);
      process.exitCode = 1;
      return;
    }
    await stores.mintStore.appendAudit({
      actor: 'cli',
      action: 'admin.invited',
      payload: { adminId: result.admin.id, email: result.admin.email, role: result.admin.role },
    });
    console.log(
      `Invite for ${result.admin.email} (${result.admin.role}), valid until ${result.expiresAt.toISOString()}:`,
    );
    console.log(result.inviteUrl);
  } finally {
    await stores.pool?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
