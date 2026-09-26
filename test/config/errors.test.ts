import { expect } from 'chai';
import { artifacts, ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { CUSTOM_ERRORS, REASON_STRINGS, decodeRevert } from '../../config/errors';
import { DAILY_MINT_CAP, ONE_USDT, shareBaseUnits } from '../../config/eqowa';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';
import { deployFullRulesFixture } from '../fixtures/deployFullRules';

async function rejection(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to revert');
}

describe('revert messages', () => {
  it('has a message for every custom error declared in first-party contracts', async () => {
    const names = (await artifacts.getAllFullyQualifiedNames()).filter(
      (name) => name.startsWith('contracts/compliance/') || name.startsWith('contracts/escrow/'),
    );
    const declared = new Set<string>();
    for (const name of names) {
      const { abi } = await artifacts.readArtifact(name);
      for (const fragment of new ethers.Interface(abi).fragments) {
        if (fragment.type === 'error') {
          declared.add((fragment as ethers.ErrorFragment).format('sighash'));
        }
      }
    }

    expect(declared.size).to.be.greaterThan(10);
    for (const signature of declared) {
      expect(CUSTOM_ERRORS, `no message for ${signature}`).to.have.property(signature);
    }
    for (const entry of [...Object.values(CUSTOM_ERRORS), ...Object.values(REASON_STRINGS)]) {
      expect(entry.code).to.match(/^[a-z_]+$/);
      expect(entry.message).to.match(/\.$/);
    }
  });

  it('decodes a T-REX reason string from a real revert', async () => {
    const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

    const error = await rejection(suite.token.connect(accounts.tokenAgent).mint(accounts.charlie.address, 1n));

    expect(decodeRevert(error)).to.include({ code: 'identity_not_verified', source: 'reason' });
  });

  it('decodes a compliance block on transfer', async () => {
    const { accounts, suite } = await loadFixture(deployFullRulesFixture);
    await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, shareBaseUnits(10n));

    // Locked for 730 days, so compliance refuses.
    const error = await rejection(
      suite.token.connect(accounts.alice).transfer(accounts.bob.address, shareBaseUnits(1n)),
    );

    expect(decodeRevert(error).code).to.equal('transfer_not_compliant');
  });

  it('decodes the daily mint cap as a compliance block', async () => {
    const { accounts, suite } = await loadFixture(deployFullRulesFixture);

    const error = await rejection(
      suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, DAILY_MINT_CAP + 1n),
    );

    expect(decodeRevert(error).code).to.equal('mint_not_compliant');
  });

  it('decodes a first-party custom error from the escrow', async () => {
    const [deployer, safe, investor] = await ethers.getSigners();
    const { usdt, escrow } = await deploySettlementContracts({ deployer, owner: safe.address });
    await usdt.mint(investor.address, 10n * ONE_USDT);
    await usdt.connect(investor).approve(await escrow.getAddress(), 10n * ONE_USDT);
    await escrow.connect(investor).deposit(ethers.id('once'), 5n * ONE_USDT);

    const error = await rejection(escrow.connect(investor).deposit(ethers.id('once'), 5n * ONE_USDT));

    expect(decodeRevert(error)).to.include({ code: 'intent_already_used', source: 'custom', raw: 'IntentAlreadyUsed' });
  });

  it('decodes an OpenZeppelin allowance revert and an owner-only call', async () => {
    const [deployer, safe, investor] = await ethers.getSigners();
    const { usdt, escrow } = await deploySettlementContracts({ deployer, owner: safe.address });
    await usdt.mint(investor.address, 10n * ONE_USDT);

    const allowance = await rejection(escrow.connect(investor).deposit(ethers.id('no-approve'), 5n * ONE_USDT));
    const owner = await rejection(escrow.connect(investor).sweep(await usdt.getAddress(), investor.address, 1n));

    expect(decodeRevert(allowance).code).to.equal('insufficient_allowance');
    expect(decodeRevert(owner).code).to.equal('not_owner');
  });

  it('keeps an unrecognised error readable instead of hiding it', () => {
    expect(decodeRevert(new Error('socket hang up'))).to.deep.equal({
      code: 'reverted',
      message: 'socket hang up',
      source: 'unknown',
      raw: 'socket hang up',
    });
  });
});
