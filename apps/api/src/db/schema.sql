-- Eqowa Milestone 2 application state. Dashboard and mint pipeline read
-- these tables instead of issuing live RPC calls for every request.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id),
  onchainid_address TEXT NOT NULL UNIQUE,
  country_code INTEGER,
  kyc_status TEXT NOT NULL DEFAULT 'pending',
  sumsub_applicant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE identities ADD COLUMN IF NOT EXISTS sumsub_applicant_id TEXT;

-- On-chain registration after KYC approval, written only by the onboarding
-- worker. Kept apart from onchainid_address (the row key) so a repeat review
-- cannot reset it.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS onchain_identity TEXT;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS onchain_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE identities ADD COLUMN IF NOT EXISTS onchain_error TEXT;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS onchain_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS onchain_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS identities_sumsub_applicant_id_uidx
  ON identities (sumsub_applicant_id)
  WHERE sumsub_applicant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID REFERENCES assets (id),
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  block_number BIGINT NOT NULL,
  event_name TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  amount NUMERIC(78, 0),
  frozen BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id TEXT NOT NULL UNIQUE,
  payer_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  amount NUMERIC(78, 0) NOT NULL,
  tx_hash TEXT,
  block_number BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mint_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users (id),
  wallet_address TEXT,
  usdt_amount NUMERIC(78, 0) NOT NULL,
  share_amount NUMERIC(78, 0) NOT NULL,
  fee_amount NUMERIC(78, 0) NOT NULL,
  funds_amount NUMERIC(78, 0) NOT NULL,
  remainder_amount NUMERIC(78, 0) NOT NULL DEFAULT 0,
  quote_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'quoted',
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mint_intents ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE mint_intents ADD COLUMN IF NOT EXISTS remainder_amount NUMERIC(78, 0) NOT NULL DEFAULT 0;
ALTER TABLE mint_intents ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE mint_intents ADD COLUMN IF NOT EXISTS mint_tx_hash TEXT;

CREATE TABLE IF NOT EXISTS exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  intent_id TEXT,
  deposit_id UUID REFERENCES deposits (id),
  status TEXT NOT NULL DEFAULT 'open',
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution TEXT
);

ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS resolution TEXT;

-- audit_log is append-only. Application code INSERTs rows and never UPDATE/DELETE.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  block_number BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kyc_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  review_answer TEXT,
  country_code INTEGER,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Token balances maintained by the token indexer from Transfer and
-- AddressFrozen. Addresses are lowercase. A frozen wallet keeps its row even
-- at zero balance so ops can still see it.
CREATE TABLE IF NOT EXISTS balances (
  token_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
  frozen BOOLEAN NOT NULL DEFAULT false,
  updated_block BIGINT NOT NULL,
  PRIMARY KEY (token_address, wallet_address)
);

-- Single-use SIWE sign-in nonces. Expired rows are pruned when a new one is issued.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_block_number_idx ON transactions (block_number);
CREATE INDEX IF NOT EXISTS exceptions_status_idx ON exceptions (status);
CREATE INDEX IF NOT EXISTS mint_intents_status_idx ON mint_intents (status);
CREATE INDEX IF NOT EXISTS kyc_events_applicant_id_idx ON kyc_events (applicant_id);
CREATE INDEX IF NOT EXISTS balances_holders_idx ON balances (token_address, balance DESC) WHERE balance > 0 OR frozen;
CREATE INDEX IF NOT EXISTS mint_intents_wallet_idx ON mint_intents (lower(wallet_address), created_at DESC);
