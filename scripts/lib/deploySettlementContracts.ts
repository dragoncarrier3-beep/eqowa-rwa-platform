import { ethers } from 'hardhat';
import type { Signer } from 'ethers';

import type { SettlementDeployment } from './deploymentFile';

export type DeploySettlementParams = {
  deployer: Signer;
  /** Escrow owner. The Safe in production, so no handover step is needed. */
  owner: string;
};

/**
 * The ERC-2771 forwarder and the escrow against a USDT that already exists.
 * The escrow constructor takes its owner directly, so the deployer never holds
 * refund or sweep rights.
 */
async function deployForwarderAndEscrow(deployer: Signer, owner: string, usdtAddress: string) {
  const forwarder = await ethers.deployContract('EqowaMinimalForwarder', [], deployer);
  await forwarder.waitForDeployment();

  const forwarderAddress = await forwarder.getAddress();
  const escrow = await ethers.deployContract('Escrow', [usdtAddress, owner, forwarderAddress], deployer);
  await escrow.waitForDeployment();

  const escrowReceipt = await escrow.deploymentTransaction()?.wait();
  if (!escrowReceipt) {
    throw new Error('Escrow deployment has no receipt');
  }

  const record: SettlementDeployment = {
    owner,
    usdt: usdtAddress,
    forwarder: forwarderAddress,
    escrow: await escrow.getAddress(),
    escrowDeployBlock: escrowReceipt.blockNumber,
  };
  return { forwarder, escrow, record };
}

/**
 * Mock USDT, the ERC-2771 forwarder and the escrow, in that order. Amoy and
 * the test chains have no official USDT; MockUSDT stands in with the same 6
 * decimals and meta-transactions as native Polygon USDT.
 */
export async function deploySettlementContracts(params: DeploySettlementParams) {
  const { deployer } = params;
  const owner = ethers.getAddress(params.owner);

  const usdt = await ethers.deployContract('MockUSDT', [], deployer);
  await usdt.waitForDeployment();
  const deployed = await deployForwarderAndEscrow(deployer, owner, await usdt.getAddress());
  return { usdt, ...deployed };
}

/**
 * Forwarder and escrow against the chain's native USDT (Polygon mainnet). The
 * address must have code: an escrow bound to an empty address could never
 * receive a deposit and would have to be redeployed.
 */
export async function deploySettlementForUsdt(params: DeploySettlementParams & { usdtAddress: string }) {
  const { deployer } = params;
  const owner = ethers.getAddress(params.owner);
  const usdtAddress = ethers.getAddress(params.usdtAddress);
  const provider = deployer.provider ?? ethers.provider;
  if ((await provider.getCode(usdtAddress)) === '0x') {
    throw new Error(`USDT ${usdtAddress} has no code on this network`);
  }
  return deployForwarderAndEscrow(deployer, owner, usdtAddress);
}
