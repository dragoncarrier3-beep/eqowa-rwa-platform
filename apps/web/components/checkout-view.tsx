'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Circle, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';

import type { CheckoutResponse, InvestorQuoteResponse } from '@config/api';
import { TOKEN_SYMBOL } from '@config/eqowa';

import { ConfirmationBar } from '@/components/confirmation-bar';
import { Countdown } from '@/components/countdown';
import { QuoteStatusBadge } from '@/components/status-badge';
import { TxLink } from '@/components/tx-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_CHAIN_ID } from '@/lib/chain';
import {
  BLOCKER_TEXT,
  SHARE_PRICE_USDT_UNITS,
  fetchCheckout,
  purchaseErrorText,
  runPurchase,
  type PurchaseStep,
  type SignTypedData,
} from '@/lib/checkout';
import { formatUnits6 } from '@/lib/format';
import { load } from '@/lib/portfolio';
import { cn } from '@/lib/utils';

const MAX_SHARES = 150_000;

const STEPS: { key: PurchaseStep; label: string; hint: string }[] = [
  { key: 'quote', label: 'Lock the price', hint: 'Valid for 15 minutes' },
  { key: 'approve', label: 'Approve USDT', hint: 'Signature only, no gas' },
  { key: 'deposit', label: 'Pay into escrow', hint: 'Signature only, no gas' },
];

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-[#ff8a8e]" aria-hidden />
      )}
      <span>
        <span className={ok ? 'text-text' : 'text-[#ff8a8e]'}>{label}</span>
        {detail ? <span className="text-text-muted"> {detail}</span> : null}
      </span>
    </li>
  );
}

function Summary({ checkout }: { checkout: CheckoutResponse }) {
  const rows: [string, string][] = [
    ['Shares', `${formatUnits6(BigInt(checkout.shareAmount))} ${TOKEN_SYMBOL}`],
    ['Offering funds', `${formatUnits6(BigInt(checkout.fundsAmount))} USDT`],
    ['EQOWA Fintech fee', `${formatUnits6(BigInt(checkout.feeAmount))} USDT`],
    ['You pay', `${formatUnits6(BigInt(checkout.usdtAmount))} USDT`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="text-right font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Checks({ checkout }: { checkout: CheckoutResponse }) {
  const blocked = new Set(checkout.blockers);
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" aria-label="Purchase checks">
        <CheckRow ok={checkout.kycStatus === 'approved'} label="Identity verified (KYC)" />
        <CheckRow ok={checkout.identityVerified} label="Identity registered on-chain" />
        <CheckRow ok={!blocked.has('not_compliant') && checkout.compliant} label="Offering rules allow this purchase" />
        <CheckRow
          ok={!blocked.has('insufficient_usdt')}
          label="Enough USDT"
          detail={`(wallet holds ${formatUnits6(BigInt(checkout.usdtBalance))} USDT)`}
        />
      </ul>
      {checkout.blockers.length > 0 ? (
        <ul className="space-y-1 rounded-panel border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {checkout.blockers.map((blocker) => (
            <li key={blocker}>{BLOCKER_TEXT[blocker]}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Steps({ current, needsApproval }: { current: PurchaseStep | 'done' | null; needsApproval: boolean }) {
  const steps = STEPS.filter((step) => step.key !== 'approve' || needsApproval);
  const index = current === 'done' ? steps.length : steps.findIndex((step) => step.key === current);
  return (
    <ol className="space-y-2" aria-label="Purchase steps">
      {steps.map((step, position) => {
        const state = position < index ? 'done' : position === index ? 'active' : 'waiting';
        return (
          <li key={step.key} className="flex items-center gap-2 text-sm" data-state={state}>
            {state === 'done' ? (
              <Check className="size-4 text-success" aria-hidden />
            ) : state === 'active' ? (
              <Loader2 className="size-4 animate-spin text-live" aria-hidden />
            ) : (
              <Circle className="size-4 text-text-faint" aria-hidden />
            )}
            <span className={cn(state === 'waiting' ? 'text-text-muted' : 'text-text')}>{step.label}</span>
            <span className="text-xs text-text-faint">{step.hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Follows one purchase until its shares are minted. */
export function PurchaseTracker({ intentId }: { intentId: string }) {
  const { data } = useQuery({
    queryKey: ['quote', intentId],
    queryFn: () => load<InvestorQuoteResponse>(`/investor/quotes/${intentId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.state === 'ok' ? query.state.data.data.quote.status : null;
      return status === 'minted' || status === 'rejected' || status === 'expired' ? false : 4_000;
    },
  });
  if (data?.state !== 'ok') {
    return <p className="text-sm text-text-muted">Waiting for the payment to appear on-chain</p>;
  }
  const { quote } = data.data;
  return (
    <div className="space-y-3" aria-label="Purchase progress">
      <div className="flex items-center justify-between">
        <QuoteStatusBadge status={quote.status} />
        {quote.deposit ? (
          <TxLink chainId={APP_CHAIN_ID} hash={quote.deposit.txHash} label="Deposit transaction" />
        ) : null}
      </div>
      {quote.status === 'quoted' ? (
        <Countdown until={quote.quoteExpiresAt} label="Waiting for payment, window closes in" />
      ) : null}
      {quote.confirmations && quote.status !== 'minted' ? (
        <ConfirmationBar current={quote.confirmations.current} required={quote.confirmations.required} />
      ) : null}
      {quote.status === 'awaiting_safe_approval' ? (
        <p className="text-sm text-text-muted">
          Purchases of 100,000 USDT or more wait for sign-off by two EQOWA signers. You will see the shares once they
          approve.
        </p>
      ) : null}
      {quote.status === 'minted' ? (
        <div className="space-y-2 text-sm">
          <p className="text-success">
            {formatUnits6(BigInt(quote.shareAmount))} {TOKEN_SYMBOL} are in your wallet.
          </p>
          <div className="flex items-center gap-4">
            {quote.mintTxHash ? (
              <TxLink chainId={APP_CHAIN_ID} hash={quote.mintTxHash} label="Mint transaction" />
            ) : null}
            <Link href="/portfolio" className="text-[#8fc1ef] hover:underline">
              View portfolio
            </Link>
          </div>
        </div>
      ) : null}
      {quote.status === 'rejected' ? (
        <p className="text-sm text-[#ff8a8e]">
          This purchase was refused{quote.rejectReason ? ` (${quote.rejectReason.replaceAll('_', ' ')})` : ''}. EQOWA
          operations reviews it and refunds the USDT held in escrow.
        </p>
      ) : null}
    </div>
  );
}

export function CheckoutView() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  // wagmi infers its types from one typed-data shape per call site; ours
  // alternates between the approval and the deposit, hence the single cast.
  const signTypedData: SignTypedData = (typed) => signTypedDataAsync(typed as Parameters<typeof signTypedDataAsync>[0]);
  const [sharesText, setSharesText] = useState('10');
  const [step, setStep] = useState<PurchaseStep | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);

  const shares = /^\d+$/.test(sharesText) ? Number(sharesText) : 0;
  const validShares = shares >= 1 && shares <= MAX_SHARES;
  const usdtAmount = BigInt(validShares ? shares : 0) * SHARE_PRICE_USDT_UNITS;

  const checkout = useQuery({
    queryKey: ['checkout', usdtAmount.toString()],
    queryFn: () => fetchCheckout(usdtAmount),
    enabled: validShares && step === null,
  });

  if (checkout.data?.state === 'signed_out') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to buy</CardTitle>
          <CardDescription>
            Connect your wallet with the button at the top right and sign the message. Buying needs no POL: every step
            is a signature and EQOWA pays the network fees.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = checkout.data?.state === 'ok' ? checkout.data.data : null;
  const wrongWallet = Boolean(data && address && address.toLowerCase() !== data.walletAddress.toLowerCase());
  const busy = step !== null && step !== 'done';
  const canBuy = Boolean(data && data.blockers.length === 0 && !wrongWallet && !busy && intentId === null);

  async function handleBuy() {
    if (!data) {
      return;
    }
    setError(null);
    try {
      const result = await runPurchase({
        checkout: data,
        signTypedData,
        onStep: setStep,
      });
      setStep('done');
      setIntentId(result.intentId);
    } catch (caught) {
      setStep(null);
      setError(purchaseErrorText(caught));
      void checkout.refetch();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>How many shares?</CardTitle>
          <CardDescription>5 USDT per share: 4 USDT offering funds and 1 USDT EQOWA Fintech fee.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm text-text-muted">Shares</span>
            <input
              inputMode="numeric"
              value={sharesText}
              onChange={(event) => setSharesText(event.target.value.replace(/[^\d]/g, ''))}
              disabled={busy || intentId !== null}
              aria-invalid={!validShares}
              className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 font-mono text-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {!validShares ? <span className="text-xs text-warning">Enter between 1 and 150,000 shares.</span> : null}
          </label>
          {checkout.isFetching && !data ? <p className="text-sm text-text-muted">Checking</p> : null}
          {checkout.data?.state === 'unavailable' ? (
            <p className="text-sm text-warning">Checkout is not available right now. Please try again shortly.</p>
          ) : null}
          {data ? (
            <>
              <Summary checkout={data} />
              <Checks checkout={data} />
            </>
          ) : null}
          {wrongWallet ? (
            <p role="alert" className="text-sm text-warning">
              Your wallet switched accounts. Switch back to the account you signed in with.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[#ff8a8e]">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button size="lg" onClick={handleBuy} disabled={!canBuy}>
            {busy ? 'Check your wallet' : `Buy ${validShares ? shares.toLocaleString('en-US') : ''} shares`}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>Shares are minted once the payment is 12 blocks deep.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Steps current={step} needsApproval={data?.needsApproval ?? true} />
          {intentId ? <PurchaseTracker intentId={intentId} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
