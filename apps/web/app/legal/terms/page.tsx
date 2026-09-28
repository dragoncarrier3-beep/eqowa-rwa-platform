import { LegalPage } from '@/components/legal-page';

export const metadata = { title: 'Terms of Use, EQOWA' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="The rules for accessing the EQOWA portal and interacting with the EQOWA Group Shares protocol."
      sections={[
        {
          heading: '1. Service provider',
          body: (
            <p>
              Eqowa Fintech is a software and technology provider operating tokenisation infrastructure based on the
              T-REX v4 (ERC-3643) standard. Eqowa Fintech is not a registered broker-dealer, investment adviser or
              custodian, and does not hold user funds directly. Payments are made by users into an on-chain escrow
              contract they interact with themselves.
            </p>
          ),
        },
        {
          heading: '2. Eligibility and jurisdiction',
          body: (
            <>
              <p>
                Access is restricted to users who have completed identity verification through the platform&apos;s KYC
                and AML provider and whose on-chain identity has been recorded in the identity registry.
              </p>
              <p>
                Users resident in restricted regions, including the United States, are not permitted to hold or transfer
                tokens. The permitted list of countries is enforced by the compliance rules on-chain and may change.
              </p>
            </>
          ),
        },
        {
          heading: '3. Smart contract finality',
          body: (
            <>
              <p>
                Interactions with the smart contracts deployed on Polygon are final once confirmed. Lock-up periods (730
                days from each issuance), holding limits, holder limits and transfer restrictions are enforced by the
                contract code and cannot be waived by the portal.
              </p>
              <p>
                Purchases are quoted at a fixed price valid for 15 minutes and require a matching payment confirmed
                on-chain. Payments that do not match a valid quote are held for manual review and are not converted to
                tokens automatically.
              </p>
            </>
          ),
        },
        {
          heading: '4. Accounts and security',
          body: (
            <p>
              Investors authenticate by signing a message with their wallet. Users are responsible for the security of
              their wallets and keys. Eqowa Fintech cannot recover a user&apos;s wallet or reverse a confirmed
              transaction.
            </p>
          ),
        },
      ]}
    />
  );
}
