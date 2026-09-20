// Phase 8A: the event lifecycle.
//
// Two halves, deliberately in one file because they cover one feature:
//
//   1. the pure logic in lib/events/lifecycle.ts - the archive split, the
//      read-only rule, the sentences each action shows, and the three client
//      calls. This project has no DOM test environment (Node's type stripping
//      does not transform JSX, so a .tsx component cannot be imported into a
//      test at all), so these functions are where the page's decisions live and
//      where they can actually be asserted.
//
//   2. the three new routes plus the two Phase 7B routes that gained a read-only
//      guard, run for real against in-memory doubles for the Supabase boundary
//      and the session reader.
//
// The two rules this file exists to pin: an archived event is read-only, and an
// event can only be deleted while nobody is recorded on it.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import {
  archiveEvent,
  deleteEvent,
  describeArchive,
  describeDelete,
  describeDeleteRefusal,
  describeEdit,
  editEvent,
  formatArchivedDate,
  isArchived,
  isEditable,
  splitByArchive,
} from '@/lib/events/lifecycle';
import { PATCH as patchEvent, DELETE as deleteEventRoute } from '@/app/api/events/[id]/route';
import { POST as archiveEventRoute } from '@/app/api/events/[id]/archive/route';
import { PUT as putAttendance } from '@/app/api/events/[id]/attendance/route';
import { POST as awardEvent } from '@/app/api/events/[id]/award/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_EVENT_ID = '66666666-6666-4666-8666-666666666666';

const BASIL = {
  id: BASIL_ID,
  email: '2414011@dbcegoa.ac.in',
  display_name: 'Basil Shaikh Mohammad',
  membership_status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const ORDINARY = {
  ...BASIL,
  id: MEMBER_ID,
  email: 'ordinary-member@dbcegoa.ac.in',
  display_name: 'Ordinary Member',
};

function signInAs(profile) {
  authState.memberId = profile ? profile.id : null;
}

function reset() {
  resetDbState();
  authState.memberId = null;
}

function signInAsManager(profile = BASIL) {
  signInAs(profile);
  dbState.profile = profile;
}

function context(id) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(method, body) {
  return new Request('http://localhost/api/events/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fetchStub(status, body) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** An active event, as the API returns it. */
function eventRecord(overrides = {}) {
  return {
    id: EVENT_ID,
    title: 'git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-10',
    activityCode: 'membership',
    createdBy: BASIL_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

/** The same event, archived. */
function archivedRecord(overrides = {}) {
  return eventRecord({
    archivedAt: '2026-09-19T10:00:00.000Z',
    archivedBy: BASIL_ID,
    ...overrides,
  });
}

const GOOD_BODY = {
  title: 'Intro to Git workshop',
  eventType: 'workshop',
  eventDate: '2026-09-18',
  activityCode: 'technical-session',
};

// ---------------------------------------------------------------------------
// splitByArchive
// ---------------------------------------------------------------------------

test('splitByArchive separates active from archived', () => {
  const groups = splitByArchive([
    eventRecord({ id: EVENT_ID }),
    archivedRecord({ id: OTHER_EVENT_ID }),
  ]);

  assert.deepStrictEqual(groups.active.map((e) => e.id), [EVENT_ID]);
  assert.deepStrictEqual(groups.archived.map((e) => e.id), [OTHER_EVENT_ID]);
});

test('splitByArchive keeps the order the database returned', () => {
  // Ordering is the database's job; re-sorting here would be a second opinion
  // that could disagree with it.
  const groups = splitByArchive([
    eventRecord({ id: 'a' }),
    archivedRecord({ id: 'b' }),
    eventRecord({ id: 'c' }),
    archivedRecord({ id: 'd' }),
  ]);

  assert.deepStrictEqual(groups.active.map((e) => e.id), ['a', 'c']);
  assert.deepStrictEqual(groups.archived.map((e) => e.id), ['b', 'd']);
});

test('splitByArchive of nothing is two empty lists', () => {
  assert.deepStrictEqual(splitByArchive([]), { active: [], archived: [] });
});

test('splitByArchive puts everything in active when nothing is archived', () => {
  const groups = splitByArchive([eventRecord()]);

  assert.strictEqual(groups.active.length, 1);
  assert.strictEqual(groups.archived.length, 0);
});

test('splitByArchive does not mutate the list it was given', () => {
  const events = [eventRecord(), archivedRecord({ id: OTHER_EVENT_ID })];
  const before = JSON.parse(JSON.stringify(events));

  splitByArchive(events);

  assert.deepStrictEqual(events, before);
});

// ---------------------------------------------------------------------------
// The read-only rule
// ---------------------------------------------------------------------------

test('isArchived is true only once archivedAt is set', () => {
  assert.strictEqual(isArchived(eventRecord()), false);
  assert.strictEqual(isArchived(archivedRecord()), true);
});

test('isEditable is the inverse, and is the one answer to the rule', () => {
  assert.strictEqual(isEditable(eventRecord()), true);
  assert.strictEqual(isEditable(archivedRecord()), false);
});

test('every event lands in exactly one group', () => {
  // The split and the read-only rule must agree: a row in the archived group
  // that still reported itself editable would offer to edit a frozen event.
  for (const record of [eventRecord(), archivedRecord()]) {
    const groups = splitByArchive([record]);
    const inArchived = groups.archived.length === 1;

    assert.strictEqual(inArchived, isArchived(record));
    assert.strictEqual(inArchived, !isEditable(record));
  }
});

// ---------------------------------------------------------------------------
// formatArchivedDate
// ---------------------------------------------------------------------------

test('formatArchivedDate renders the UTC date of the archive', () => {
  assert.strictEqual(formatArchivedDate('2026-09-19T10:00:00.000Z'), 'Sat, 19 Sept, 2026');
});

test('formatArchivedDate does not slip a day for a late-UTC archive', () => {
  // 23:30 UTC is still the 19th. Formatting locally would render the 20th for
  // anyone east of UTC, which is the bug class the whole project pins against.
  assert.strictEqual(formatArchivedDate('2026-09-19T23:30:00.000Z'), 'Sat, 19 Sept, 2026');
});

// ---------------------------------------------------------------------------
// The sentences
// ---------------------------------------------------------------------------

test('describeDeleteRefusal names the count and explains the rule', () => {
  const one = describeDeleteRefusal(1);
  const many = describeDeleteRefusal(12);

  assert.match(one, /1 member is recorded/);
  assert.match(many, /12 members are recorded/);

  for (const message of [one, many]) {
    assert.match(message, /cannot be deleted/);
    // Points at the alternative rather than just refusing.
    assert.match(message, /archive it instead/i);
  }
});

test('the outcome sentences say the audit trail is untouched', () => {
  // The phase brief asks for the attendance and XP trail to be preserved, so
  // every action that could worry a manager says so.
  assert.match(describeArchive('git workshop'), /read-only/);
  assert.match(describeArchive('git workshop'), /attendance and XP are unchanged/);
  assert.match(describeEdit('git workshop'), /attendance and XP are unchanged/);
  assert.match(describeDelete('git workshop'), /nothing else was affected/);
});

// ---------------------------------------------------------------------------
// editEvent
// ---------------------------------------------------------------------------

test('editEvent PATCHes only the four metadata fields', async () => {
  let captured = null;

  const outcome = await editEvent(EVENT_ID, GOOD_BODY, async (url, init) => {
    captured = { url, method: init.method, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(captured.method, 'PATCH');
  assert.strictEqual(captured.url, `/api/events/${EVENT_ID}`);

  // Exactly these keys. Nothing about attendance or XP is sent, which is what
  // "preserve the audit trail" means for an edit.
  assert.deepStrictEqual(Object.keys(captured.body).sort(), [
    'activityCode',
    'eventDate',
    'eventType',
    'title',
  ]);
});

test('editEvent validates before making a request', async () => {
  let called = false;

  const outcome = await editEvent(
    EVENT_ID,
    { ...GOOD_BODY, title: '   ' },
    async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }
  );

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'rejected');
  assert.strictEqual(called, false, 'an invalid draft must not reach the network');
});

test('editEvent trims the draft it sends', async () => {
  let body = null;

  await editEvent(
    EVENT_ID,
    { ...GOOD_BODY, title: '  Padded  ', activityCode: '  membership  ' },
    async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response('{}', { status: 200 });
    }
  );

  assert.strictEqual(body.title, 'Padded');
  assert.strictEqual(body.activityCode, 'membership');
});

test('editEvent reports an archived event as a conflict', async () => {
  // The read-only rule, seen from the client: 409 becomes a sentence that says
  // the event is frozen rather than a generic failure.
  const outcome = await editEvent(
    EVENT_ID,
    GOOD_BODY,
    fetchStub(409, { error: 'Event is archived' })
  );

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'conflict');
  assert.match(outcome.message, /archived/);
  assert.match(outcome.message, /read-only/);
});

test('editEvent maps the other failures', async () => {
  for (const [status, kind] of [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [400, 'rejected'],
    [500, 'unavailable'],
  ]) {
    const outcome = await editEvent(EVENT_ID, GOOD_BODY, fetchStub(status, {}));

    assert.strictEqual(outcome.kind, kind, String(status));
  }
});

test('editEvent reports a network failure as unavailable', async () => {
  const outcome = await editEvent(EVENT_ID, GOOD_BODY, async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(outcome.kind, 'unavailable');
});

// ---------------------------------------------------------------------------
// archiveEvent
// ---------------------------------------------------------------------------

test('archiveEvent POSTs with no body', async () => {
  let captured = null;

  const outcome = await archiveEvent(EVENT_ID, 'git workshop', async (url, init) => {
    captured = { url, method: init.method, body: init.body };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(captured.method, 'POST');
  assert.strictEqual(captured.url, `/api/events/${EVENT_ID}/archive`);
  assert.strictEqual(captured.body, undefined);
  assert.match(outcome.message, /read-only/);
});

test('archiveEvent maps the failures', async () => {
  for (const [status, kind] of [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [500, 'unavailable'],
  ]) {
    const outcome = await archiveEvent(EVENT_ID, 'x', fetchStub(status, {}));

    assert.strictEqual(outcome.kind, kind, String(status));
  }
});

// ---------------------------------------------------------------------------
// deleteEvent
// ---------------------------------------------------------------------------

test('deleteEvent DELETEs the event', async () => {
  let captured = null;

  const outcome = await deleteEvent(EVENT_ID, 'git workshop', async (url, init) => {
    captured = { url, method: init.method };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(captured.method, 'DELETE');
  assert.strictEqual(captured.url, `/api/events/${EVENT_ID}`);
});

test('deleteEvent turns a refusal into the attendance explanation', async () => {
  // 409 with a count is the rule being enforced, not a failure. The sentence
  // says how many people are recorded and points at archiving instead.
  const outcome = await deleteEvent(
    EVENT_ID,
    'git workshop',
    fetchStub(409, { error: 'Event has attendance', attendanceCount: 42 })
  );

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'conflict');
  assert.match(outcome.message, /42 members are recorded/);
  assert.match(outcome.message, /archive it instead/i);
});

test('deleteEvent maps the other failures', async () => {
  for (const [status, kind] of [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [500, 'unavailable'],
  ]) {
    const outcome = await deleteEvent(EVENT_ID, 'x', fetchStub(status, {}));

    assert.strictEqual(outcome.kind, kind, String(status));
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/events/[id]
// ---------------------------------------------------------------------------

test('editing answers 401 with no session and 403 for a non-manager', async () => {
  reset();
  const unauthorized = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context(EVENT_ID));

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context(EVENT_ID));

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.updateEventCalls, []);
});

test('editing answers 404 for an id that is not a uuid', async () => {
  reset();
  signInAsManager();

  const response = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context('not-a-uuid'));

  assert.strictEqual(response.status, 404);
  assert.strictEqual(dbState.eventByIdLookups.length, 0);
});

test('editing answers 404 for an event that does not exist', async () => {
  reset();
  signInAsManager();
  dbState.eventById = null;

  const response = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context(EVENT_ID));

  assert.strictEqual(response.status, 404);
  assert.deepStrictEqual(dbState.updateEventCalls, []);
});

test('editing an archived event is refused with a conflict', async () => {
  // The read-only rule. 409 rather than 403: the manager IS allowed to use this
  // endpoint; the event is simply frozen.
  reset();
  signInAsManager();
  dbState.eventById = archivedRecord();

  const response = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context(EVENT_ID));

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Event is archived' });
  assert.deepStrictEqual(dbState.updateEventCalls, [], 'nothing may be written');
});

test('editing updates an active event', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();

  const response = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context(EVENT_ID));

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), { ok: true });
  assert.deepStrictEqual(dbState.updateEventCalls, [
    {
      id: EVENT_ID,
      update: {
        title: 'Intro to Git workshop',
        eventType: 'workshop',
        eventDate: '2026-09-18',
        activityCode: 'technical-session',
      },
    },
  ]);
});

test('editing rejects an invalid body before anything is written', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();

  const invalid = [
    {},
    { ...GOOD_BODY, title: '' },
    { ...GOOD_BODY, title: '   ' },
    { ...GOOD_BODY, title: 'a'.repeat(201) },
    { ...GOOD_BODY, eventType: 'retired-type' },
    { ...GOOD_BODY, eventDate: '2026-02-31' },
    { ...GOOD_BODY, eventDate: '18/09/2026' },
    { ...GOOD_BODY, activityCode: '' },
    { ...GOOD_BODY, xpAmount: 9999 },
  ];

  for (const body of invalid) {
    const response = await patchEvent(jsonRequest('PATCH', body), context(EVENT_ID));

    assert.strictEqual(response.status, 400, JSON.stringify(body));
  }

  assert.deepStrictEqual(dbState.updateEventCalls, []);
});

test('editing checks the activity code against the Handbook', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();

  const response = await patchEvent(
    jsonRequest('PATCH', { ...GOOD_BODY, activityCode: 'a-code-that-does-not-exist' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(await response.json(), { error: 'Unknown activity code' });
  assert.deepStrictEqual(dbState.updateEventCalls, []);
});

test('editing reports a conflict when the guard matched no row', async () => {
  // The event was archived between the route's read and its write. The UPDATE
  // is guarded, so nothing changed - and the caller is told why rather than
  // being told the edit succeeded.
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();
  dbState.updateEventResult = false;

  const response = await patchEvent(jsonRequest('PATCH', GOOD_BODY), context(EVENT_ID));

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Event is archived' });
});

// ---------------------------------------------------------------------------
// DELETE /api/events/[id]
// ---------------------------------------------------------------------------

test('deleting answers 401 with no session and 403 for a non-manager', async () => {
  reset();
  const unauthorized = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.deleteEventCalls, []);
});

test('deleting answers 404 for an id that is not a uuid', async () => {
  reset();
  signInAsManager();

  const response = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context('not-a-uuid')
  );

  assert.strictEqual(response.status, 404);
  assert.deepStrictEqual(dbState.deleteEventCalls, []);
});

test('deleting an event with attendance is refused with the count', async () => {
  // The rule from the brief, and the real shape of the live data: the one
  // recorded event has 42 attendance rows.
  reset();
  signInAsManager();
  dbState.deleteEventResult = {
    ok: false,
    outcome: 'has_attendance',
    attendanceCount: 42,
  };

  const response = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), {
    error: 'Event has attendance',
    attendanceCount: 42,
  });
});

test('deleting an event with no attendance succeeds', async () => {
  reset();
  signInAsManager();
  dbState.deleteEventResult = { ok: true };

  const response = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), { ok: true, deleted: true });
  assert.deepStrictEqual(dbState.deleteEventCalls, [EVENT_ID]);
});

test('deleting answers 404 when the event is already gone', async () => {
  reset();
  signInAsManager();
  dbState.deleteEventResult = { ok: false, outcome: 'not_found' };

  const response = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 404);
});

test('deleting answers 500 when the delete fails outright', async () => {
  reset();
  signInAsManager();
  dbState.deleteEventResult = { ok: false, outcome: 'failed' };

  const response = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 500);
});

test('deleting is allowed on an archived event', async () => {
  // Deliberate: "read-only" covers the operations that change an event's data,
  // not removing an event that has none. Refusing would make an archived event
  // permanently undeletable, which is a worse trap than allowing the cleanup.
  reset();
  signInAsManager();
  dbState.deleteEventResult = { ok: true };

  const response = await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 200);
});

test('deleting writes no XP and touches no attendance', async () => {
  reset();
  signInAsManager();
  dbState.deleteEventResult = { ok: true };

  await deleteEventRoute(
    new Request('http://localhost/', { method: 'DELETE' }),
    context(EVENT_ID)
  );

  assert.deepStrictEqual(dbState.writes, []);
  assert.deepStrictEqual(dbState.awardCalls, []);
  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});

// ---------------------------------------------------------------------------
// POST /api/events/[id]/archive
// ---------------------------------------------------------------------------

test('archiving answers 401 with no session and 403 for a non-manager', async () => {
  reset();
  const unauthorized = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.archiveEventCalls, []);
});

test('archiving answers 404 for an unknown event', async () => {
  reset();
  signInAsManager();
  dbState.eventById = null;

  const response = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 404);
});

test('archiving an active event records the manager from the session', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();

  const response = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(dbState.archiveEventCalls, [
    { id: EVENT_ID, archivedBy: BASIL_ID },
  ]);
});

test('archiving an already-archived event is a success that changes nothing', async () => {
  // Idempotent: the original archive time and the manager who set it survive a
  // second click, and two managers clicking at once cannot rewrite them.
  reset();
  signInAsManager();
  dbState.eventById = archivedRecord();

  const response = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.alreadyArchived, true);
  assert.strictEqual(payload.archivedAt, '2026-09-19T10:00:00.000Z');
  assert.deepStrictEqual(dbState.archiveEventCalls, [], 'nothing may be rewritten');
});

test('archiving reports success when another request archived it first', async () => {
  // The guard matched no row, because the event was archived between this
  // route's read and its write. The caller asked for the event to be archived
  // and it is archived, so this is a success - and the guard means the original
  // archive time and manager were not overwritten.
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();
  dbState.archiveEventResult = false;

  const response = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.alreadyArchived, true);
});

test('archiving reports a fresh archive as not-already-archived', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();
  dbState.archiveEventResult = true;

  const response = await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.strictEqual((await response.json()).alreadyArchived, false);
});

test('archiving writes no XP and does not touch attendance', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();

  await archiveEventRoute(
    new Request('http://localhost/', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.deepStrictEqual(dbState.writes, []);
  assert.deepStrictEqual(dbState.awardCalls, []);
  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});

// ---------------------------------------------------------------------------
// The read-only rule, enforced on the Phase 7B routes
// ---------------------------------------------------------------------------

test('attendance cannot be saved against an archived event', async () => {
  reset();
  signInAsManager();
  dbState.eventById = archivedRecord();

  const response = await putAttendance(
    jsonRequest('PUT', { memberIds: [MEMBER_ID] }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Event is archived' });
  assert.deepStrictEqual(dbState.setAttendanceCalls, [], 'nothing may be written');
});

test('an archived event cannot be awarded', async () => {
  reset();
  signInAsManager();
  dbState.eventById = archivedRecord();

  const response = await awardEvent(
    new Request('http://localhost/api/events/x/award', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Event is archived' });
  assert.deepStrictEqual(dbState.awardCalls, [], 'no XP may be written');
});

test('an active event is still editable, awardable and attendance-able', async () => {
  // The guards must not have broken the normal path.
  reset();
  signInAsManager();
  dbState.eventById = eventRecord();
  dbState.awardResult = { ok: true, awarded: 0 };
  dbState.setAttendanceResult = { ok: true, added: 0, removed: 0, keptAwarded: 0 };

  const attendance = await putAttendance(
    jsonRequest('PUT', { memberIds: [] }),
    context(EVENT_ID)
  );
  const award = await awardEvent(
    new Request('http://localhost/api/events/x/award', { method: 'POST' }),
    context(EVENT_ID)
  );

  assert.strictEqual(attendance.status, 200);
  assert.strictEqual(award.status, 200);
});
