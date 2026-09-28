'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { shortAddress } from '@/lib/format';
import { fetchSession, signInErrorText, signInWithEthereum, signOut, walletStage } from '@/lib/siwe';
import { APP_CHAIN } from '@/lib/wagmi';

const SESSION_KEY = ['session'];

const CONNECTOR_LABELS: Record<string, string> = {
  injected: 'Browser wallet (MetaMask)',
  walletConnect: 'WalletConnect (phone)',
};

/** Header control: connect, switch network, sign in with the wallet, sign out. */
export function WalletButton() {
  const queryClient = useQueryClient();
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: session } = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 60_000 });
  const stage = walletStage({ isConnected, address, chainId, expectedChainId: APP_CHAIN.id, session });

  async function handleSignIn() {
    if (!address) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signed = await signInWithEthereum({ address, chainId: APP_CHAIN.id, signMessage: signMessageAsync });
      queryClient.setQueryData(SESSION_KEY, signed);
    } catch (caught) {
      setError(signInErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    queryClient.setQueryData(SESSION_KEY, null);
    await queryClient.invalidateQueries();
    disconnect();
  }

  if (stage === 'disconnected') {
    return (
      <div className="relative">
        <Button size="sm" onClick={() => setChoosing((open) => !open)} disabled={connecting} aria-expanded={choosing}>
          <Wallet className="size-4" aria-hidden />
          {connecting ? 'Connecting' : 'Connect wallet'}
        </Button>
        {choosing ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-60 rounded-panel border border-border bg-surface p-1 shadow-panel"
          >
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                role="menuitem"
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-surface-2"
                onClick={() => {
                  setChoosing(false);
                  connect({ connector, chainId: APP_CHAIN.id });
                }}
              >
                {CONNECTOR_LABELS[connector.type] ?? connector.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (stage === 'wrong_network') {
    return (
      <Button size="sm" variant="secondary" disabled={switching} onClick={() => switchChain({ chainId: APP_CHAIN.id })}>
        {switching ? 'Switching' : `Switch to ${APP_CHAIN.name}`}
      </Button>
    );
  }

  if (stage === 'needs_sign_in') {
    return (
      <div className="flex items-center gap-2">
        {error ? (
          <span role="alert" className="max-w-56 text-xs text-[#ff8a8e]">
            {error}
          </span>
        ) : null}
        <span className="font-mono text-xs text-text-muted">{shortAddress(address ?? '')}</span>
        <Button size="sm" onClick={handleSignIn} disabled={busy}>
          {busy ? 'Check your wallet' : 'Sign in'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => disconnect()} aria-label="Disconnect wallet">
          <LogOut className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full border border-live/40 bg-live-soft px-2.5 py-0.5 font-mono text-xs text-live">
        {shortAddress(address ?? '')}
      </span>
      <Button size="sm" variant="ghost" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
