import { writeFile } from 'node:fs/promises';

import { readDeployment } from './lib/deploymentFile';
import { publicAddressesFromDeployment } from './lib/publicAddresses';

const OUTPUT = 'addresses.json';

async function main() {
  const deployment = await readDeployment(process.env.PUBLISH_NETWORK || 'amoy');
  const published = publicAddressesFromDeployment(deployment);
  await writeFile(OUTPUT, `${JSON.stringify(published, null, 2)}\n`);
  console.log('Wrote', OUTPUT);
  console.log('Token', published.contracts?.token);
  console.log('Safe', published.wallets.safe);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
