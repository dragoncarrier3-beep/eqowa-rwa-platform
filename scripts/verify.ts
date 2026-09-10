import { run, network } from 'hardhat';

import { readDeployment } from './lib/deploymentFile';
import { verificationTargets } from './lib/verificationTargets';

async function verifyOne(name: string, address: string, contract: string, args: unknown[]) {
  try {
    await run('verify:verify', {
      address,
      constructorArguments: args,
      contract,
    });
    console.log('verified', name, address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log('already verified', name, address);
      return;
    }
    throw error;
  }
}

async function main() {
  if (network.name !== 'amoy') {
    throw new Error('Run with --network amoy');
  }

  if (!process.env.POLYGONSCAN_API_KEY) {
    throw new Error('Set POLYGONSCAN_API_KEY in .env');
  }

  const deployment = await readDeployment(network.name);
  const targets = verificationTargets(deployment);
  const failures: string[] = [];

  console.log(`Verifying ${targets.length} contracts on Polygonscan Amoy`);

  for (const target of targets) {
    try {
      await verifyOne(target.name, target.address, target.contract, target.args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('failed', target.name, target.address, message);
      failures.push(`${target.name} (${target.address})`);
    }
  }

  console.log('ONCHAINID factory and implementation authority are package bytecode and are not verified here.');

  if (failures.length > 0) {
    throw new Error(`Verification failed for ${failures.length} contract(s): ${failures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
