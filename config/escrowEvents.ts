import { Interface, getAddress, type Log } from 'ethers';

/** Escrow events the settlement worker reads. Mirrors contracts/escrow/Escrow.sol. */
export const ESCROW_EVENTS_IFACE = new Interface([
  'event Deposited(bytes32 indexed intentId, address indexed payer, uint256 amount, address token)',
]);

export const DEPOSITED_TOPIC = ESCROW_EVENTS_IFACE.getEvent('Deposited')!.topicHash;

export type EscrowDepositedEvent = {
  /** Lower-case 0x-prefixed bytes32, the same form `newIntentId()` produces. */
  intentId: string;
  payer: string;
  amount: bigint;
  token: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
};

/** Decode Deposited logs. Anything else is skipped, as in `decodeTokenLogs`. */
export function decodeEscrowDepositLogs(logs: readonly Log[]): EscrowDepositedEvent[] {
  const events: EscrowDepositedEvent[] = [];

  for (const log of logs) {
    let parsed;
    try {
      parsed = ESCROW_EVENTS_IFACE.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== 'Deposited') {
      continue;
    }

    events.push({
      intentId: String(parsed.args.intentId).toLowerCase(),
      payer: getAddress(String(parsed.args.payer)),
      amount: BigInt(parsed.args.amount),
      token: getAddress(String(parsed.args.token)),
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: Number(log.blockNumber),
    });
  }

  return events;
}
