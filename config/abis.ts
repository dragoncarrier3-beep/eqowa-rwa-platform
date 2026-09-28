/**
 * Minimal human-readable ABIs shared by the API, the simulation and the web
 * app. Kept here so none of them needs Hardhat artifacts. The same strings
 * parse with ethers (`new Interface`) and viem (`parseAbi`).
 */

export const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
];

/** Token views behind the public asset listing. */
export const TOKEN_VIEW_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function paused() view returns (bool)',
  'function compliance() view returns (address)',
];

/** Per-wallet token views behind the investor portfolio. */
export const TOKEN_HOLDER_VIEW_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function isFrozen(address _userAddress) view returns (bool)',
  'function getFrozenTokens(address _userAddress) view returns (uint256)',
  'function identityRegistry() view returns (address)',
  'function compliance() view returns (address)',
];

export const IDENTITY_REGISTRY_VIEW_ABI = ['function identity(address _userAddress) view returns (address)'];

/** Lock-up is tracked per ONCHAINID, so it covers every wallet of the identity. */
export const TIME_LOCKUP_ABI = [
  'function getLockupDuration(address _compliance) view returns (uint256)',
  'function getLockedAmount(address _compliance, address _identity) view returns (uint256)',
  'function getSpendableAmount(address _compliance, address _identity) view returns (uint256)',
  'function getLockedTranches(address _compliance, address _identity) view returns (uint256[] amounts, uint256[] releaseTimes)',
];

export const IDENTITY_REGISTRY_ABI = [
  'function registerIdentity(address _userAddress, address _identity, uint16 _country)',
  'function isVerified(address _userAddress) view returns (bool)',
];

export const IDENTITY_ABI = [
  'function addClaim(uint256 _topic, uint256 _scheme, address _issuer, bytes _signature, bytes _data, string _uri) returns (bytes32)',
];

export const CLAIM_ISSUER_ABI = ['function keyHasPurpose(bytes32 _key, uint256 _purpose) view returns (bool)'];

export const MODULE_ABI = [
  'function moduleCheck(address _from, address _to, uint256 _value, address _compliance) view returns (bool)',
];

/** Holders are counted per ONCHAINID, not per wallet. */
export const HOLDER_COUNT_CAP_ABI = [
  'function getHolderCount(address _compliance) view returns (uint256)',
  'function getMaxHolderCount(address _compliance) view returns (uint256)',
];

export const BALANCE_CAP_ABI = ['function getMaxBalance(address _compliance) view returns (uint256)'];

export const DAILY_MINT_CAP_ABI = [
  'function getDailyMintCap(address _compliance) view returns (uint256)',
  'function getRemainingAllowance(address _compliance) view returns (uint256)',
];

export const COMPLIANCE_ABI = ['function canTransfer(address _from, address _to, uint256 _amount) view returns (bool)'];

export const MOCK_USDT_ABI = [
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const ESCROW_ABI = [
  'function deposit(bytes32 intentId, uint256 amount)',
  'function intentPayer(bytes32 intentId) view returns (address)',
];

export const FORWARDER_ABI = ['function getNonce(address from) view returns (uint256)'];
