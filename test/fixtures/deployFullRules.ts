import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { LOCKUP_DURATION_SECONDS } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from './deployEqowaSuite';

/**
 * Suite fixture with the production 730-day lock-up restored. The shared
 * fixture deploys lock-up at zero so unit tests can transfer immediately.
 */
export async function deployFullRulesFixture() {
  const context = await loadFixture(deployEqowaSuiteFixture);

  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      context.modules.timeLockupModule.interface.encodeFunctionData('setLockupDuration', [LOCKUP_DURATION_SECONDS]),
      await context.modules.timeLockupModule.getAddress(),
    );

  return context;
}
