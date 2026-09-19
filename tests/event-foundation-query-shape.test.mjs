// Phase 7A: the boundary between supabase-js and the two event queries.
//
// `events` is read with a plain table select rather than an RPC, so PostgREST
// answers with a bare JSON array of row objects and supabase-js resolves that
// array directly as `data` - there is no wrapper object. (The Supabase CLI
// prints a `{ rows: [...] }` envelope for a set-returning function, which is NOT
// what supabase-js returns; a table select has no envelope at all.) Either way a
// wrong assumption turns a populated register into an empty one, so the shape is
// pinned here.
//
// These tests drive the REAL lib/db/queries.ts against a stubbed service-role
// client, so the snake_case -> camelCase mapping and the null-on-mismatch
// behaviour are covered on their own - the route tests use the
// `@/lib/db/queries` double and never reach this layer.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { adminState, resetAdminState } from './doubles/supabase-admin.ts';
import { getEvents, createEvent } from '../lib/db/queries.ts';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';

const ROW = {
  id: EVENT_ID,
  title: 'Intro to Git workshop',
  event_type: 'workshop',
  event_date: '2026-09-18',
  activity_code: 'technical-session',
  created_by: MEMBER_ID,
  created_at: '2026-09-10T10:00:00.000Z',
  archived_at: null,
  archived_by: null,
};

const EXPECTED = {
  id: EVENT_ID,
  title: 'Intro to Git workshop',
  eventType: 'workshop',
  eventDate: '2026-09-18',
  activityCode: 'technical-session',
  createdBy: MEMBER_ID,
  createdAt: '2026-09-10T10:00:00.000Z',
  archivedAt: null,
  archivedBy: null,
};

// ---------------------------------------------------------------------------
// getEvents
// ---------------------------------------------------------------------------

test('getEvents maps a bare rows array to camelCase entries', async () => {
  resetAdminState();
  adminState.selectResult = { data: [ROW], error: null };

  assert.deepStrictEqual(await getEvents(), [EXPECTED]);
});

test('getEvents asks for the declared columns, newest first', async () => {
  resetAdminState();
  adminState.selectResult = { data: [], error: null };

  await getEvents();

  assert.strictEqual(adminState.selectCalls.length, 1);

  const call = adminState.selectCalls[0];

  assert.strictEqual(call.table, 'events');
  assert.strictEqual(
    call.columns,
    'id, title, event_type, event_date, activity_code, created_by, created_at, archived_at, archived_by'
  );

  // Ordering is the database's job, as everywhere else in this layer: two
  // events on the same day must never reshuffle between identical requests.
  assert.deepStrictEqual(call.orders, [
    { column: 'event_date', ascending: false },
    { column: 'created_at', ascending: false },
  ]);
});

test('getEvents preserves the database order (never sorts)', async () => {
  resetAdminState();
  adminState.selectResult = {
    data: [
      { ...ROW, id: EVENT_ID, title: 'Zeta' },
      { ...ROW, id: MEMBER_ID, title: 'Alpha' },
    ],
    error: null,
  };

  const events = await getEvents();

  assert.deepStrictEqual(
    events?.map((event) => event.title),
    ['Zeta', 'Alpha']
  );
});

test('getEvents keeps a null created_by', async () => {
  resetAdminState();
  // ON DELETE SET NULL: the event outlives the manager who entered it.
  adminState.selectResult = { data: [{ ...ROW, created_by: null }], error: null };

  const events = await getEvents();

  assert.strictEqual(events?.[0].createdBy, null);
});

test('getEvents returns an empty array for a genuinely empty register', async () => {
  resetAdminState();
  adminState.selectResult = { data: [], error: null };

  assert.deepStrictEqual(await getEvents(), []);
});

test('getEvents returns null on error, not an empty register', async () => {
  resetAdminState();
  adminState.selectResult = { data: null, error: { message: 'permission denied' } };

  assert.strictEqual(await getEvents(), null);
});

test('getEvents rejects a wrapper object instead of reporting an empty register', async () => {
  resetAdminState();
  adminState.selectResult = { data: { rows: [ROW] }, error: null };

  assert.strictEqual(await getEvents(), null);
});

test('getEvents returns null when a row does not match the declared shape', async () => {
  resetAdminState();

  // Each of these means the database and this layer disagree, which is an error
  // to report rather than a row to skip quietly.
  const malformed = [
    // an event type outside the vocabulary
    { ...ROW, event_type: 'retired-type' },
    // not a uuid
    { ...ROW, id: 'not-a-uuid' },
    // a date that is not YYYY-MM-DD
    { ...ROW, event_date: '18/09/2026' },
    // a missing column
    {
      id: ROW.id,
      title: ROW.title,
      event_type: ROW.event_type,
      event_date: ROW.event_date,
      activity_code: ROW.activity_code,
      created_by: ROW.created_by,
    },
    // an unparseable timestamp
    { ...ROW, created_at: 'not-a-date' },
    // an empty title
    { ...ROW, title: '' },
  ];

  for (const row of malformed) {
    adminState.selectResult = { data: [row], error: null };

    assert.strictEqual(
      await getEvents(),
      null,
      `row ${JSON.stringify(row)} must be rejected`
    );
  }
});

test('getEvents accepts a date that is well formed even if the day is unusual', async () => {
  resetAdminState();
  // 2026-02-31 cannot exist in a DATE column, so the schema check here is a
  // shape guard; the real calendar check is validateEventDraft, on user input.
  // What matters is that a real date round-trips unchanged.
  adminState.selectResult = { data: [{ ...ROW, event_date: '2026-12-31' }], error: null };

  const events = await getEvents();

  assert.strictEqual(events?.[0].eventDate, '2026-12-31');
});

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------

test('createEvent inserts into events with the declared columns', async () => {
  resetAdminState();
  adminState.insertResult = { error: null };

  const result = await createEvent({
    title: 'Intro to Git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'technical-session',
    createdBy: MEMBER_ID,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(adminState.inserts.length, 1);

  const written = adminState.inserts[0];

  assert.strictEqual(written.table, 'events');

  // Exactly these keys, and in particular no xp_amount: an event names an
  // activity, and the amount is resolved at award time.
  assert.deepStrictEqual(Object.keys(written.row).sort(), [
    'activity_code',
    'created_by',
    'event_date',
    'event_type',
    'id',
    'title',
  ]);

  assert.strictEqual(written.row.title, 'Intro to Git workshop');
  assert.strictEqual(written.row.event_type, 'workshop');
  assert.strictEqual(written.row.event_date, '2026-09-18');
  assert.strictEqual(written.row.activity_code, 'technical-session');
  assert.strictEqual(written.row.created_by, MEMBER_ID);
});

test('createEvent generates a uuid for the new event', async () => {
  resetAdminState();
  adminState.insertResult = { error: null };

  const result = await createEvent({
    title: 'x',
    eventType: 'meeting',
    eventDate: '2026-09-18',
    activityCode: 'membership',
    createdBy: null,
  });

  assert.strictEqual(result.ok, true);
  assert.match(
    result.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'the returned id must be a v4 uuid'
  );

  // The id it reports is the id it wrote.
  assert.strictEqual(adminState.inserts[0].row.id, result.id);
});

test('createEvent generates a different id each time', async () => {
  resetAdminState();
  adminState.insertResult = { error: null };

  const entry = {
    title: 'x',
    eventType: 'meeting',
    eventDate: '2026-09-18',
    activityCode: 'membership',
    createdBy: null,
  };

  const first = await createEvent(entry);
  const second = await createEvent(entry);

  assert.strictEqual(first.ok, true);
  assert.strictEqual(second.ok, true);
  assert.notStrictEqual(first.id, second.id);
});

test('createEvent accepts a null createdBy', async () => {
  resetAdminState();
  adminState.insertResult = { error: null };

  const result = await createEvent({
    title: 'x',
    eventType: 'meeting',
    eventDate: '2026-09-18',
    activityCode: 'membership',
    createdBy: null,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(adminState.inserts[0].row.created_by, null);
});

test('createEvent reports failure without throwing', async () => {
  resetAdminState();
  adminState.insertResult = { error: { code: '23514', message: 'check violation' } };

  const result = await createEvent({
    title: 'x',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'membership',
    createdBy: MEMBER_ID,
  });

  assert.deepStrictEqual(result, { ok: false });
});

test('createEvent writes no XP', async () => {
  resetAdminState();
  adminState.insertResult = { error: null };

  await createEvent({
    title: 'x',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'membership',
    createdBy: MEMBER_ID,
  });

  // One insert, to events, and nothing else - in particular no ledger write.
  assert.strictEqual(adminState.inserts.length, 1);
  assert.strictEqual(adminState.inserts[0].table, 'events');
});
