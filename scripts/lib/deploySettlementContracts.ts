import { ethers } from 'hardhat';
import type { Signer } from 'ethers';

import type { SettlementDeployment } from './deploymentFile';

export type DeploySettlementParams = {
  deployer: Signer;
  /** Escrow owner. The Safe in production, so no handover step is needed. */
  owner: string;
};

/**
 * Mock USDT, the ERC-2771 forwarder and the escrow, in that order.
 *
 * The escrow constructor takes its owner directly, so the deployer never holds
 * refund or sweep rights. Amoy has no official USDT; MockUSDT stands in with
 * the same 6 decimals as native Polygon USDT.
 */
export async function deploySettlementContracts(params: DeploySettlementParams) {
  const { deployer } = params;
  const owner = ethers.getAddress(params.owner);

  const usdt = await ethers.deployContract('MockUSDT', [], deployer);
  await usdt.waitForDeployment();
  const forwarder = await ethers.deployContract('EqowaMinimalForwarder', [], deployer);
  await forwarder.waitForDeployment();

  const usdtAddress = await usdt.getAddress();
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

  return { usdt, forwarder, escrow, record };
}
