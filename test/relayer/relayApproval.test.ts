import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { TypedDataEncoder, type Signer } from 'ethers';

import { ONE_USDT } from '../../config/eqowa';
import { encodeEscrowDeposit, FORWARD_REQUEST_TYPES, forwarderDomain } from '../../config/forwarder';
import { RelayRefused, USDT_META_IFACE, relayEscrowDeposit, relayUsdtApproval } from '../../config/relayer';
import { META_TRANSACTION_TYPES, usdtMetaDomain } from '../../config/usdtMetaTx';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';

const TYPES = { MetaTransaction: [...META_TRANSACTION_TYPES.MetaTransaction] };

async function deployFixture() {
  const [owner, alice, relayer, mallory] = await ethers.getSigners();
  const { forwarder, usdt, escrow } = await deploySettlementContracts({ deployer: owner, owner: owner.address });
  await usdt.mint(alice.address, 100n * ONE_USDT);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const usdtAddress = await usdt.getAddress();
  const escrowAddress = await escrow.getAddress();
  const domain = usdtMetaDomain({ name: await usdt.name(), verifyingContract: usdtAddress, chainId });
  return { owner, alice, relayer, mallory, forwarder, usdt, escrow, chainId, usdtAddress, escrowAddress, domain };
}

async function signMeta(
  signer: Signer,
  domain: ReturnType<typeof usdtMetaDomain>,
  nonce: bigint,
  from: string,
  functionSignature: string,
) {
  return signer.signTypedData(domain, TYPES, { nonce, from, functionSignature });
}

describe('Gasless USDT approval (Polygon meta-transactions)', () => {
  it('matches the Polygon EIP-712 domain with the chain id as salt', async () => {
    const { usdt, domain } = await loadFixture(deployFixture);
    expect(await usdt.getDomainSeperator()).to.equal(TypedDataEncoder.hashDomain(domain));
    expect(await usdt.ERC712_VERSION()).to.equal('1');
  });

  it('lets a relayer submit the investor approval so the investor pays no gas', async () => {
    const { alice, relayer, usdt, chainId, usdtAddress, escrowAddress, domain } = await loadFixture(deployFixture);
    const data = USDT_META_IFACE.encodeFunctionData('approve', [escrowAddress, 10n * ONE_USDT]);
    const signature = await signMeta(alice, domain, 0n, alice.address, data);
    const aliceGasBefore = await ethers.provider.getBalance(alice.address);

    const relayed = await relayUsdtApproval({
      input: { from: alice.address, functionSignature: data, signature },
      usdtAddress,
      escrowAddress,
      chainId,
      relayer,
      expectedFrom: alice.address,
    });

    expect(relayed.spender).to.equal(escrowAddress);
    expect(relayed.amount).to.equal(10n * ONE_USDT);
    expect(await usdt.allowance(alice.address, escrowAddress)).to.equal(10n * ONE_USDT);
    expect(await usdt.getNonce(alice.address)).to.equal(1n);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(aliceGasBefore);
  });

  it('then the gasless deposit goes through with the relayed approval', async () => {
    const { alice, relayer, forwarder, escrow, chainId, usdtAddress, escrowAddress, domain } =
      await loadFixture(deployFixture);
    const data = USDT_META_IFACE.encodeFunctionData('approve', [escrowAddress, 5n * ONE_USDT]);
    await relayUsdtApproval({
      input: {
        from: alice.address,
        functionSignature: data,
        signature: await signMeta(alice, domain, 0n, alice.address, data),
      },
      usdtAddress,
      escrowAddress,
      chainId,
      relayer,
    });

    const intent = ethers.id('m4-06-gasless');
    const forwarderAddress = await forwarder.getAddress();
    const request = {
      from: alice.address,
      to: escrowAddress,
      value: 0n,
      gas: 500_000n,
      nonce: await forwarder.getNonce(alice.address),
      data: encodeEscrowDeposit(intent, 5n * ONE_USDT),
    };
    const signature = await alice.signTypedData(
      forwarderDomain(chainId, forwarderAddress),
      FORWARD_REQUEST_TYPES,
      request,
    );
    await relayEscrowDeposit({ input: { request, signature }, escrowAddress, forwarderAddress, chainId, relayer });
    expect(await escrow.intentPayer(intent)).to.equal(alice.address);
  });

  it('refuses a replayed signature', async () => {
    const { alice, relayer, usdt, usdtAddress, escrowAddress, domain } = await loadFixture(deployFixture);
    const data = USDT_META_IFACE.encodeFunctionData('approve', [escrowAddress, ONE_USDT]);
    const signature = await signMeta(alice, domain, 0n, alice.address, data);
    const { r, s, v } = ethers.Signature.from(signature);
    await usdt.connect(relayer).executeMetaTransaction(alice.address, data, r, s, v);
    await expect(usdt.connect(relayer).executeMetaTransaction(alice.address, data, r, s, v)).to.be.revertedWith(
      'Signer and signature do not match',
    );
  });

  it('refuses a meta-transaction someone else signed', async () => {
    const { alice, mallory, relayer, usdt, escrowAddress, domain } = await loadFixture(deployFixture);
    // Mallory tries to move Alice's USDT by signing as Alice.
    const data = USDT_META_IFACE.encodeFunctionData('approve', [mallory.address, 100n * ONE_USDT]);
    const { r, s, v } = ethers.Signature.from(await signMeta(mallory, domain, 0n, alice.address, data));
    await expect(usdt.connect(relayer).executeMetaTransaction(alice.address, data, r, s, v)).to.be.revertedWith(
      'Signer and signature do not match',
    );
    expect(await usdt.allowance(alice.address, mallory.address)).to.equal(0n);
  });

  it('acts as the signer, not the relayer, for any token call', async () => {
    const { alice, mallory, relayer, usdt, domain } = await loadFixture(deployFixture);
    const data = usdt.interface.encodeFunctionData('transfer', [mallory.address, 3n * ONE_USDT]);
    const { r, s, v } = ethers.Signature.from(await signMeta(alice, domain, 0n, alice.address, data));
    await usdt.connect(relayer).executeMetaTransaction(alice.address, data, r, s, v);
    expect(await usdt.balanceOf(mallory.address)).to.equal(3n * ONE_USDT);
    expect(await usdt.balanceOf(alice.address)).to.equal(97n * ONE_USDT);
    // Direct calls still use the caller.
    await usdt.connect(mallory).transfer(alice.address, ONE_USDT);
    expect(await usdt.balanceOf(mallory.address)).to.equal(2n * ONE_USDT);
  });

  describe('relayer refuses before spending gas', () => {
    async function refusal(
      promise: Promise<unknown>,
      code: 'not_escrow_approval' | 'domain_mismatch' | 'invalid_signature' | 'wrong_wallet',
    ) {
      try {
        await promise;
      } catch (error) {
        expect(error).to.be.instanceOf(RelayRefused);
        expect((error as RelayRefused).code).to.equal(code);
        return;
      }
      expect.fail(`expected ${code}`);
    }

    it('anything but approve(escrow)', async () => {
      const { alice, mallory, relayer, chainId, usdtAddress, escrowAddress, domain } = await loadFixture(deployFixture);
      const toMallory = USDT_META_IFACE.encodeFunctionData('approve', [mallory.address, ONE_USDT]);
      await refusal(
        relayUsdtApproval({
          input: {
            from: alice.address,
            functionSignature: toMallory,
            signature: await signMeta(alice, domain, 0n, alice.address, toMallory),
          },
          usdtAddress,
          escrowAddress,
          chainId,
          relayer,
        }),
        'not_escrow_approval',
      );

      const transfer = new ethers.Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [
        mallory.address,
        ONE_USDT,
      ]);
      await refusal(
        relayUsdtApproval({
          input: {
            from: alice.address,
            functionSignature: transfer,
            signature: await signMeta(alice, domain, 0n, alice.address, transfer),
          },
          usdtAddress,
          escrowAddress,
          chainId,
          relayer,
        }),
        'not_escrow_approval',
      );
    });

    it('a signature for another wallet, a wrong chain or another session', async () => {
      const { alice, mallory, relayer, chainId, usdtAddress, escrowAddress, domain } = await loadFixture(deployFixture);
      const data = USDT_META_IFACE.encodeFunctionData('approve', [escrowAddress, ONE_USDT]);

      await refusal(
        relayUsdtApproval({
          input: {
            from: alice.address,
            functionSignature: data,
            signature: await signMeta(mallory, domain, 0n, alice.address, data),
          },
          usdtAddress,
          escrowAddress,
          chainId,
          relayer,
        }),
        'invalid_signature',
      );

      await refusal(
        relayUsdtApproval({
          input: {
            from: alice.address,
            functionSignature: data,
            signature: await signMeta(alice, domain, 0n, alice.address, data),
          },
          usdtAddress,
          escrowAddress,
          chainId: 137n,
          relayer,
        }),
        'domain_mismatch',
      );

      await refusal(
        relayUsdtApproval({
          input: {
            from: alice.address,
            functionSignature: data,
            signature: await signMeta(alice, domain, 0n, alice.address, data),
          },
          usdtAddress,
          escrowAddress,
          chainId,
          relayer,
          expectedFrom: mallory.address,
        }),
        'wrong_wallet',
      );
    });
  });
});
