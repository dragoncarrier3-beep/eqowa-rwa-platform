import { AbiCoder, Interface, dataSlice } from 'ethers';

/**
 * One place that turns a contract revert into a stable code and a sentence a
 * person can act on. The API stores the code on exceptions, and the portals
 * show the message instead of a raw revert.
 *
 * First-party contracts revert with custom errors. Vendored T-REX and
 * OpenZeppelin revert with strings, which are matched exactly.
 */
export type RevertInfo = {
  code: string;
  message: string;
  /** `custom` error, `reason` string, or `unknown` when neither matched. */
  source: 'custom' | 'reason' | 'unknown';
  /** Error name or reason string as the chain returned it. */
  raw: string;
};

type Entry = { code: string; message: string };

/** First-party custom errors, keyed by Solidity signature. */
export const CUSTOM_ERRORS: Record<string, Entry> = {
  'ZeroAddress()': { code: 'zero_address', message: 'A required address is missing.' },
  'ZeroAmount()': { code: 'zero_amount', message: 'The amount must be greater than zero.' },
  'IntentAlreadyUsed(bytes32)': {
    code: 'intent_already_used',
    message: 'This payment reference was already used. Request a new quote.',
  },
  'UnknownIntent(bytes32)': { code: 'unknown_intent', message: 'No deposit exists for this payment reference.' },
  'ComplianceAlreadyBound(address)': {
    code: 'compliance_already_bound',
    message: 'This rule is already attached to a token.',
  },
  'CallerIsNotTheCompliance(address)': {
    code: 'not_compliance',
    message: "Only the token's compliance contract can call this rule.",
  },
  'ComplianceNotBound(address)': { code: 'compliance_not_bound', message: 'This rule is not attached to the token.' },
  'MaxBalanceExceeded(address,uint256)': {
    code: 'max_balance_exceeded',
    message: 'This would take the investor above the 150,000 share limit.',
  },
  'IdentityNotFound(address,address)': {
    code: 'identity_not_found',
    message: 'The wallet is not linked to a verified identity.',
  },
  'CountryAlreadyAllowed(address,uint16)': {
    code: 'country_already_allowed',
    message: 'This country is already on the allow-list.',
  },
  'CountryNotAllowed(address,uint16)': {
    code: 'country_not_allowed',
    message: "The investor's country is not on the allow-list.",
  },
  'DailyMintCapExceeded(address,uint256,uint256)': {
    code: 'daily_mint_cap_exceeded',
    message: "Today's issuance limit of 250,000 shares is reached. Try again when the 24-hour window moves on.",
  },
  'AmountExceedsRecordLimit(uint256)': { code: 'amount_too_large', message: 'The amount is too large to record.' },
  'AmountExceedsTrancheLimit(uint256)': { code: 'amount_too_large', message: 'The amount is too large to record.' },
  'MaxHolderCountExceeded(address,uint256)': {
    code: 'max_holders_exceeded',
    message: 'The token already has the maximum of 500 holders.',
  },
};

/** Reason strings from T-REX and OpenZeppelin, matched exactly. */
export const REASON_STRINGS: Record<string, Entry> = {
  'Identity is not verified.': {
    code: 'identity_not_verified',
    message: 'The receiving wallet has no verified identity. The investor must complete KYC first.',
  },
  'Transfer not possible': {
    code: 'transfer_not_compliant',
    message: 'This transfer breaks a compliance rule: country, balance limit, holder limit or lock-up.',
  },
  'Compliance not followed': {
    code: 'mint_not_compliant',
    message: 'This issuance breaks a compliance rule: balance limit, holder limit or daily limit.',
  },
  'Insufficient Balance': { code: 'insufficient_balance', message: 'The wallet does not hold enough shares.' },
  'Amount exceeds available balance': {
    code: 'amount_frozen',
    message: 'Part of this balance is frozen and cannot move.',
  },
  'wallet is frozen': { code: 'wallet_frozen', message: 'This wallet is frozen by the compliance team.' },
  'Pausable: paused': { code: 'token_paused', message: 'The token is paused. No transfers or issuance right now.' },
  'AgentRole: caller does not have the Agent role': {
    code: 'not_agent',
    message: 'Only the operations agent wallet can do this.',
  },
  'Ownable: caller is not the owner': { code: 'not_owner', message: 'Only the Safe can do this.' },
  'Recovery not possible': {
    code: 'recovery_not_possible',
    message: 'The wallet cannot be recovered to this address.',
  },
  'ERC20: insufficient allowance': {
    code: 'insufficient_allowance',
    message: 'Approve the escrow to spend this much USDT first.',
  },
  'ERC20: transfer amount exceeds balance': {
    code: 'insufficient_usdt',
    message: 'The wallet does not hold enough USDT.',
  },
};

const CUSTOM_IFACE = new Interface(Object.keys(CUSTOM_ERRORS).map((signature) => `error ${signature}`));
const ERROR_STRING_SELECTOR = '0x08c379a0';

function lookupReason(reason: string): RevertInfo {
  const entry = REASON_STRINGS[reason];
  return entry
    ? { ...entry, source: 'reason', raw: reason }
    : { code: 'reverted', message: reason, source: 'unknown', raw: reason };
}

/** Finds revert data on an ethers error, wherever the provider put it. */
function revertData(error: unknown): string | undefined {
  const candidates = [
    (error as { data?: unknown }).data,
    (error as { info?: { error?: { data?: unknown } } }).info?.error?.data,
    (error as { error?: { data?: unknown } }).error?.data,
    (error as { info?: { error?: { data?: { data?: unknown } } } }).info?.error?.data?.data,
  ];
  return candidates.find(
    (value): value is string => typeof value === 'string' && value.startsWith('0x') && value.length >= 10,
  );
}

/**
 * Decodes a revert thrown by ethers into a code and a message. Anything that is
 * not a recognised revert keeps its own message under `reverted`, so nothing
 * is hidden.
 */
export function decodeRevert(error: unknown): RevertInfo {
  const data = revertData(error);
  if (data) {
    if (dataSlice(data, 0, 4) === ERROR_STRING_SELECTOR) {
      const [reason] = AbiCoder.defaultAbiCoder().decode(['string'], dataSlice(data, 4));
      return lookupReason(String(reason));
    }
    try {
      const parsed = CUSTOM_IFACE.parseError(data);
      if (parsed) {
        const entry = CUSTOM_ERRORS[parsed.signature]!;
        return { ...entry, source: 'custom', raw: parsed.name };
      }
    } catch {
      // Not one of ours; fall through to the reason string.
    }
  }

  const e = error as { reason?: unknown; shortMessage?: unknown; message?: unknown };
  if (typeof e.reason === 'string' && e.reason) {
    return lookupReason(e.reason);
  }
  const text =
    typeof e.shortMessage === 'string' ? e.shortMessage : typeof e.message === 'string' ? e.message : String(error);
  return { code: 'reverted', message: text, source: 'unknown', raw: text };
}
