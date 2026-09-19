// Phase 7B: the boundary between supabase-js and the attendance queries.
//
// These four functions cross two different shapes, and getting either wrong
// turns a working page into a broken one:
//
//   getEventById       .select().eq().maybeSingle() -> `data` is ONE row object
//                                                      or null, NOT an array
//   getEventAttendance .select().eq().order()       -> `data` is a bare ARRAY
//   set_event_attendance   RETURNS TABLE (...)      -> `data` is a bare ARRAY of
//                                                      exactly one row
//   award_event_attendance RETURNS TABLE (...)      -> `data` is a bare ARRAY,
//                                                      and an EMPTY one is the
//                                                      correct answer for
//                                                      "everything was already
//                                                      awarded", not a failure
//
// The Supabase CLI prints a `{ rows: [...] }` envelope for a set-returning
// function when run by hand, which is NOT what supabase-js returns. That shape
// must be rejected rather than mistaken for the payload.
//
// These drive the REAL lib/db/queries.ts against a stubbed service-role client,
// so the mapping is covered on its own - the route tests use the
// `@/lib/db/queries` double and never reach this layer.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { adminState, resetAdminState } from './doubles/supabase-admin.ts';
import {
  awardEventAttendance,
  getEventAttendance,
  getEventById,
  setEventAttendance,
} from '../lib/db/queries.ts';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const ATTENDANCE_ID = '55555555-5555-4555-8555-555555555555';

const EVENT_ROW = {
  id: EVENT_ID,
  title: 'git workshop',
  event_type: 'workshop',
  event_date: '2026-09-10',
  activity_code: 'membership',
  created_by: MEMBER_ID,
  created_at: '2026-09-01T10:00:00.000Z',
};

const EVENT_EXPECTED = {
  id: EVENT_ID,
  title: 'git workshop',
  eventType: 'workshop',
  eventDate: '2026-09-10',
  activityCode: 'membership',
  createdBy: MEMBER_ID,
  createdAt: '2026-09-01T10:00:00.000Z',
};

const ATTENDANCE_ROW = {
  id: ATTENDANCE_ID,
  event_id: EVENT_ID,
  member_id: MEMBER_ID,
  recorded_at: '2026-09-10T10:00:00.000Z',
  xp_ledger_id: null,
};

// ---------------------------------------------------------------------------
// getEventById
// ---------------------------------------------------------------------------

test('getEventById maps a single row to camelCase', async () => {
  resetAdminState();
  adminState.singleResult = { data: EVENT_ROW, error: null };

  assert.deepStrictEqual(await getEventById(EVENT_ID), EVENT_EXPECTED);
});

test('getEventById asks for the declared columns filtered by id', async () => {
  resetAdminState();
  adminState.singleResult = { data: EVENT_ROW, error: null };

  await getEventById(EVENT_ID);

  assert.strictEqual(adminState.selectCalls.length, 1);

  const call = adminState.selectCalls[0];

  assert.strictEqual(call.table, 'events');
  assert.strictEqual(
    call.columns,
    'id, title, event_type, event_date, activity_code, created_by, created_at'
  );
  assert.deepStrictEqual(call.eqs, [{ column: 'id', value: EVENT_ID }]);
});

test('getEventById returns null for an event that does not exist', async () => {
  resetAdminState();
  adminState.singleResult = { data: null, error: null };

  assert.strictEqual(await getEventById(EVENT_ID), null);
});

test('getEventById returns null on error', async () => {
  resetAdminState();
  adminState.singleResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getEventById(EVENT_ID), null);
});

test('getEventById rejects a row that does not match the declared shape', async () => {
  resetAdminState();

  for (const row of [
    { ...EVENT_ROW, event_type: 'retired-type' },
    { ...EVENT_ROW, id: 'not-a-uuid' },
    { ...EVENT_ROW, event_date: '10/09/2026' },
  ]) {
    adminState.singleResult = { data: row, error: null };

    assert.strictEqual(await getEventById(EVENT_ID), null, JSON.stringify(row));
  }
});

// ---------------------------------------------------------------------------
// getEventAttendance
// ---------------------------------------------------------------------------

test('getEventAttendance maps a bare rows array to camelCase', async () => {
  resetAdminState();
  adminState.selectResult = { data: [ATTENDANCE_ROW], error: null };

  assert.deepStrictEqual(await getEventAttendance(EVENT_ID), [
    {
      id: ATTENDANCE_ID,
      eventId: EVENT_ID,
      memberId: MEMBER_ID,
      recordedAt: '2026-09-10T10:00:00.000Z',
      xpLedgerId: null,
    },
  ]);
});

test('getEventAttendance asks for the declared columns filtered by event', async () => {
  resetAdminState();
  adminState.selectResult = { data: [], error: null };

  await getEventAttendance(EVENT_ID);

  const call = adminState.selectCalls[0];

  assert.strictEqual(call.table, 'attendance');
  assert.strictEqual(call.columns, 'id, event_id, member_id, recorded_at, xp_ledger_id');
  assert.deepStrictEqual(call.eqs, [{ column: 'event_id', value: EVENT_ID }]);
  // Ordered so the result is stable between two identical requests.
  assert.deepStrictEqual(call.orders, [{ column: 'member_id', ascending: true }]);
});

test('getEventAttendance keeps an awarded ledger id and a null one', async () => {
  resetAdminState();
  adminState.selectResult = {
    data: [
      { ...ATTENDANCE_ROW, xp_ledger_id: 42 },
      { ...ATTENDANCE_ROW, id: EVENT_ID, xp_ledger_id: null },
    ],
    error: null,
  };

  const rows = await getEventAttendance(EVENT_ID);

  assert.strictEqual(rows?.[0].xpLedgerId, 42);
  assert.strictEqual(rows?.[1].xpLedgerId, null);
});

test('getEventAttendance returns an empty array for an event with nobody recorded', async () => {
  resetAdminState();
  adminState.selectResult = { data: [], error: null };

  assert.deepStrictEqual(await getEventAttendance(EVENT_ID), []);
});

test('getEventAttendance returns null on error, not an empty list', async () => {
  resetAdminState();
  adminState.selectResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getEventAttendance(EVENT_ID), null);
});

test('getEventAttendance rejects a wrapper object', async () => {
  resetAdminState();
  adminState.selectResult = { data: { rows: [ATTENDANCE_ROW] }, error: null };

  assert.strictEqual(await getEventAttendance(EVENT_ID), null);
});

test('getEventAttendance rejects a row that does not match the declared shape', async () => {
  resetAdminState();

  for (const row of [
    { ...ATTENDANCE_ROW, xp_ledger_id: 'not-a-number' },
    { ...ATTENDANCE_ROW, member_id: 'not-a-uuid' },
    { ...ATTENDANCE_ROW, recorded_at: 'not-a-date' },
  ]) {
    adminState.selectResult = { data: [row], error: null };

    assert.strictEqual(await getEventAttendance(EVENT_ID), null, JSON.stringify(row));
  }
});

// ---------------------------------------------------------------------------
// setEventAttendance
// ---------------------------------------------------------------------------

test('setEventAttendance passes the event and the member ids to the function', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [{ added: 2, removed: 1, kept_awarded: 0 }], error: null };

  const result = await setEventAttendance(EVENT_ID, [MEMBER_ID]);

  assert.deepStrictEqual(result, { ok: true, added: 2, removed: 1, keptAwarded: 0 });

  assert.strictEqual(adminState.rpcCalls.length, 1);
  assert.strictEqual(adminState.rpcCalls[0].fnName, 'set_event_attendance');
  assert.deepStrictEqual(adminState.rpcCalls[0].args, {
    p_event_id: EVENT_ID,
    p_member_ids: [MEMBER_ID],
  });
});

test('setEventAttendance accepts an empty member list', async () => {
  resetAdminState();
  adminState.rpcResult = { data: [{ added: 0, removed: 3, kept_awarded: 0 }], error: null };

  const result = await setEventAttendance(EVENT_ID, []);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(adminState.rpcCalls[0].args, {
    p_event_id: EVENT_ID,
    p_member_ids: [],
  });
});

test('setEventAttendance returns failure on a database error', async () => {
  resetAdminState();
  adminState.rpcResult = { data: null, error: { message: 'no_data_found' } };

  assert.deepStrictEqual(await setEventAttendance(EVENT_ID, []), { ok: false });
});

test('setEventAttendance rejects a wrapper object and a wrong row count', async () => {
  resetAdminState();

  // The CLI-style envelope, and a function that somehow returned two rows.
  for (const data of [{ rows: [{ added: 1, removed: 0, kept_awarded: 0 }] }, [], [{ added: 1, removed: 0, kept_awarded: 0 }, { added: 1, removed: 0, kept_awarded: 0 }]]) {
    adminState.rpcResult = { data, error: null };

    assert.deepStrictEqual(
      await setEventAttendance(EVENT_ID, []),
      { ok: false },
      JSON.stringify(data)
    );
  }
});

test('setEventAttendance rejects non-integer counts', async () => {
  resetAdminState();

  for (const row of [
    { added: '2', removed: 0, kept_awarded: 0 },
    { added: 2, removed: null, kept_awarded: 0 },
    { added: 2.5, removed: 0, kept_awarded: 0 },
    { added: 2, removed: 0 },
  ]) {
    adminState.rpcResult = { data: [row], error: null };

    assert.deepStrictEqual(
      await setEventAttendance(EVENT_ID, []),
      { ok: false },
      JSON.stringify(row)
    );
  }
});

// ---------------------------------------------------------------------------
// awardEventAttendance
// ---------------------------------------------------------------------------

test('awardEventAttendance passes the event and the resolved amount', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [{ member_id: MEMBER_ID, ledger_id: 99 }],
    error: null,
  };

  const result = await awardEventAttendance(EVENT_ID, 50);

  assert.deepStrictEqual(result, { ok: true, awarded: 1 });
  assert.strictEqual(adminState.rpcCalls[0].fnName, 'award_event_attendance');
  assert.deepStrictEqual(adminState.rpcCalls[0].args, {
    p_event_id: EVENT_ID,
    p_xp_amount: 50,
  });
});

test('awardEventAttendance treats an empty result as success with zero awarded', async () => {
  // This is what the idempotency guard produces on a second run: nothing to do.
  // Reporting it as a failure would turn a correct no-op into an error page.
  resetAdminState();
  adminState.rpcResult = { data: [], error: null };

  assert.deepStrictEqual(await awardEventAttendance(EVENT_ID, 50), {
    ok: true,
    awarded: 0,
  });
});

test('awardEventAttendance counts every row the function returned', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: [
      { member_id: MEMBER_ID, ledger_id: 1 },
      { member_id: EVENT_ID, ledger_id: 2 },
      { member_id: ATTENDANCE_ID, ledger_id: 3 },
    ],
    error: null,
  };

  assert.deepStrictEqual(await awardEventAttendance(EVENT_ID, 50), {
    ok: true,
    awarded: 3,
  });
});

test('awardEventAttendance returns failure on a database error', async () => {
  resetAdminState();
  adminState.rpcResult = { data: null, error: { message: 'check_violation' } };

  assert.deepStrictEqual(await awardEventAttendance(EVENT_ID, 50), { ok: false });
});

test('awardEventAttendance rejects a wrapper object', async () => {
  resetAdminState();
  adminState.rpcResult = {
    data: { rows: [{ member_id: MEMBER_ID, ledger_id: 1 }] },
    error: null,
  };

  assert.deepStrictEqual(await awardEventAttendance(EVENT_ID, 50), { ok: false });
});

test('awardEventAttendance rejects a row that is not a member/ledger pair', async () => {
  resetAdminState();

  for (const row of [
    { member_id: MEMBER_ID },
    { ledger_id: 1 },
    { member_id: MEMBER_ID, ledger_id: '1' },
    { member_id: 42, ledger_id: 1 },
  ]) {
    adminState.rpcResult = { data: [row], error: null };

    assert.deepStrictEqual(
      await awardEventAttendance(EVENT_ID, 50),
      { ok: false },
      JSON.stringify(row)
    );
  }
});
