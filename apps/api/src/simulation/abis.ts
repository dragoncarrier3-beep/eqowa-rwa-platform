/** Minimal ABIs for the calls the simulation makes. Kept here so it needs no Hardhat artifacts. */

export const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
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
