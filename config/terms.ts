/**
 * Investor terms and the consent investors give to them. The consent sentence
 * is the statement of the Sign-In with Ethereum message, so every investor's
 * acceptance is a wallet signature over this exact text and version, which the
 * API stores as evidence. No imports: the web app and the API share it.
 *
 * Bump TERMS_VERSION whenever Eqowa legal changes any of the three documents.
 * Investors are then asked to accept again at their next sign-in, and checkout
 * and KYC stay closed until they do.
 */

/** Draft wording pending Eqowa legal review; the pages carry a draft banner. */
export const TERMS_VERSION = '2026-09-draft-1';

export const TERMS_DOCUMENTS = [
  { path: '/legal/terms', title: 'Terms of Use' },
  { path: '/legal/privacy', title: 'Privacy Policy' },
  { path: '/legal/risk', title: 'Risk Disclaimer' },
] as const;

/** Must stay on one line: EIP-4361 statements cannot contain line breaks. */
export function consentStatement(version: string = TERMS_VERSION): string {
  return (
    `I have read and agree to the EQOWA Terms of Use, Privacy Policy and Risk Disclaimer (version ${version}). ` +
    'I understand that tokenised shares carry risk, including the loss of the full amount invested.'
  );
}

/** Short notice shown before the investor accepts. */
export const RISK_NOTICE =
  'EQOWA Group Shares are unlisted securities. Their value can fall to zero, each purchase is locked for 730 days, ' +
  'and there may be no market to sell them. Only invest what you can afford to lose.';
