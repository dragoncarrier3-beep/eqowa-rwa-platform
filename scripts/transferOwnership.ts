import { ethers, network } from 'hardhat';

import { DEPLOYER_ADDRESS } from '../config/wallets';
import { readDeployment } from './lib/deploymentFile';
import { assertDeployerHasNoAdmin, handoverOwnership } from './lib/handoverOwnership';

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployment = await readDeployment(network.name);

  if (ethers.getAddress(deployerAddress) !== ethers.getAddress(deployment.deployer)) {
    throw new Error('This key is not the deployer recorded in the deployment file');
  }

  if (network.name === 'amoy' && ethers.getAddress(deployerAddress) !== ethers.getAddress(DEPLOYER_ADDRESS)) {
    throw new Error(`Deployer key does not match ${DEPLOYER_ADDRESS}`);
  }

  const safe = ethers.getAddress(process.env.GNOSIS_SAFE_ADDRESS || deployment.safe);
  if (safe !== ethers.getAddress(deployment.safe)) {
    throw new Error('GNOSIS_SAFE_ADDRESS does not match the deployment file');
  }

  await handoverOwnership(
    {
      safe,
      agent: deployment.agent,
      deployer: deployerAddress,
      token: deployment.token,
      identityRegistry: deployment.identityRegistry,
      identityRegistryStorage: deployment.identityRegistryStorage,
      compliance: deployment.compliance,
      claimTopicsRegistry: deployment.claimTopicsRegistry,
      trustedIssuersRegistry: deployment.trustedIssuersRegistry,
      trexFactory: deployment.trexFactory,
      trexImplementationAuthority: deployment.trexImplementationAuthority,
      identityFactory: deployment.identityFactory,
      identityImplementationAuthority: deployment.identityImplementationAuthority,
      modules: Object.values(deployment.modules),
    },
    deployer,
  );

  await assertDeployerHasNoAdmin({
    safe,
    agent: deployment.agent,
    deployer: deployerAddress,
    token: deployment.token,
    identityRegistry: deployment.identityRegistry,
    identityRegistryStorage: deployment.identityRegistryStorage,
    compliance: deployment.compliance,
    claimTopicsRegistry: deployment.claimTopicsRegistry,
    trustedIssuersRegistry: deployment.trustedIssuersRegistry,
    trexFactory: deployment.trexFactory,
    trexImplementationAuthority: deployment.trexImplementationAuthority,
    identityFactory: deployment.identityFactory,
    identityImplementationAuthority: deployment.identityImplementationAuthority,
    modules: Object.values(deployment.modules),
  });

  console.log('Handover complete. Deployer has no remaining admin rights.');
  console.log('Safe', safe);
  console.log('Agent', deployment.agent);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
