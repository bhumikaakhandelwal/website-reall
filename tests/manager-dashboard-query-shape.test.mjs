// Phase 5C: the shape boundary between supabase-js and the two dashboard reads.
//
// The two new functions return DIFFERENT shapes, and getting either wrong turns
// a populated dashboard into an empty one or a 500:
//
//   get_month_xp_total    RETURNS INTEGER      -> `data` is the bare number
//   get_recent_xp_entries RETURNS TABLE (...)  -> `data` is the bare ARRAY of
//                                                 row objects
//
// Neither has a wrapper. The Supabase CLI prints a `{ rows: [...] }` envelope
// for a set-returning function when run by hand, which is NOT what supabase-js
// returns; that envelope must be rejected rather than mistaken for the payload.
//
// These tests drive the REAL lib/db/queries.ts against a stubbed service-role
// client, so the mapping from supabase-js's `data` to the camelCase rows is
// covered on its own - the route tests use the `@/lib/db/queries` double and
// never reach this layer.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { adminState, resetAdminState } from './doubles/supabase-admin.ts';
import { getMonthXpTotal, getRecentXpEntries } from '../lib/db/queries.ts';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

const PERIOD = {
  start: new Date(Date.UTC(2026, 8, 1)),
  end: new Date(Date.UTC(2026, 9, 1)),
};

const ROW = {
  entry_id: 51,
  member_id: MEMBER_ID,
  display_name: 'Basil Shaikh Mohammad',
  xp_amount: -300,
  activity_code: null,
  reason: 'test',
  created_at: '2026-09-17T22:13:22.202146+00:00',
};

const EXPECTED = {
  entryId: 51,
  memberId: MEMBER_ID,
  displayName: 'Basil Shaikh Mohammad',
  xpAmount: -300,
  activityCode: null,
  reason: 'test',
  createdAt: '2026-09-17T22:13:22.202146+00:00',
};

// ---------------------------------------------------------------------------
// getMonthXpTotal
// ---------------------------------------------------------------------------

test('getMonthXpTotal resolves a bare number, with no wrapper', async () => {
  resetAdminState();
  adminState.rpcResult = { data: 250, error: null };

  assert.strictEqual(await getMonthXpTotal(PERIOD), 250);
});

test('getMonthXpTotal passes the window as ISO strings, half-open', async () => {
  resetAdminState();
  adminState.rpcResult = { data: 0, error: null };

  await getMonthXpTotal(PERIOD);

  assert.strictEqual(adminState.rpcCalls.length, 1);
  assert.strictEqual(adminState.rpcCalls[0].fnName, 'get_month_xp_total');
  assert.deepStrictEqual(adminState.rpcCalls[0].args, {
    p_period_start: '2026-09-01T00:00:00.000Z',
    p_period_end: '2026-10-01T00:00:00.000Z',
  });
});

test('getMonthXpTotal reports an empty month as 0, not as a failure', async () => {
  resetAdminState();
  // COALESCE(SUM(...), 0) in SQL. If this were mistaken for "no data" the
  // route would answer 500 for a month in which nothing happened.
  adminState.rpcResult = { data: 0, error: null };

  assert.strictEqual(await getMonthXpTotal(PERIOD), 0);
});

test('getMonthXpTotal keeps a negative month total', async () => {
  resetAdminState();
  // Corrections can outweigh awards; the sign is the whole point.
  adminState.rpcResult = { data: -450, error: null };

  assert.strictEqual(await getMonthXpTotal(PERIOD), -450);
});

test('getMonthXpTotal returns null on a database error', async () => {
  resetAdminState();
  adminState.rpcResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getMonthXpTotal(PERIOD), null);
});

test('getMonthXpTotal returns null for a null or missing result', async () => {
  resetAdminState();

  adminState.rpcResult = { data: null, error: null };
  assert.strictEqual(await getMonthXpTotal(PERIOD), null);

  adminState.rpcResult = { data: undefined, error: null };
  assert.strictEqual(await getMonthXpTotal(PERIOD), null);
});

test('getMonthXpTotal rejects a non-numeric result instead of coercing it', async () => {
  resetAdminState();

  // A string, a NaN, a fraction, a row wrapper and an array are all "the
  // database and this layer disagree". Returning null makes the route answer
  // 500; coercing any of them would render a confident, wrong figure.
  for (const data of ['250', { total: 250 }, [250], NaN, 250.5, true]) {
    adminState.rpcResult = { data, error: null };

    assert.strictEqual(
      await getMonthXpTotal(PERIOD),
      null,
      `data ${JSON.stringify(data)} must not be accepted as a total`
    );
  }
});

// ---------------------------------------------------------------------------
// getRecentXpEntries
// ---------------------------------------------------------------------------

test('getRecentXpEntries maps a bare rows array to camelCase entries', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [ROW], error: null };

  assert.deepStrictEqual(await getRecentXpEntries(10), [EXPECTED]);

  assert.strictEqual(adminState.rpcCalls.length, 1);
  assert.strictEqual(adminState.rpcCalls[0].fnName, 'get_recent_xp_entries');
  assert.deepStrictEqual(adminState.rpcCalls[0].args, { p_limit: 10 });
});

test('getRecentXpEntries passes the limit through untouched', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [], error: null };

  await getRecentXpEntries(3);

  // The clamp is the database's job; this layer must not second-guess it.
  assert.deepStrictEqual(adminState.rpcCalls[0].args, { p_limit: 3 });
});

test('getRecentXpEntries preserves the database order (never sorts)', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [
      { ...ROW, entry_id: 51, display_name: 'Zara' },
      { ...ROW, entry_id: 50, display_name: 'Aisha' },
      { ...ROW, entry_id: 49, display_name: 'Basil Shaikh Mohammad' },
    ],
    error: null,
  };

  const rows = await getRecentXpEntries(10);

  // Ordering (created_at DESC, id DESC) is the database's job.
  assert.deepStrictEqual(
    rows?.map((row) => row.displayName),
    ['Zara', 'Aisha', 'Basil Shaikh Mohammad']
  );
});

test('getRecentXpEntries keeps a positive amount and a null activity code', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [{ ...ROW, xp_amount: 50, activity_code: null, reason: 'Membership' }],
    error: null,
  };

  const rows = await getRecentXpEntries(10);

  assert.strictEqual(rows?.[0].xpAmount, 50);
  // A corrective entry has no activity code - a genuine null, not a fault.
  assert.strictEqual(rows?.[0].activityCode, null);
  assert.strictEqual(rows?.[0].reason, 'Membership');
});

test('getRecentXpEntries keeps a null reason', async () => {
  resetAdminState();
  // The column is nullable and a pre-Phase-3 row may have no reason. The
  // dashboard renders a fallback; this layer must not invent one.
  adminState.rpcResult = { data: [{ ...ROW, reason: null }], error: null };

  const rows = await getRecentXpEntries(10);

  assert.strictEqual(rows?.[0].reason, null);
});

test('getRecentXpEntries rejects the CLI-style { rows } wrapper', async () => {
  resetAdminState();
  // Exactly what the Supabase CLI prints for a set-returning function. If this
  // were mistaken for the payload, a full ledger would render as "no XP has
  // been recorded yet".
  adminState.rpcResult = { data: { rows: [ROW] }, error: null };

  assert.strictEqual(await getRecentXpEntries(10), null);
});

test('getRecentXpEntries returns an empty array for a genuinely empty ledger', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [], error: null };

  assert.deepStrictEqual(await getRecentXpEntries(10), []);
});

test('getRecentXpEntries returns null on error, not an empty history', async () => {
  resetAdminState();
  adminState.rpcResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getRecentXpEntries(10), null);
});

test('getRecentXpEntries returns null when a row does not match the declared shape', async () => {
  resetAdminState();

  // Each of these means the database and this layer disagree, which is an error
  // to report rather than a row to skip quietly.
  const malformed = [
    // missing created_at
    {
      entry_id: ROW.entry_id,
      member_id: ROW.member_id,
      display_name: ROW.display_name,
      xp_amount: ROW.xp_amount,
      activity_code: ROW.activity_code,
      reason: ROW.reason,
    },
    // xp_amount of zero violates the column's CHECK constraint
    { ...ROW, xp_amount: 0 },
    // not a uuid
    { ...ROW, member_id: 'not-a-uuid' },
    // an empty display name
    { ...ROW, display_name: '' },
    // a timestamp that does not parse
    { ...ROW, created_at: 'not-a-date' },
    // a fractional entry id (xp_ledger.id is SERIAL)
    { ...ROW, entry_id: 1.5 },
  ];

  for (const row of malformed) {
    adminState.rpcResult = { data: [row], error: null };

    assert.strictEqual(
      await getRecentXpEntries(10),
      null,
      `row ${JSON.stringify(row)} must be rejected`
    );
  }
});

test('getRecentXpEntries accepts a full timestamp with a numeric offset', async () => {
  resetAdminState();
  // What the database actually emits for a TIMESTAMPTZ.
  adminState.rpcResult = {
    data: [{ ...ROW, created_at: '2026-09-17 22:13:22.202146+00' }],
    error: null,
  };

  const rows = await getRecentXpEntries(10);

  assert.strictEqual(rows?.[0].createdAt, '2026-09-17 22:13:22.202146+00');
});
