'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { KycStatus } from '@config/api';

import { KycStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchInvestorMe, kycErrorText, requestKycToken } from '@/lib/kyc';

type Sdk = { destroy(): void };

const STATUS_TEXT: Record<KycStatus | 'none', { title: string; body: string }> = {
  none: {
    title: 'Verify your identity',
    body: 'EQOWA Group Shares can only be held by verified investors. Have your passport, ID card or driving licence ready. It takes about five minutes, including a short selfie video.',
  },
  pending: {
    title: 'Verification in review',
    body: 'Your documents are with our verification partner. Most reviews finish within minutes; some take longer. This page updates on its own.',
  },
  approved: {
    title: 'Identity verified',
    body: 'You can buy EQOWA Group Shares. Your verified identity is registered on-chain so every transfer can be checked against it; this can take a few minutes after approval.',
  },
  rejected: {
    title: 'Verification not approved',
    body: 'Your last attempt was not approved. You can try again below; the verification screen explains what to correct.',
  },
  blocked_country: {
    title: 'Not available in your country',
    body: 'The offering is open to residents of African Union countries, the European Union and the United Kingdom. Your document shows a country outside that list.',
  },
};

/**
 * Investor KYC through Sumsub's WebSDK (level id-and-liveness). The SDK runs
 * inside this page; the result arrives through Sumsub's webhook to the API,
 * so the status shown always comes from the API, never from the browser.
 */
export function KycView() {
  const container = useRef<HTMLDivElement>(null);
  const sdk = useRef<Sdk | null>(null);
  const [launched, setLaunched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: fetchInvestorMe,
    // Poll once documents are submitted, so the webhook's result shows without a reload.
    refetchInterval: submitted ? 5_000 : false,
  });

  useEffect(() => () => sdk.current?.destroy(), []);

  if (me.isPending) {
    return <p className="text-sm text-text-muted">Loading</p>;
  }
  if (me.data?.state === 'signed_out') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to verify</CardTitle>
          <CardDescription>
            Connect your wallet with the button at the top right and sign the message. Verification is linked to the
            wallet you sign in with.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const status: KycStatus | 'none' = me.data?.state === 'ok' ? (me.data.data.kyc?.status ?? 'none') : 'none';
  const shown = submitted && (status === 'none' || status === 'rejected') ? 'pending' : status;
  const text = STATUS_TEXT[shown];
  const canStart = (status === 'none' || status === 'rejected') && !launched;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const token = await requestKycToken();
      // Loaded on demand: the SDK only runs in the browser and is not needed elsewhere.
      const { default: snsWebSdk } = await import('@sumsub/websdk');
      const instance = snsWebSdk
        .init(token, requestKycToken)
        .withConf({ lang: 'en' })
        .withOptions({ addViewportTag: false, adaptIframeHeight: true })
        .on('idCheck.onApplicantSubmitted', () => setSubmitted(true))
        .on('idCheck.onApplicantStatusChanged', () => void me.refetch())
        .on('idCheck.onError', () =>
          setError('The verification screen reported an error. Please reload and try again.'),
        )
        .build();
      sdk.current = instance;
      setLaunched(true);
      instance.launch(container.current!);
    } catch (caught) {
      setError(kycErrorText(caught));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-live" aria-hidden />
              {text.title}
            </CardTitle>
            {status !== 'none' ? <KycStatusBadge status={status} /> : null}
          </div>
          <CardDescription>{text.body}</CardDescription>
        </CardHeader>
        {error ? (
          <CardContent>
            <p role="alert" className="text-sm text-[#ff8a8e]">
              {error}
            </p>
          </CardContent>
        ) : null}
        <CardFooter className="gap-3">
          {canStart ? (
            <Button onClick={start} disabled={starting}>
              {starting ? 'Opening verification' : status === 'rejected' ? 'Try again' : 'Start verification'}
            </Button>
          ) : null}
          {status === 'approved' ? (
            <Link href="/buy" className="text-sm text-[#8fc1ef] hover:underline">
              Continue to buy shares
            </Link>
          ) : null}
        </CardFooter>
      </Card>
      <div ref={container} aria-label="Identity verification" className={launched ? 'min-h-[36rem]' : 'hidden'} />
    </div>
  );
}
