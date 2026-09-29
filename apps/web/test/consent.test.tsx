import { fireEvent, render, screen } from '@testing-library/react';

import { RISK_NOTICE } from '@config/terms';

import { ConsentPanel } from '@/components/consent-panel';

describe('ConsentPanel', () => {
  it('shows the risk notice and links, and only lets the investor continue after ticking the box', () => {
    const onAgree = vi.fn();
    render(<ConsentPanel busy={false} onAgree={onAgree} onCancel={() => undefined} />);

    expect(screen.getByText(RISK_NOTICE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy');
    expect(screen.getByRole('link', { name: 'Risk Disclaimer' })).toHaveAttribute('href', '/legal/risk');

    const agree = screen.getByRole('button', { name: 'Agree and sign in' });
    expect(agree).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(agree).toBeEnabled();
    fireEvent.click(agree);
    expect(onAgree).toHaveBeenCalledOnce();
  });

  it('can be cancelled', () => {
    const onCancel = vi.fn();
    render(<ConsentPanel busy={false} onAgree={() => undefined} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
