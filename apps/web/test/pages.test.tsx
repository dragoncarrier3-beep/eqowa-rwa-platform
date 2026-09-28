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

describe('pages render', () => {
  it('shows the token on the landing page', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('EQOWA Group Shares');
    expect(screen.getByText('EQOWAG')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
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
