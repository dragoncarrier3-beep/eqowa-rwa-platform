import { ethers, network } from 'hardhat';

import { DEPLOYER_ADDRESS } from '../config/wallets';
import { SETTLEMENT_DEPLOY_GAS_ESTIMATE, assertDeployerFunded, assertSafeDeployed } from './lib/amoyPreflight';
import { deploySettlementContracts } from './lib/deploySettlementContracts';
import { readDeployment, withSettlement, writeDeployment } from './lib/deploymentFile';

/**
 * Deploy MockUSDT, the forwarder and the escrow next to an existing suite.
 * The escrow is owned by the suite's Safe from construction.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  if (network.name === 'amoy' && ethers.getAddress(deployerAddress) !== ethers.getAddress(DEPLOYER_ADDRESS)) {
    throw new Error(`Deployer key does not match ${DEPLOYER_ADDRESS}`);
  }

  // The suite record supplies the Safe. Deploying settlement without it would
  // leave the escrow owned by nobody we have agreed on.
  const suite = await readDeployment(network.name);
  const force = process.env.FORCE_SETTLEMENT_DEPLOY === 'true';
  if (suite.settlement && !force) {
    withSettlement(suite, suite.settlement); // throws with the replace hint
  }

  if (network.name === 'amoy') {
    await assertSafeDeployed(ethers.provider, suite.safe);
    await assertDeployerFunded(
      ethers.provider,
      deployerAddress,
      SETTLEMENT_DEPLOY_GAS_ESTIMATE,
      'deploy-settlement:amoy',
    );
  }

  const { record } = await deploySettlementContracts({ deployer, owner: suite.safe });
  const filePath = await writeDeployment(network.name, withSettlement(suite, record, { force }));

  console.log('Settlement deployed. Escrow owner is the Safe', record.owner);
  console.log('Wrote', filePath);
  console.log('');
  console.log('Add to .env for the API and settlement worker:');
  console.log(`TOKEN_ADDRESS=${suite.token}`);
  console.log(`USDT_ADDRESS=${record.usdt}`);
  console.log(`FORWARDER_ADDRESS=${record.forwarder}`);
  console.log(`ESCROW_ADDRESS=${record.escrow}`);
  console.log(`INDEX_FROM_BLOCK=${record.escrowDeployBlock}`);
  console.log('');
  console.log('Next: npm run verify:amoy && npm run publish-addresses');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
