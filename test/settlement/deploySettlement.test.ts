import { expect } from 'chai';
import { ethers } from 'hardhat';

import { SETTLEMENT_DEPLOY_GAS_ESTIMATE, requiredWei } from '../../scripts/lib/amoyPreflight';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';
import { withSettlement, type EqowaDeployment } from '../../scripts/lib/deploymentFile';

async function totalGasUsed(contracts: { deploymentTransaction(): { wait(): Promise<unknown> } | null }[]) {
  let total = 0n;
  for (const contract of contracts) {
    const receipt = (await contract.deploymentTransaction()?.wait()) as { gasUsed: bigint } | null;
    total += receipt?.gasUsed ?? 0n;
  }
  return total;
}

describe('settlement deploy', () => {
  it('deploys USDT, forwarder and escrow with the Safe as escrow owner', async () => {
    const [deployer, safe] = await ethers.getSigners();
    const { usdt, forwarder, escrow, record } = await deploySettlementContracts({ deployer, owner: safe.address });

    expect(await escrow.owner()).to.equal(safe.address);
    expect(await escrow.owner()).to.not.equal(deployer.address);
    expect(await escrow.USDT()).to.equal(await usdt.getAddress());
    expect(await escrow.isTrustedForwarder(await forwarder.getAddress())).to.equal(true);
    expect(await usdt.decimals()).to.equal(6n);

    expect(record.owner).to.equal(safe.address);
    expect(record.escrow).to.equal(await escrow.getAddress());
    expect(record.escrowDeployBlock).to.be.greaterThan(0);
  });

  it('fits inside the pinned gas estimate', async () => {
    const [deployer, safe] = await ethers.getSigners();
    const { usdt, forwarder, escrow } = await deploySettlementContracts({ deployer, owner: safe.address });
    const used = await totalGasUsed([usdt, forwarder, escrow]);

    expect(used).to.be.lessThanOrEqual(SETTLEMENT_DEPLOY_GAS_ESTIMATE);
    // Estimate should track reality, not hide a regression behind a large margin.
    expect(SETTLEMENT_DEPLOY_GAS_ESTIMATE - used).to.be.lessThan(300_000n);
    expect(requiredWei(SETTLEMENT_DEPLOY_GAS_ESTIMATE)).to.be.lessThan(ethers.parseEther('0.2'));
  });

  it('refuses to replace an existing settlement unless forced', () => {
    const settlement = {
      owner: ethers.ZeroAddress,
      usdt: ethers.ZeroAddress,
      forwarder: ethers.ZeroAddress,
      escrow: '0x0000000000000000000000000000000000000001',
      escrowDeployBlock: 1,
    };
    const suite = { network: 'amoy' } as EqowaDeployment;

    const first = withSettlement(suite, settlement);
    expect(first.settlement).to.deep.equal(settlement);
    expect(() => withSettlement(first, settlement)).to.throw('FORCE_SETTLEMENT_DEPLOY');
    expect(
      withSettlement(first, { ...settlement, escrowDeployBlock: 2 }, { force: true }).settlement?.escrowDeployBlock,
    ).to.equal(2);
  });
});
