import { ethers, network } from 'hardhat';

import {
  AMOY_SAFE_OWNERS,
  AMOY_SAFE_THRESHOLD,
  AGENT_WALLET_ADDRESS,
  DEPLOYER_ADDRESS,
  SAFE_V141,
} from '../config/wallets';
import { MIN_SAFE_CREATE_WEI, assertDeployerFunded } from './lib/amoyPreflight';

const FACTORY_ABI = [
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'function proxyCreationCode() view returns (bytes)',
  'event ProxyCreation(address indexed proxy, address singleton)',
];

const SAFE_SETUP_ABI = [
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
];

const SALT_NONCE = BigInt(ethers.id('EQOWA_AMOY_SAFE_V1'));

function assertSafeOwners() {
  const owners = AMOY_SAFE_OWNERS.map((owner) => ethers.getAddress(owner));
  const unique = new Set(owners);

  if (owners.length !== 3 || unique.size !== 3) {
    throw new Error('Amoy Safe must have exactly three distinct owners');
  }

  if (owners.includes(ethers.getAddress(DEPLOYER_ADDRESS))) {
    throw new Error('Deployer must not be a Safe owner');
  }

  if (owners.includes(ethers.getAddress(AGENT_WALLET_ADDRESS))) {
    throw new Error('Agent wallet must not be a Safe owner');
  }

  return owners;
}

function predictProxyAddress(factory: string, singleton: string, initializer: string, creationCode: string): string {
  const salt = ethers.solidityPackedKeccak256(['bytes32', 'uint256'], [ethers.keccak256(initializer), SALT_NONCE]);
  const initCode = ethers.concat([creationCode, ethers.zeroPadValue(singleton, 32)]);
  return ethers.getCreate2Address(factory, salt, ethers.keccak256(initCode));
}

async function main() {
  if (network.name !== 'amoy') {
    throw new Error('Run with --network amoy. This script creates the live testnet Safe.');
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  if (ethers.getAddress(deployerAddress) !== ethers.getAddress(DEPLOYER_ADDRESS)) {
    throw new Error(`Deployer key does not match ${DEPLOYER_ADDRESS}`);
  }

  await assertDeployerFunded(ethers.provider, deployerAddress, MIN_SAFE_CREATE_WEI, 'create-safe:amoy');

  const owners = assertSafeOwners();
  const factory = new ethers.Contract(SAFE_V141.proxyFactory, FACTORY_ABI, deployer);
  const singleton = SAFE_V141.safeL2;

  const factoryCode = await ethers.provider.getCode(SAFE_V141.proxyFactory);
  const singletonCode = await ethers.provider.getCode(singleton);

  if (factoryCode === '0x' || singletonCode === '0x') {
    throw new Error('Safe 1.4.1 factory or singleton is missing on this network');
  }

  const setup = new ethers.Interface(SAFE_SETUP_ABI);
  const initializer = setup.encodeFunctionData('setup', [
    owners,
    AMOY_SAFE_THRESHOLD,
    ethers.ZeroAddress,
    '0x',
    SAFE_V141.fallbackHandler,
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress,
  ]);

  const creationCode: string = await factory.proxyCreationCode();
  const predicted = predictProxyAddress(SAFE_V141.proxyFactory, singleton, initializer, creationCode);

  console.log('Network:          Polygon Amoy (80002)');
  console.log('Deployer:         ', deployerAddress);
  console.log('Owners (2 of 3):  ', owners.join(', '));
  console.log('Predicted Safe:   ', predicted);
  console.log('Explorer:         ', `https://amoy.polygonscan.com/address/${predicted}`);

  const existing = await ethers.provider.getCode(predicted);
  if (existing !== '0x') {
    const safe = new ethers.Contract(predicted, SAFE_SETUP_ABI, ethers.provider);
    console.log('Already deployed. Owners:', await safe.getOwners());
    console.log('Threshold:', await safe.getThreshold());
    return;
  }

  const tx = await factory.createProxyWithNonce(singleton, initializer, SALT_NONCE);
  console.log('Submitted:        ', tx.hash);
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error('Safe creation transaction was not mined');
  }

  const safe = new ethers.Contract(predicted, SAFE_SETUP_ABI, ethers.provider);
  const onChainOwners: string[] = await safe.getOwners();
  const threshold: bigint = await safe.getThreshold();

  if (threshold !== BigInt(AMOY_SAFE_THRESHOLD)) {
    throw new Error(`Threshold mismatch: got ${threshold}`);
  }

  for (const owner of owners) {
    if (!onChainOwners.map((item) => ethers.getAddress(item)).includes(owner)) {
      throw new Error(`Owner ${owner} missing on the created Safe`);
    }
  }

  console.log('Safe created:     ', predicted);
  console.log('On-chain owners:  ', onChainOwners.join(', '));
  console.log('Threshold:        ', threshold.toString());
  console.log('');
  console.log('Put this in .env: GNOSIS_SAFE_ADDRESS=' + predicted);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
