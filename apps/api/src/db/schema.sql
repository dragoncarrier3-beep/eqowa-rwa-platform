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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  usdt_amount NUMERIC(78, 0) NOT NULL,
  share_amount NUMERIC(78, 0) NOT NULL,
  fee_amount NUMERIC(78, 0) NOT NULL,
  funds_amount NUMERIC(78, 0) NOT NULL,
  quote_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'quoted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  intent_id TEXT,
  deposit_id UUID REFERENCES deposits (id),
  status TEXT NOT NULL DEFAULT 'open',
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_block_number_idx ON transactions (block_number);
CREATE INDEX IF NOT EXISTS exceptions_status_idx ON exceptions (status);
CREATE INDEX IF NOT EXISTS mint_intents_status_idx ON mint_intents (status);
