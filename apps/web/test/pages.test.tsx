import type { AssetSummaryDto } from '@config/api';
import { render, screen } from '@testing-library/react';

import DesignPage from '@/app/design/page';
import PrivacyPage from '@/app/legal/privacy/page';
import RiskPage from '@/app/legal/risk/page';
import TermsPage from '@/app/legal/terms/page';
import HomePage from '@/app/page';

// next/image needs the Next runtime; a plain img is enough to render the page.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // `priority` is a next/image prop, not an img attribute.
    const attributes = { ...props } as Record<string, string>;
    delete attributes.priority;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...attributes} />;
  },
}));

const LIVE_ASSET: AssetSummaryDto = {
  tokenAddress: '0x2222222222222222222222222222222222222222',
  chainId: 80002,
  name: 'EQOWA Group Shares',
  symbol: 'EQOWAG',
  decimals: 6,
  totalSupply: '1250000000',
  paused: false,
  holderCount: 3,
  maxHolderCount: 500,
  maxBalance: '150000000000',
  dailyMintCap: '250000000000',
  remainingMintAllowance: '249000000000',
  sharePriceUsdt: '5000000',
  lockupDays: 730,
  blockNumber: 48_211,
  readAt: '2026-09-29T09:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pages render', () => {
  it('falls back to the offering figures when the API is not configured', async () => {
    vi.stubEnv('API_INTERNAL_URL', '');
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('EQOWA Group Shares');
    expect(screen.getByText('EQOWAG')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Chain data unavailable')).toBeTruthy();
    expect(screen.getAllByText('n/a')).toHaveLength(3);
  });

  it('shows live supply, holders and status from the API', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test');
    const fetchMock = vi.fn(async () => Response.json({ ok: true, assets: [LIVE_ASSET] }));
    vi.stubGlobal('fetch', fetchMock);

    render(await HomePage());

    expect(fetchMock).toHaveBeenCalledWith(new URL('http://api.test/assets'), expect.anything());
    expect(screen.getByText('Live, block 48,211')).toBeTruthy();
    expect(screen.getByText('1,250')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Verified identities, cap 500')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('treats an API error as unavailable rather than failing the page', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: false, reason: 'chain_unavailable' }, { status: 503 })),
    );
    render(await HomePage());
    expect(screen.getByText('Chain data unavailable')).toBeTruthy();
  });

  it('shows every quote status and the logo on the design page', () => {
    render(<DesignPage />);
    // Once on the sample asset card, once in the status list.
    expect(screen.getAllByText('Held for Safe approval')).toHaveLength(2);
    expect(screen.getByText('Minted')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByAltText('EQOWA logo')).toBeTruthy();
    expect(screen.getByText('#1F6FB8')).toBeTruthy();
  });

  it.each([
    ['Terms of Use', TermsPage],
    ['Privacy Policy', PrivacyPage],
    ['Risk Disclaimer', RiskPage],
  ])('marks %s as a draft pending legal review', (title, Page) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    expect(screen.getByRole('note')).toHaveTextContent('Draft, pending legal review');
  });
});
