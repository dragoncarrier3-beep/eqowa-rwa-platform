import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { DAILY_MINT_CAP, LOCKUP_DURATION_SECONDS, MAX_HOLDER_COUNT } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from './deployEqowaSuite';

async function deployAndBind(
  name: string,
  proxyName: 'ModuleProxy' | 'ComplianceModuleProxy',
  context: Awaited<ReturnType<typeof deployEqowaSuiteFixture>>,
  setter: string,
  args: unknown[],
) {
  const implementation = await ethers.deployContract(name, [], context.accounts.deployer);
  const proxy = await ethers.deployContract(
    proxyName,
    [await implementation.getAddress(), implementation.interface.encodeFunctionData('initialize')],
    context.accounts.deployer,
  );
  const module = await ethers.getContractAt(name, await proxy.getAddress());
  const moduleAddress = await module.getAddress();

  await context.suite.compliance.connect(context.accounts.safe).addModule(moduleAddress);
  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(module.interface.encodeFunctionData(setter, args), moduleAddress);

  return module;
}

/**
 * The EQOWAG suite plus the three first-party modules that the smoke fixture
 * leaves unbound, so integration tests can exercise every Phase 1 rule at once.
 */
export async function deployFullRulesFixture() {
  const context = await loadFixture(deployEqowaSuiteFixture);

  const holderCountCapModule = await deployAndBind(
    'HolderCountCapModule',
    'ModuleProxy',
    context,
    'setMaxHolderCount',
    [MAX_HOLDER_COUNT],
  );
  const timeLockupModule = await deployAndBind(
    'TimeLockupModule',
    'ModuleProxy',
    context,
    'setLockupDuration',
    [LOCKUP_DURATION_SECONDS],
  );
  const dailyMintCapModule = await deployAndBind(
    'DailyMintCapModule',
    'ComplianceModuleProxy',
    context,
    'setDailyMintCap',
    [DAILY_MINT_CAP],
  );

  return {
    ...context,
    modules: {
      ...context.modules,
      holderCountCapModule,
      timeLockupModule,
      dailyMintCapModule,
    },
  };
}
