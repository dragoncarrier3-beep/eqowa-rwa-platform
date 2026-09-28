import { LegalPage } from '@/components/legal-page';

export const metadata = { title: 'Privacy Policy, EQOWA' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="How identity and transaction data is collected, used and protected on the EQOWA platform."
      sections={[
        {
          heading: '1. Data collected',
          body: (
            <p>
              Personal identification data collected during KYC verification by the platform&apos;s verification
              provider (Sumsub), wallet public addresses, and transaction metadata recorded on the Polygon blockchain
              and in the platform database.
            </p>
          ),
        },
        {
          heading: '2. Purpose of processing',
          body: (
            <p>
              Data is processed for identity verification, anti-money laundering (AML) screening, countering the
              financing of terrorism (CTF), maintaining the on-chain identity registry, settling purchases, and
              regulatory reporting. It is not used for marketing without separate consent.
            </p>
          ),
        },
        {
          heading: '3. Storage and security',
          body: (
            <>
              <p>
                Identity documents are held by the verification provider. The platform stores the verification outcome,
                country of residence and the on-chain identity address. Sensitive compliance data is kept separate from
                public blockchain data and access is restricted to authorised administrators using hardware security
                keys.
              </p>
              <p>
                Blockchain records are public and permanent by design. Only wallet addresses and token movements are
                written on-chain; no personal identification data is stored on the blockchain.
              </p>
            </>
          ),
        },
        {
          heading: '4. Your rights',
          body: (
            <p>
              Subject to applicable data protection law, users may request access to, correction of, or deletion of
              personal data held by the platform, except where retention is required for regulatory compliance.
            </p>
          ),
        },
      ]}
    />
  );
}
