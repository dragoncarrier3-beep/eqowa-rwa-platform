import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSchemaSql } from './db/migrate.ts';
import { buildApp } from './index.ts';

const TABLES = [
  'users',
  'identities',
  'assets',
  'transactions',
  'deposits',
  'mint_intents',
  'exceptions',
  'audit_log',
  'kyc_events',
];

test('schema defines the Milestone 2 tables', () => {
  const sql = loadSchemaSql();
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /sumsub_applicant_id/);
  assert.match(sql, /remainder_amount/);
  assert.match(sql, /wallet_address/);
});

test('GET /health does not need a database', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  await app.close();
});
