// Phase 4: the shape boundary between supabase-js and getMonthlyLeaderboard.
//
// `get_monthly_leaderboard` is declared `RETURNS TABLE (...)`, so PostgREST
// answers with a bare JSON array of row objects and supabase-js resolves that
// array directly as `data`:
//
//   { data: [ { member_id, display_name, xp }, ... ], error: null }
//
// These tests drive the REAL lib/db/queries.ts getMonthlyLeaderboard - not the
// route double - against a stubbed service-role client, so the mapping from
// supabase-js's `data` to the API's camelCase rows is covered on its own.
//
// A wrapper shape (e.g. `{ rows: [...] }`, which is what the Supabase CLI
// prints for a set-returning function and NOT what supabase-js returns) must
// be rejected rather than silently turned into an empty leaderboard.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { adminState, resetAdminState } from './doubles/supabase-admin.ts';
import { getMonthlyLeaderboard } from '../lib/db/queries.ts';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MEMBER_ID = '22222222-2222-4222-8222-222222222222';

const PERIOD = {
  start: new Date(Date.UTC(2026, 8, 1)),
  end: new Date(Date.UTC(2026, 9, 1)),
};

test('maps a bare rows array to camelCase entries', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [{ member_id: MEMBER_ID, display_name: 'Basil', xp: 300 }],
    error: null,
  };

  const rows = await getMonthlyLeaderboard(PERIOD, null);

  assert.deepStrictEqual(rows, [
    { memberId: MEMBER_ID, displayName: 'Basil', xp: 300 },
  ]);

  // The window is handed over as an explicit half-open ISO range, and `null`
  // activity codes mean "every ledger entry counts".
  assert.strictEqual(adminState.rpcCalls.length, 1);
  assert.strictEqual(
    adminState.rpcCalls[0].fnName,
    'get_monthly_leaderboard'
  );
  assert.deepStrictEqual(adminState.rpcCalls[0].args, {
    p_period_start: PERIOD.start.toISOString(),
    p_period_end: PERIOD.end.toISOString(),
    p_activity_codes: null,
  });
});

test('passes activity codes through as a plain array', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [], error: null };

  await getMonthlyLeaderboard(PERIOD, ['open-source-contribution']);

  assert.deepStrictEqual(adminState.rpcCalls[0].args, {
    p_period_start: PERIOD.start.toISOString(),
    p_period_end: PERIOD.end.toISOString(),
    p_activity_codes: ['open-source-contribution'],
  });
});

test('preserves the database row order (never sorts)', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [
      { member_id: MEMBER_ID, display_name: 'Basil', xp: 300 },
      { member_id: OTHER_MEMBER_ID, display_name: 'Aisha', xp: 120 },
    ],
    error: null,
  };

  const rows = await getMonthlyLeaderboard(PERIOD, null);

  assert.deepStrictEqual(
    rows?.map((row) => row.displayName),
    ['Basil', 'Aisha']
  );
});

test('a zero or negative xp row survives the mapping', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [{ member_id: MEMBER_ID, display_name: 'Basil', xp: -40 }],
    error: null,
  };

  // A negative net is a legitimate corrective month; it must not be dropped
  // here (the database already excluded members netting to exactly zero).
  assert.deepStrictEqual(await getMonthlyLeaderboard(PERIOD, null), [
    { memberId: MEMBER_ID, displayName: 'Basil', xp: -40 },
  ]);
});

test('rejects the CLI-style { rows } wrapper instead of reporting an empty board', async () => {
  resetAdminState();
  // Exactly what the Supabase CLI prints for a set-returning function. If this
  // were mistaken for the payload, a leaderboard that has rows would render as
  // "nobody earned anything".
  adminState.rpcResult = {
    data: { rows: [{ member_id: MEMBER_ID, display_name: 'Basil', xp: 300 }] },
    error: null,
  };

  const rows = await getMonthlyLeaderboard(PERIOD, null);

  assert.strictEqual(rows, null);
});

test('returns null on error, not an empty board', async () => {
  resetAdminState();
  adminState.rpcResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getMonthlyLeaderboard(PERIOD, null), null);
});

test('returns null when a row does not match the declared shape', async () => {
  resetAdminState();
  // A row missing `xp` means the database and this layer disagree - an error,
  // not a row to skip quietly.
  adminState.rpcResult = {
    data: [{ member_id: MEMBER_ID, display_name: 'Basil' }],
    error: null,
  };

  assert.strictEqual(await getMonthlyLeaderboard(PERIOD, null), null);
});

test('returns an empty array for a genuinely empty month', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [], error: null };

  assert.deepStrictEqual(await getMonthlyLeaderboard(PERIOD, null), []);
});
