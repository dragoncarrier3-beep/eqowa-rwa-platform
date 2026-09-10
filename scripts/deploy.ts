import { ethers, network } from 'hardhat';

import { AGENT_WALLET_ADDRESS, DEPLOYER_ADDRESS } from '../config/wallets';
import { deployEqowaContracts, SUITE_SALT } from './lib/deployEqowaContracts';
import { writeDeployment } from './lib/deploymentFile';

function requiredAddress(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Set ${name} in .env`);
  }

  return ethers.getAddress(value);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  if (network.name === 'amoy' && ethers.getAddress(deployerAddress) !== ethers.getAddress(DEPLOYER_ADDRESS)) {
    throw new Error(`Deployer key does not match ${DEPLOYER_ADDRESS}`);
  }

  const agent = requiredAddress('AGENT_WALLET_ADDRESS', process.env.AGENT_WALLET_ADDRESS ?? AGENT_WALLET_ADDRESS);
  const safe = requiredAddress('GNOSIS_SAFE_ADDRESS', process.env.GNOSIS_SAFE_ADDRESS);

  if (ethers.getAddress(agent) === ethers.getAddress(deployerAddress)) {
    throw new Error('Agent wallet must not be the deployer');
  }
  if (ethers.getAddress(safe) === ethers.getAddress(deployerAddress)) {
    throw new Error('Safe must not be the deployer');
  }

  let claimIssuer = process.env.CLAIM_ISSUER_ADDRESS;
  if (!claimIssuer) {
    const issuer = await ethers.deployContract('ClaimIssuer', [deployerAddress], deployer);
    claimIssuer = await issuer.getAddress();
    console.log('Deployed ClaimIssuer (management key = deployer, move later):', claimIssuer);
  } else {
    claimIssuer = ethers.getAddress(claimIssuer);
  }

  // Suite stays with the deployer so this script can unpause and the handover
  // script can strip AGENT_ROLE before ownership moves to the Safe.
  const suite = await deployEqowaContracts({
    deployer,
    owner: deployerAddress,
    agent,
    claimIssuer,
    includeDeployerAsAgent: true,
  });

  await suite.token.connect(deployer).unpause();

  const filePath = await writeDeployment(network.name, {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    suiteSalt: SUITE_SALT,
    deployer: deployerAddress,
    safe,
    agent,
    claimIssuer,
    token: await suite.token.getAddress(),
    identityRegistry: await suite.identityRegistry.getAddress(),
    identityRegistryStorage: await suite.identityRegistryStorage.getAddress(),
    claimTopicsRegistry: await suite.claimTopicsRegistry.getAddress(),
    trustedIssuersRegistry: await suite.trustedIssuersRegistry.getAddress(),
    compliance: await suite.compliance.getAddress(),
    trexFactory: await suite.trexFactory.getAddress(),
    trexImplementationAuthority: await suite.trexImplementationAuthority.getAddress(),
    identityFactory: await suite.identityFactory.getAddress(),
    identityImplementationAuthority: await suite.identityImplementationAuthority.getAddress(),
    modules: {
      countryAllowlist: await suite.countryAllowModule.getAddress(),
      balanceCap: await suite.maxBalanceModule.getAddress(),
      holderCountCap: await suite.holderCountCapModule.getAddress(),
      timeLockup: await suite.timeLockupModule.getAddress(),
      dailyMintCap: await suite.dailyMintCapModule.getAddress(),
    },
  });

  console.log('EQOWAG suite deployed. Ownership is still the deployer.');
  console.log('Wrote', filePath);
  console.log('Token', await suite.token.getAddress());
  console.log('Next: npm run transfer-ownership:amoy');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
