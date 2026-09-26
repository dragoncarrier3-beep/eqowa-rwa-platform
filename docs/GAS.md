# Gas profile

Measured on a local Hardhat chain on 26 September 2026 under the production
rules: all five compliance modules bound and the 730-day lock-up on. Costs use
the Amoy gas price pinned in `config/amoyFees.ts`, 30 gwei.

`test/gas/gasProfile.test.ts` measures these from transaction receipts and
fails if any operation grows more than about 15 percent past the figure here.
It writes `reports/gas-profile.json` on every run. The generic reporter
(`npm run test:gas`, output in `reports/gas.txt`) is kept for per-contract
deployment sizes, but it misattributes calls made through the T-REX proxies,
so the operation figures below come from the profile test.

## Everyday operations

| Operation | Who pays | Gas | POL at 30 gwei |
| --- | --- | ---: | ---: |
| Deploy an investor ONCHAINID | Eqowa operator | 378,639 | 0.0114 |
| Add one KYC claim to it | Eqowa operator | 304,914 | 0.0091 |
| Register the identity in the registry | Agent | 79,578 | 0.0024 |
| Escrow deposit, paid by the investor | Investor | 132,463 | 0.0040 |
| Escrow deposit, relayed (gasless for the investor) | Relayer | 141,979 | 0.0043 |
| Mint, first tranche for a new holder | Agent | 642,082 | 0.0193 |
| Mint, top-up for an existing holder | Agent | 510,565 | 0.0153 |
| Investor transfer after the lock-up | Investor | 520,283 | 0.0156 |
| Agent forced transfer carrying a lock | Agent | 577,393 | 0.0173 |

Minting and transfers are the heaviest because every one runs all five modules.
The lock-up and holder-count modules keep per-identity ledgers so the rules
hold across an investor's wallets.

## Cost per investor

| Step | Gas | POL at 30 gwei |
| --- | ---: | ---: |
| Onboarding: identity, two claims, registration | 1,068,045 | 0.0320 |
| First purchase: relayed deposit and first mint | 784,061 | 0.0235 |
| Each later purchase: relayed deposit and top-up mint | 652,544 | 0.0196 |

With the relayer, investors pay nothing to buy. They need a small amount of POL
only to approve USDT for the escrow once (46,223 gas, about 0.0014 POL) and to
transfer shares after the lock-up.

## Deployment

| What | Gas | POL at 30 gwei |
| --- | ---: | ---: |
| Full EQOWAG suite (`deploy:amoy`) | 40,757,565 | 1.223 |
| Escrow, forwarder and mock USDT (`deploy-settlement:amoy`) | 2,254,598 | 0.068 |
| 2-of-3 Safe (`create-safe:amoy`) | about 400,000 | 0.012 |

The deploy scripts refuse to broadcast unless the deployer holds these amounts
plus 15 percent.

## Polygon mainnet

Gas figures are the same on mainnet. Only the price differs, and it moves with
demand. Multiply the gas by the network price at the time: at 50 gwei a first
purchase costs about 0.039 POL, at 100 gwei about 0.078 POL.
