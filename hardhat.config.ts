import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

import { AMOY_GAS_PRICE_WEI } from './config/amoyFees';

dotenv.config();

const AMOY_RPC_URL = process.env.AMOY_RPC_URL ?? 'https://rpc-amoy.polygon.technology';
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? '';
// Mainnet has its own deployer key, so the testnet key can never deploy there.
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL ?? '';
const POLYGON_DEPLOYER_PRIVATE_KEY = process.env.POLYGON_DEPLOYER_PRIVATE_KEY ?? '';
// The Anvil test chain on the server (deploy/README.md). Like localhost, it
// sends from the node's own unlocked test accounts, which are Hardhat's.
const SHARED_RPC_URL = process.env.SHARED_RPC_URL || 'http://127.0.0.1:8545';

const config: HardhatUserConfig = {
  solidity: {
    // Pinned to match the vendored T-REX v4.1.6 sources in contracts/trex.
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      // See config/amoyFees.ts. Left to itself the provider would price this
      // deploy off a spam-inflated eth_gasPrice.
      gasPrice: Number(AMOY_GAS_PRICE_WEI),
    },
    shared: {
      url: SHARED_RPC_URL,
      chainId: 31337,
      timeout: 120_000,
    },
    // Fees come from the provider (EIP-1559); nothing is pinned on mainnet.
    polygon: {
      url: POLYGON_RPC_URL,
      chainId: 137,
      accounts: POLYGON_DEPLOYER_PRIVATE_KEY ? [POLYGON_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      amoy: process.env.POLYGONSCAN_API_KEY ?? '',
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? '',
      polygon: process.env.POLYGONSCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'amoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },
  // npm run test:gas writes reports/gas.txt. Costs in docs/GAS.md are priced
  // at the pinned Amoy gas price, so no price feed is queried.
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    outputFile: 'reports/gas.txt',
    noColors: true,
    excludeContracts: ['contracts/trex/'],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
