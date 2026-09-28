import type { MintQuoteStatus } from '@config/mint';

import { Badge, type BadgeProps } from '@/components/ui/badge';

type Tone = NonNullable<BadgeProps['tone']>;

/** One place that decides how each pipeline status reads and looks in both portals. */
export const QUOTE_STATUS_PRESENTATION: Record<MintQuoteStatus, { label: string; tone: Tone }> = {
  quoted: { label: 'Awaiting payment', tone: 'neutral' },
  deposited: { label: 'Payment received', tone: 'primary' },
  awaiting_confirmations: { label: 'Confirming', tone: 'live' },
  awaiting_safe_approval: { label: 'Held for Safe approval', tone: 'warning' },
  safe_approved: { label: 'Approved, minting next', tone: 'primary' },
  minting: { label: 'Minting', tone: 'live' },
  minted: { label: 'Minted', tone: 'success' },
  expired: { label: 'Quote expired', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export function QuoteStatusBadge({ status }: { status: MintQuoteStatus }) {
  const { label, tone } = QUOTE_STATUS_PRESENTATION[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export const KYC_STATUS_PRESENTATION = {
  pending: { label: 'KYC pending', tone: 'neutral' as Tone },
  approved: { label: 'KYC approved', tone: 'success' as Tone },
  rejected: { label: 'KYC rejected', tone: 'danger' as Tone },
  blocked_country: { label: 'Country not allowed', tone: 'danger' as Tone },
};

export function KycStatusBadge({ status }: { status: keyof typeof KYC_STATUS_PRESENTATION }) {
  const { label, tone } = KYC_STATUS_PRESENTATION[status];
  return <Badge tone={tone}>{label}</Badge>;
}
