const { JsonRpcProvider, formatUnits } = require('ethers');

(async () => {
  const p = new JsonRpcProvider('https://polygon-amoy-bor-rpc.publicnode.com', { chainId: 80002, name: 'amoy' });
  const latest = await p.getBlockNumber();
  const prices = [];
  let scanned = 0;

  for (let i = 0; i < 60; i++) {
    let b;
    try {
      b = await p.getBlock(latest - i, true);
    } catch (e) {
      continue;
    }
    if (!b) continue;
    scanned++;
    for (const tx of b.prefetchedTransactions) {
      const gp = tx.gasPrice ?? tx.maxFeePerGas;
      if (gp) prices.push(gp);
    }
  }

  prices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  console.log('blocks scanned', scanned);
  console.log('txs found', prices.length);
  if (prices.length) {
    console.log('MIN gwei   ', formatUnits(prices[0], 'gwei'));
    console.log('p10 gwei   ', formatUnits(prices[Math.floor(prices.length * 0.1)], 'gwei'));
    console.log('median gwei', formatUnits(prices[Math.floor(prices.length * 0.5)], 'gwei'));
    console.log('max gwei   ', formatUnits(prices[prices.length - 1], 'gwei'));
  }
})().catch((e) => console.error('ERR', e.message));
