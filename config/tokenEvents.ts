import { Interface, type Log } from 'ethers';

/**
 * T-REX token events the Milestone 2 indexer persists.
 * Transfer is the ERC-20 mint/transfer/burn log. AddressFrozen is wallet freeze.
 * TokenCreated is a factory-time fact; it is recorded as an asset row, not a log.
 */
export const TOKEN_INDEX_IFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event AddressFrozen(address indexed _userAddress, bool indexed _isFrozen, address indexed _owner)',
]);

export type IndexedTokenEvent =
  | {
      eventName: 'Transfer';
      txHash: string;
      logIndex: number;
      blockNumber: number;
      fromAddress: string;
      toAddress: string;
      amount: bigint;
      frozen: null;
    }
  | {
      eventName: 'AddressFrozen';
      txHash: string;
      logIndex: number;
      blockNumber: number;
      fromAddress: string;
      toAddress: null;
      amount: null;
      frozen: boolean;
    };

/** Decode Transfer and AddressFrozen. Other topics are ignored. */
export function decodeTokenLogs(logs: readonly Log[]): IndexedTokenEvent[] {
  const events: IndexedTokenEvent[] = [];

  for (const log of logs) {
    let parsed;
    try {
      parsed = TOKEN_INDEX_IFACE.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      continue;
    }

    if (!parsed) {
      continue;
    }

    const txHash = log.transactionHash;
    const logIndex = log.index;
    const blockNumber = Number(log.blockNumber);

    if (parsed.name === 'Transfer') {
      events.push({
        eventName: 'Transfer',
        txHash,
        logIndex,
        blockNumber,
        fromAddress: String(parsed.args.from),
        toAddress: String(parsed.args.to),
        amount: BigInt(parsed.args.value),
        frozen: null,
      });
      continue;
    }

    if (parsed.name === 'AddressFrozen') {
      events.push({
        eventName: 'AddressFrozen',
        txHash,
        logIndex,
        blockNumber,
        fromAddress: String(parsed.args._userAddress),
        toAddress: null,
        amount: null,
        frozen: Boolean(parsed.args._isFrozen),
      });
    }
  }

  return events;
}
