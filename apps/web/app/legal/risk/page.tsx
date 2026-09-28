import { LegalPage } from '@/components/legal-page';

export const metadata = { title: 'Risk Disclaimer, EQOWA' };

export default function RiskPage() {
  return (
    <LegalPage
      title="Risk Disclaimer"
      intro="Read this before buying tokenised shares. Tokenised real-world assets carry financial and technical risk."
      sections={[
        {
          heading: '1. Not a public exchange',
          body: (
            <p>
              Tokens are issued through private placements and digital asset offerings. They are not listed on a public
              national stock exchange. Secondary liquidity is restricted: tokens can only be transferred to verified
              holders who pass the compliance checks, and only after the lock-up period.
            </p>
          ),
        },
        {
          heading: '2. Smart contract and technology risk',
          body: (
            <p>
              Blockchain infrastructure carries risks including network congestion on Polygon, RPC or service downtime,
              and unforeseen smart contract vulnerabilities. Transactions cannot be reversed once confirmed.
            </p>
          ),
        },
        {
          heading: '3. Capital at risk',
          body: (
            <>
              <p>
                The value of the underlying assets can fall as well as rise. Any projected returns or dividend targets
                communicated by the issuer are targets, not guarantees.
              </p>
              <p>Participants must be prepared for the total loss of the capital invested.</p>
            </>
          ),
        },
        {
          heading: '4. No advice',
          body: (
            <p>
              Nothing on this platform is investment, legal or tax advice. Users should seek independent professional
              advice before investing.
            </p>
          ),
        },
      ]}
    />
  );
}
