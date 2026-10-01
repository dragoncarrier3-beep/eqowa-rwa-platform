import type { FastifyInstance } from 'fastify';

/**
 * Methods a wallet or the web app needs on the shared test chain. Everything
 * else is refused before it reaches the node. Anvil keeps its default accounts
 * unlocked, so eth_sendTransaction and eth_sign* would let anyone spend them,
 * and anvil_*, hardhat_*, evm_* and debug_* would let anyone rewrite the chain.
 */
export const RPC_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'web3_clientVersion',
  'net_version',
  'eth_chainId',
  'eth_syncing',
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_call',
  'eth_estimateGas',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_sendRawTransaction',
]);

/** Largest JSON-RPC batch forwarded in one request. */
export const RPC_MAX_BATCH = 20;

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export type RpcProxyDeps = {
  /** The node, for example http://anvil:8545 inside the Docker network. */
  upstream: string;
  fetch?: typeof fetch;
};

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// A public read endpoint without cookies, so any origin may call it. The web
// app's wagmi transport calls it from app.eqowa.com.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/**
 * POST /rpc: the shared test chain's JSON-RPC, open to MetaMask and the web
 * app, limited to RPC_ALLOWED_METHODS. Refused calls in a batch get their own
 * error; the allowed ones still go through.
 */
export function registerRpcProxy(app: FastifyInstance, deps: RpcProxyDeps) {
  const doFetch = deps.fetch ?? fetch;

  async function forward(calls: RpcRequest[]): Promise<unknown[]> {
    const response = await doFetch(deps.upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls),
    });
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? body : [body];
  }

  app.options('/rpc', async (_request, reply) => reply.code(204).headers(CORS).send());

  app.post('/rpc', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    reply.headers(CORS);
    const body = request.body as RpcRequest | RpcRequest[] | undefined;
    const batch = Array.isArray(body);
    const calls = batch ? body : body && typeof body === 'object' ? [body] : [];
    if (calls.length === 0) {
      return reply.code(400).send(rpcError(null, -32600, 'invalid request'));
    }
    if (calls.length > RPC_MAX_BATCH) {
      return reply.code(400).send(rpcError(null, -32600, `batch larger than ${RPC_MAX_BATCH}`));
    }

    const answers = new Map<number, unknown>();
    const allowed: { index: number; call: RpcRequest }[] = [];
    calls.forEach((call, index) => {
      if (!call || typeof call !== 'object' || typeof call.method !== 'string') {
        answers.set(index, rpcError(call?.id, -32600, 'invalid request'));
      } else if (!RPC_ALLOWED_METHODS.has(call.method)) {
        answers.set(index, rpcError(call.id, -32601, `method ${call.method} is not available on this endpoint`));
      } else {
        allowed.push({
          index,
          call: { jsonrpc: '2.0', id: call.id ?? null, method: call.method, params: call.params },
        });
      }
    });

    if (allowed.length > 0) {
      try {
        const results = await forward(allowed.map((entry) => entry.call));
        // Nodes may answer a batch in any order: match by id, then by position.
        allowed.forEach((entry, position) => {
          const match =
            results.find(
              (result) => result && typeof result === 'object' && (result as { id?: unknown }).id === entry.call.id,
            ) ?? results[position];
          answers.set(entry.index, match ?? rpcError(entry.call.id, -32603, 'no answer from the node'));
        });
      } catch (error) {
        request.log.warn({ error: String(error) }, 'rpc upstream failed');
        for (const entry of allowed) {
          answers.set(entry.index, rpcError(entry.call.id, -32603, 'the test chain is not reachable'));
        }
      }
    }

    const ordered = calls.map((_call, index) => answers.get(index));
    return batch ? ordered : ordered[0];
  });
}
