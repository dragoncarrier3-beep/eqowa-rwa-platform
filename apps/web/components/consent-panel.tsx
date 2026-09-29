'use client';

import Link from 'next/link';
import { useState } from 'react';

import { RISK_NOTICE, TERMS_DOCUMENTS, TERMS_VERSION } from '@config/terms';

import { Button } from '@/components/ui/button';

/**
 * Shown before the investor signs in. Agreeing does not send anything by
 * itself: the agreement is the sentence inside the sign-in message the wallet
 * signs next, which the platform keeps as the record of acceptance.
 */
export function ConsentPanel({
  busy,
  onAgree,
  onCancel,
}: {
  busy: boolean;
  onAgree: () => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div
      role="dialog"
      aria-label="Terms and risk"
      className="absolute right-0 z-20 mt-2 w-[22rem] space-y-3 rounded-panel border border-border bg-surface p-4 text-sm shadow-panel"
    >
      <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-warning">{RISK_NOTICE}</p>
      <label className="flex items-start gap-2 text-text">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-1"
        />
        <span>
          I have read and agree to the{' '}
          {TERMS_DOCUMENTS.map((doc, index) => (
            <span key={doc.path}>
              <Link href={doc.path} target="_blank" className="text-[#8fc1ef] hover:underline">
                {doc.title}
              </Link>
              {index < TERMS_DOCUMENTS.length - 2 ? ', ' : index === TERMS_DOCUMENTS.length - 2 ? ' and ' : ''}
            </span>
          ))}
          .
        </span>
      </label>
      <p className="text-xs text-text-faint">
        Your wallet will ask you to sign this agreement (version {TERMS_VERSION}). Signing is free and sends no
        transaction.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onAgree} disabled={!checked || busy}>
          {busy ? 'Check your wallet' : 'Agree and sign in'}
        </Button>
      </div>
    </div>
  );
}
