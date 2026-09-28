import { ExternalLink } from 'lucide-react';

import { explorerTxUrl } from '@config/networks';

import { shortAddress } from '@/lib/format';

/** Shortened hash, linked to Polygonscan where the chain has an explorer. */
export function TxLink({ chainId, hash, label }: { chainId: number; hash: string; label?: string }) {
  const url = explorerTxUrl(chainId, hash);
  const text = label ?? shortAddress(hash);
  if (!url) {
    return <span className="font-mono text-xs text-text-muted">{text}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-[#8fc1ef] hover:underline"
    >
      {text}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
