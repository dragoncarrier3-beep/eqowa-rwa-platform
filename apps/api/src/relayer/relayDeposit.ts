import { relayEscrowDeposit, type RelayDepositInput } from '../../../../config/relayer.ts';
import { type ForwardRequest } from '../../../../config/forwarder.ts';

export { relayEscrowDeposit };
export type { RelayDepositInput, ForwardRequest };

export function parseForwardRequest(body: Record<string, unknown>): ForwardRequest | null {
  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';
  const data = typeof body.data === 'string' ? body.data : '';
  if (!from || !to || !data) {
    return null;
  }

  try {
    return {
      from,
      to,
      value: toBigInt(body.value),
      gas: toBigInt(body.gas),
      nonce: toBigInt(body.nonce),
      data,
    };
  } catch {
    return null;
  }
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error('invalid uint');
}
