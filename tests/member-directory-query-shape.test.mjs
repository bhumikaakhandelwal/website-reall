// Phase 5A: the shape boundary between supabase-js and getMemberDirectory.
//
// `get_member_directory` is declared `RETURNS TABLE (...)`, so PostgREST
// answers with a bare JSON array of row objects and supabase-js resolves that
// array directly as `data`:
//
//   { data: [ { member_id, email, display_name, membership_status, created_at, total_xp }, ... ], error: null }
//
// These tests drive the REAL lib/db/queries.ts getMemberDirectory - not the
// route double - against a stubbed service-role client, so the mapping from
// supabase-js's `data` to the camelCase rows is covered on its own.
//
// A wrapper shape (e.g. `{ rows: [...] }`, which is what the Supabase CLI
// prints for a set-returning function and NOT what supabase-js returns) must
// be rejected rather than silently turned into an empty roster.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { adminState, resetAdminState } from './doubles/supabase-admin.ts';
import { getMemberDirectory } from '../lib/db/queries.ts';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

const ROW = {
  member_id: MEMBER_ID,
  email: 'basil@dbcegoa.ac.in',
  display_name: 'Basil',
  membership_status: 'active',
  created_at: '2026-07-01T00:00:00+00:00',
  total_xp: 750,
  archived_at: null,
};

test('maps a bare rows array to camelCase entries', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [ROW], error: null };

  const rows = await getMemberDirectory();

  assert.deepStrictEqual(rows, [
    {
      memberId: MEMBER_ID,
      email: 'basil@dbcegoa.ac.in',
      displayName: 'Basil',
      membershipStatus: 'active',
      joinedAt: '2026-07-01T00:00:00+00:00',
      totalXp: 750,
      // Phase 8E: the directory carries archive state, so the active and
      // archived lists can both come from this one read.
      archivedAt: null,
    },
  ]);

  // One parameterless call: the roster is not filtered server-side.
  assert.strictEqual(adminState.rpcCalls.length, 1);
  assert.strictEqual(adminState.rpcCalls[0].fnName, 'get_member_directory');
  assert.strictEqual(adminState.rpcCalls[0].args, undefined);
});

test('preserves the database row order (never sorts)', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [
      { ...ROW, display_name: 'Aisha' },
      { ...ROW, member_id: '22222222-2222-4222-8222-222222222222', display_name: 'Basil' },
    ],
    error: null,
  };

  const rows = await getMemberDirectory();

  // Ordering (display_name, member id) is the database's job.
  assert.deepStrictEqual(
    rows?.map((row) => row.displayName),
    ['Aisha', 'Basil']
  );
});

test('a member with no ledger rows is a genuine zero, not a dropped row', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [{ ...ROW, total_xp: 0 }],
    error: null,
  };

  // COALESCE(SUM(...), 0) in SQL means 0 here; the row must survive.
  assert.deepStrictEqual(await getMemberDirectory(), [
    {
      memberId: MEMBER_ID,
      email: 'basil@dbcegoa.ac.in',
      displayName: 'Basil',
      membershipStatus: 'active',
      joinedAt: '2026-07-01T00:00:00+00:00',
      totalXp: 0,
      archivedAt: null,
    },
  ]);
});

test('a negative total survives the mapping', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [{ ...ROW, total_xp: -40 }], error: null };

  const rows = await getMemberDirectory();

  assert.strictEqual(rows?.[0].totalXp, -40);
});

test('every membership status maps through unchanged', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [
      { ...ROW, membership_status: 'pending' },
      { ...ROW, member_id: '22222222-2222-4222-8222-222222222222', membership_status: 'inactive' },
    ],
    error: null,
  };

  const rows = await getMemberDirectory();

  assert.deepStrictEqual(
    rows?.map((row) => row.membershipStatus),
    ['pending', 'inactive']
  );
});

test('rejects the CLI-style { rows } wrapper instead of reporting an empty roster', async () => {
  resetAdminState();
  // Exactly what the Supabase CLI prints for a set-returning function. If this
  // were mistaken for the payload, a full roster would render as "no members".
  adminState.rpcResult = { data: { rows: [ROW] }, error: null };

  assert.strictEqual(await getMemberDirectory(), null);
});

test('returns null on error, not an empty roster', async () => {
  resetAdminState();
  adminState.rpcResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getMemberDirectory(), null);
});

test('returns null when a row does not match the declared shape', async () => {
  resetAdminState();
  // A row missing `total_xp` means the database and this layer disagree - an
  // error, not a row to skip quietly.
  const incomplete = {
    member_id: ROW.member_id,
    email: ROW.email,
    display_name: ROW.display_name,
    membership_status: ROW.membership_status,
    created_at: ROW.created_at,
  };
  adminState.rpcResult = { data: [incomplete], error: null };

  assert.strictEqual(await getMemberDirectory(), null);
});

test('returns null when a membership status is not one of the three allowed values', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [{ ...ROW, membership_status: 'alumni' }],
    error: null,
  };

  assert.strictEqual(await getMemberDirectory(), null);
});

test('returns an empty array for a genuinely empty roster', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [], error: null };

  assert.deepStrictEqual(await getMemberDirectory(), []);
});
