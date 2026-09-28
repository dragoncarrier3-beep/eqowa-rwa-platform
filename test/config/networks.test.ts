import { expect } from 'chai';

import { NETWORKS, explorerAddressUrl, explorerTxUrl, networkByChainId } from '../../config/networks';

describe('networks', () => {
  it('finds each network by chain id', () => {
    expect(networkByChainId(31337)?.key).to.equal('localhost');
    expect(networkByChainId(80002)?.key).to.equal('amoy');
    expect(networkByChainId(137)?.key).to.equal('polygon');
    expect(networkByChainId(1)).to.equal(undefined);
  });

  it('pins native Polygon USDT on mainnet only', () => {
    expect(NETWORKS.polygon.usdtAddress).to.equal('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
    expect(NETWORKS.amoy.usdtAddress).to.equal(null);
    expect(NETWORKS.localhost.usdtAddress).to.equal(null);
    expect(NETWORKS.polygon.testnet).to.equal(false);
  });

  it('builds explorer links, none for a local chain', () => {
    const address = '0x2222222222222222222222222222222222222222';
    expect(explorerAddressUrl(80002, address)).to.equal(`https://amoy.polygonscan.com/address/${address}`);
    expect(explorerTxUrl(137, '0xabc')).to.equal('https://polygonscan.com/tx/0xabc');
    expect(explorerTxUrl(31337, '0xabc')).to.equal(null);
  });
});
