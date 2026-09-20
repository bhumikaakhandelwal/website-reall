// Phase 7B: attendance and the bulk award.
//
// Two halves, deliberately in one file because they cover one feature:
//
//   1. the pure logic in lib/events/attendance.ts - the member search, the
//      checkbox and awarded-state semantics, the counts, the sentences the page
//      shows, and the three client calls. This project has no DOM test
//      environment (Node's type stripping does not transform JSX, so a .tsx
//      component cannot be imported into a test at all), so these functions are
//      where the page's decisions live and where they can actually be asserted.
//
//   2. the two routes, run for real against in-memory doubles for the Supabase
//      boundary and the session reader. The real authorization, the real
//      manager allowlist, the real request validation and the real response
//      mapping all execute; nothing reaches the network.
//
// The single most important assertion in this file is that the XP amount is
// resolved from the event's Handbook activity code and NEVER from the request.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import {
  activityLabelFor,
  attendanceStats,
  awardAttendance,
  describeAward,
  describeSave,
  filterMembers,
  formatXpAmount,
  loadAttendance,
  saveAttendance,
  splitAttendance,
} from '@/lib/events/attendance';
import { XP_ACTIVITIES } from '@/lib/xp/activities';
import {
  GET as getAttendance,
  PUT as putAttendance,
} from '@/app/api/events/[id]/attendance/route';
import { POST as awardEvent } from '@/app/api/events/[id]/award/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const BHUMIKA_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const ATTENDANCE_ID = '55555555-5555-4555-8555-555555555555';

const BASIL = {
  id: BASIL_ID,
  email: '2414011@dbcegoa.ac.in',
  display_name: 'Basil Shaikh Mohammad',
  membership_status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const BHUMIKA = {
  ...BASIL,
  id: BHUMIKA_ID,
  email: '2414012@dbcegoa.ac.in',
  display_name: 'Bhumika Khandelwal',
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

/** The route context Next passes to a dynamic route. */
function context(id) {
  return { params: Promise.resolve({ id }) };
}

function putRequest(body) {
  return new Request('http://localhost/api/events/x/attendance', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postRequest(body) {
  return new Request('http://localhost/api/events/x/award', {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function eventRow(overrides = {}) {
  return {
    id: EVENT_ID,
    title: 'git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-10',
    activityCode: 'membership',
    createdBy: BASIL_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    // Phase 8A: the event reads now carry the archive state, and the routes
    // treat a non-null archivedAt as read-only. Active is the default here.
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

function memberRow(overrides = {}) {
  return {
    memberId: MEMBER_ID,
    email: 'ordinary-member@dbcegoa.ac.in',
    displayName: 'Ordinary Member',
    membershipStatus: 'active',
    joinedAt: '2026-09-01T00:00:00Z',
    totalXp: 0,
    ...overrides,
  };
}

function attendanceRow(overrides = {}) {
  return {
    id: ATTENDANCE_ID,
    eventId: EVENT_ID,
    memberId: MEMBER_ID,
    recordedAt: '2026-09-10T10:00:00.000Z',
    xpLedgerId: null,
    ...overrides,
  };
}

/** A fetch that always answers with the given status and body. */
function fetchStub(status, body) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

// ---------------------------------------------------------------------------
// filterMembers
// ---------------------------------------------------------------------------

const ROSTER = [
  { memberId: 'a', displayName: 'Aisha Fernandes', email: 'aisha@dbcegoa.ac.in' },
  { memberId: 'b', displayName: 'Basil Shaikh Mohammad', email: '2414011@dbcegoa.ac.in' },
  { memberId: 'c', displayName: "Christopher Charles D'Souza", email: '2514022@dbcegoa.ac.in' },
];

test('filterMembers returns the whole roster for a blank query', () => {
  assert.deepStrictEqual(filterMembers(ROSTER, ''), ROSTER);
  assert.deepStrictEqual(filterMembers(ROSTER, '   '), ROSTER);
});

test('filterMembers matches on name, case-insensitively', () => {
  assert.deepStrictEqual(
    filterMembers(ROSTER, 'aisha').map((m) => m.memberId),
    ['a']
  );
  assert.deepStrictEqual(
    filterMembers(ROSTER, 'BASIL').map((m) => m.memberId),
    ['b']
  );
});

test('filterMembers matches on email', () => {
  assert.deepStrictEqual(
    filterMembers(ROSTER, '2514022').map((m) => m.memberId),
    ['c']
  );
});

test('filterMembers trims the query', () => {
  assert.deepStrictEqual(
    filterMembers(ROSTER, '  aisha  ').map((m) => m.memberId),
    ['a']
  );
});

test('filterMembers matches a partial name across several members', () => {
  // "a" appears in Aisha, Basil Shaikh and Charles.
  assert.strictEqual(filterMembers(ROSTER, 'a').length, 3);
});

test('filterMembers returns nothing when nothing matches', () => {
  assert.deepStrictEqual(filterMembers(ROSTER, 'zzzz'), []);
});

test('filterMembers does not mutate the roster it was given', () => {
  const before = JSON.parse(JSON.stringify(ROSTER));

  filterMembers(ROSTER, 'aisha');

  assert.deepStrictEqual(ROSTER, before);
});

test('filterMembers returns a copy, so callers cannot corrupt the roster', () => {
  const result = filterMembers(ROSTER, '');

  result.pop();

  assert.strictEqual(ROSTER.length, 3);
});

// ---------------------------------------------------------------------------
// splitAttendance and attendanceStats
// ---------------------------------------------------------------------------

test('splitAttendance separates the present from the awarded', () => {
  const { present, awarded } = splitAttendance([
    { memberId: 'a', xpLedgerId: null },
    { memberId: 'b', xpLedgerId: 7 },
  ]);

  assert.deepStrictEqual([...present].sort(), ['a', 'b']);
  assert.deepStrictEqual([...awarded], ['b']);
});

test('splitAttendance treats a null ledger id as unawarded', () => {
  const { awarded } = splitAttendance([{ memberId: 'a', xpLedgerId: null }]);

  assert.strictEqual(awarded.size, 0);
});

test('splitAttendance of nothing is two empty sets', () => {
  const { present, awarded } = splitAttendance([]);

  assert.strictEqual(present.size, 0);
  assert.strictEqual(awarded.size, 0);
});

test('attendanceStats counts present, awarded and awaiting', () => {
  const stats = attendanceStats([
    { memberId: 'a', xpLedgerId: null },
    { memberId: 'b', xpLedgerId: 7 },
    { memberId: 'c', xpLedgerId: 8 },
  ]);

  assert.deepStrictEqual(stats, { present: 3, awarded: 2, awaiting: 1 });
});

test('attendanceStats of nothing is all zeroes', () => {
  assert.deepStrictEqual(attendanceStats([]), {
    present: 0,
    awarded: 0,
    awaiting: 0,
  });
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

test('formatXpAmount shows a signed amount', () => {
  assert.strictEqual(formatXpAmount(50), '+50 XP');
  assert.strictEqual(formatXpAmount(250), '+250 XP');
});

test('activityLabelFor resolves a code and falls back to the code', () => {
  assert.strictEqual(activityLabelFor('membership'), 'Membership');
  // A code that has left the Handbook must still render as something.
  assert.strictEqual(activityLabelFor('retired-activity'), 'retired-activity');
});

test('describeSave reports what changed', () => {
  assert.match(describeSave({ added: 3, removed: 0, keptAwarded: 0 }), /3 added/);
  assert.match(describeSave({ added: 0, removed: 2, keptAwarded: 0 }), /2 removed/);
  assert.match(
    describeSave({ added: 1, removed: 1, keptAwarded: 0 }),
    /1 added, 1 removed/
  );
});

test('describeSave says so when nothing changed', () => {
  assert.match(
    describeSave({ added: 0, removed: 0, keptAwarded: 0 }),
    /nothing changed/i
  );
});

test('describeSave explains a kept awarded member', () => {
  // The manager unchecked someone who had already been awarded. Without this
  // sentence the checkbox appears to have silently reverted.
  const one = describeSave({ added: 0, removed: 0, keptAwarded: 1 });

  assert.match(one, /already been awarded/);
  assert.match(one, /was left on the event/);

  const many = describeSave({ added: 0, removed: 0, keptAwarded: 2 });

  assert.match(many, /were left on the event/);
});

test('describeAward reports a count and the amount', () => {
  assert.strictEqual(
    describeAward(1, 50),
    'Awarded 1 member +50 XP each.'
  );
  assert.strictEqual(
    describeAward(3, 100),
    'Awarded 3 members +100 XP each.'
  );
});

test('describeAward treats zero as success, not failure', () => {
  // Zero is what the idempotency guard produces on a second click. Saying so is
  // the difference between "nothing to do" and "something went wrong".
  const message = describeAward(0, 50);

  assert.match(message, /already been awarded/);
  assert.match(message, /nothing changed/i);
  assert.doesNotMatch(message, /fail|error/i);
});

// ---------------------------------------------------------------------------
// loadAttendance
// ---------------------------------------------------------------------------

const PAYLOAD = {
  event: eventRow(),
  members: [{ memberId: MEMBER_ID, displayName: 'Ordinary Member', email: 'o@x.com' }],
  attendance: [{ memberId: MEMBER_ID, xpLedgerId: null }],
  xpAmount: 50,
  activityLabel: 'Membership',
  awardable: true,
};

test('loadAttendance returns the payload', async () => {
  const outcome = await loadAttendance(EVENT_ID, fetchStub(200, PAYLOAD));

  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.payload, PAYLOAD);
});

test('loadAttendance requests the event attendance url', async () => {
  let url = null;

  await loadAttendance(EVENT_ID, async (input) => {
    url = input;
    return new Response(JSON.stringify(PAYLOAD), { status: 200 });
  });

  assert.strictEqual(url, `/api/events/${EVENT_ID}/attendance`);
});

test('loadAttendance separates the failures the page acts on differently', async () => {
  const cases = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [500, 'unavailable'],
  ];

  for (const [status, kind] of cases) {
    const outcome = await loadAttendance(EVENT_ID, fetchStub(status, {}));

    assert.strictEqual(outcome.ok, false, String(status));
    assert.strictEqual(outcome.kind, kind, String(status));
  }
});

test('loadAttendance reports a network failure as unavailable', async () => {
  const outcome = await loadAttendance(EVENT_ID, async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(outcome.kind, 'unavailable');
});

test('loadAttendance never turns a malformed payload into an empty event', async () => {
  // "Nobody recorded yet" and "the response was broken" must not look the same.
  for (const body of [
    {},
    { event: eventRow() },
    { ...PAYLOAD, members: null },
    { ...PAYLOAD, attendance: 'nope' },
    { ...PAYLOAD, xpAmount: '50' },
    { ...PAYLOAD, awardable: 'yes' },
    null,
  ]) {
    const outcome = await loadAttendance(EVENT_ID, fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

// ---------------------------------------------------------------------------
// saveAttendance
// ---------------------------------------------------------------------------

test('saveAttendance PUTs only the member ids', async () => {
  let captured = null;

  const outcome = await saveAttendance(EVENT_ID, ['a', 'b'], async (url, init) => {
    captured = { url, method: init.method, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ added: 2, removed: 0, keptAwarded: 0 }), {
      status: 200,
    });
  });

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(captured.method, 'PUT');
  assert.strictEqual(captured.url, `/api/events/${EVENT_ID}/attendance`);

  // Exactly one key, and no XP anywhere: attendance carries no amount.
  assert.deepStrictEqual(Object.keys(captured.body), ['memberIds']);
  assert.deepStrictEqual(captured.body.memberIds, ['a', 'b']);
});

test('saveAttendance reports the counts and a sentence', async () => {
  const outcome = await saveAttendance(
    EVENT_ID,
    ['a'],
    fetchStub(200, { added: 3, removed: 1, keptAwarded: 2 })
  );

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.added, 3);
  assert.strictEqual(outcome.removed, 1);
  assert.strictEqual(outcome.keptAwarded, 2);
  assert.match(outcome.message, /3 added, 1 removed/);
  assert.match(outcome.message, /already been awarded/);
});

test('saveAttendance reports a broken body as unavailable', async () => {
  for (const body of [{}, { added: '3' }, { added: 1 }, null]) {
    const outcome = await saveAttendance(EVENT_ID, [], fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

test('saveAttendance maps the failures', async () => {
  for (const [status, kind] of [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [400, 'rejected'],
    [500, 'unavailable'],
  ]) {
    const outcome = await saveAttendance(EVENT_ID, [], fetchStub(status, {}));

    assert.strictEqual(outcome.kind, kind, String(status));
  }
});

test('saveAttendance reports a network failure as unavailable', async () => {
  const outcome = await saveAttendance(EVENT_ID, [], async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(outcome.kind, 'unavailable');
});

// ---------------------------------------------------------------------------
// awardAttendance
// ---------------------------------------------------------------------------

test('awardAttendance POSTs with no body at all', async () => {
  // The strongest statement of "no custom XP amounts": the request carries
  // nothing for a client to get wrong or to forge.
  let captured = null;

  await awardAttendance(EVENT_ID, async (url, init) => {
    captured = { url, method: init.method, body: init.body };
    return new Response(JSON.stringify({ ok: true, awarded: 2, xpAmount: 50 }), {
      status: 200,
    });
  });

  assert.strictEqual(captured.method, 'POST');
  assert.strictEqual(captured.url, `/api/events/${EVENT_ID}/award`);
  assert.strictEqual(captured.body, undefined);
});

test('awardAttendance reports the awarded count and amount', async () => {
  const outcome = await awardAttendance(
    EVENT_ID,
    fetchStub(200, { ok: true, awarded: 3, xpAmount: 100 })
  );

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.awarded, 3);
  assert.strictEqual(outcome.xpAmount, 100);
  assert.match(outcome.message, /3 members/);
});

test('awardAttendance treats an awarded count of zero as success', async () => {
  // This is what a second click returns. It must not be reported as a failure.
  const outcome = await awardAttendance(
    EVENT_ID,
    fetchStub(200, { ok: true, awarded: 0, xpAmount: 50 })
  );

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.awarded, 0);
  assert.match(outcome.message, /already been awarded/);
});

test('awardAttendance reports a broken body as unavailable', async () => {
  for (const body of [{}, { awarded: 2 }, { awarded: '2', xpAmount: 50 }, null]) {
    const outcome = await awardAttendance(EVENT_ID, fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

test('awardAttendance explains an activity that left the Handbook', async () => {
  const outcome = await awardAttendance(
    EVENT_ID,
    fetchStub(400, { error: 'Unknown activity code' })
  );

  assert.strictEqual(outcome.kind, 'rejected');
  assert.match(outcome.message, /no longer in the Handbook/);
});

// ---------------------------------------------------------------------------
// GET /api/events/[id]/attendance
// ---------------------------------------------------------------------------

test('the attendance read answers 401 with no session', async () => {
  reset();

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));

  assert.strictEqual(response.status, 401);
  assert.strictEqual(dbState.attendanceReads.length, 0);
});

test('the attendance read answers 403 for a non-manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));

  assert.strictEqual(response.status, 403);
  assert.strictEqual(dbState.attendanceReads.length, 0);
});

test('the attendance read answers 200 for each of the two XP managers', async () => {
  for (const manager of [BASIL, BHUMIKA]) {
    reset();
    signInAsManager(manager);
    dbState.eventById = eventRow();
    dbState.directoryRows = [];

    const response = await getAttendance(
      new Request('http://localhost/'),
      context(EVENT_ID)
    );

    assert.strictEqual(response.status, 200, `${manager.email} must be allowed`);
  }
});

test('the attendance read answers 404 for an id that is not a uuid', async () => {
  // A malformed id must not reach the database: comparing it against a uuid
  // column raises, which would surface as a 500 for what is just an unknown URL.
  reset();
  signInAsManager();

  const response = await getAttendance(
    new Request('http://localhost/'),
    context('not-a-uuid')
  );

  assert.strictEqual(response.status, 404);
  assert.strictEqual(dbState.eventByIdLookups.length, 0);
});

test('the attendance read answers 404 for an event that does not exist', async () => {
  reset();
  signInAsManager();
  dbState.eventById = null;

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));

  assert.strictEqual(response.status, 404);
});

test('the attendance read returns the event, roster, attendance and amount', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.directoryRows = [memberRow()];
  dbState.attendanceRows = [attendanceRow()];

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.event, eventRow());
  assert.deepStrictEqual(payload.members, [
    {
      memberId: MEMBER_ID,
      displayName: 'Ordinary Member',
      email: 'ordinary-member@dbcegoa.ac.in',
    },
  ]);
  assert.deepStrictEqual(payload.attendance, [
    { memberId: MEMBER_ID, xpLedgerId: null },
  ]);
  assert.strictEqual(payload.xpAmount, 50);
  assert.strictEqual(payload.activityLabel, 'Membership');
  assert.strictEqual(payload.awardable, true);
});

test('the attendance read strips the roster down to what the page needs', async () => {
  // The directory carries XP totals and membership status; the attendance page
  // shows a name and an email and nothing else.
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.directoryRows = [memberRow()];

  const payload = await (
    await getAttendance(new Request('http://localhost/'), context(EVENT_ID))
  ).json();

  assert.deepStrictEqual(Object.keys(payload.members[0]).sort(), [
    'displayName',
    'email',
    'memberId',
  ]);
});

test('the attendance read resolves the amount from the Handbook, per activity', async () => {
  for (const activity of XP_ACTIVITIES) {
    reset();
    signInAsManager();
    dbState.eventById = eventRow({ activityCode: activity.code });
    dbState.directoryRows = [];

    const payload = await (
      await getAttendance(new Request('http://localhost/'), context(EVENT_ID))
    ).json();

    assert.strictEqual(payload.xpAmount, activity.xp, activity.code);
    assert.strictEqual(payload.activityLabel, activity.label, activity.code);
    assert.strictEqual(payload.awardable, true, activity.code);
  }
});

test('an event whose activity left the Handbook is readable but not awardable', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow({ activityCode: 'retired-activity' });
  dbState.directoryRows = [];

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));
  const payload = await response.json();

  // Still a 200: attendance can be taken. It just cannot pay out.
  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.awardable, false);
  assert.strictEqual(payload.xpAmount, 0);
  assert.strictEqual(payload.activityLabel, 'retired-activity');
});

test('the attendance read answers 500 when a read fails', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.directoryRows = [];
  dbState.attendanceFails = true;

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));

  assert.strictEqual(response.status, 500);
});

test('an event with nobody recorded is a valid page, not an error', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.directoryRows = [memberRow()];
  dbState.attendanceRows = [];

  const response = await getAttendance(new Request('http://localhost/'), context(EVENT_ID));

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual((await response.json()).attendance, []);
});

// ---------------------------------------------------------------------------
// PUT /api/events/[id]/attendance
// ---------------------------------------------------------------------------

test('saving attendance answers 401 and 403 like every manager endpoint', async () => {
  reset();
  const unauthorized = await putAttendance(putRequest({ memberIds: [] }), context(EVENT_ID));

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await putAttendance(putRequest({ memberIds: [] }), context(EVENT_ID));

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});

test('saving attendance passes the checked member ids through', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.setAttendanceResult = { ok: true, added: 2, removed: 0, keptAwarded: 0 };

  const response = await putAttendance(
    putRequest({ memberIds: [BASIL_ID, BHUMIKA_ID] }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), {
    added: 2,
    removed: 0,
    keptAwarded: 0,
  });
  assert.deepStrictEqual(dbState.setAttendanceCalls, [
    { eventId: EVENT_ID, memberIds: [BASIL_ID, BHUMIKA_ID] },
  ]);
});

test('saving an empty set is allowed and means nobody was present', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();

  const response = await putAttendance(putRequest({ memberIds: [] }), context(EVENT_ID));

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(dbState.setAttendanceCalls[0].memberIds, []);
});

test('saving attendance rejects an invalid body before anything is written', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();

  const invalid = [
    {},
    { memberIds: null },
    { memberIds: 'nope' },
    { memberIds: ['not-a-uuid'] },
    { memberIds: [42] },
    { memberIds: [], extra: true },
  ];

  for (const body of invalid) {
    const response = await putAttendance(putRequest(body), context(EVENT_ID));

    assert.strictEqual(response.status, 400, JSON.stringify(body));
  }

  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});

test('saving attendance answers 404 for an unknown event', async () => {
  reset();
  signInAsManager();
  dbState.eventById = null;

  const response = await putAttendance(putRequest({ memberIds: [] }), context(EVENT_ID));

  assert.strictEqual(response.status, 404);
  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});

test('saving attendance answers 500 when the write fails', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.setAttendanceResult = { ok: false };

  const response = await putAttendance(putRequest({ memberIds: [] }), context(EVENT_ID));

  assert.strictEqual(response.status, 500);
});

test('saving attendance writes no XP', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();

  await putAttendance(putRequest({ memberIds: [MEMBER_ID] }), context(EVENT_ID));

  assert.deepStrictEqual(dbState.awardCalls, []);
  assert.deepStrictEqual(dbState.writes, []);
});

// ---------------------------------------------------------------------------
// POST /api/events/[id]/award
// ---------------------------------------------------------------------------

test('awarding answers 401 and 403 like every manager endpoint', async () => {
  reset();
  const unauthorized = await awardEvent(postRequest(), context(EVENT_ID));

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await awardEvent(postRequest(), context(EVENT_ID));

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.awardCalls, []);
});

test('awarding answers 404 for an unknown event', async () => {
  reset();
  signInAsManager();
  dbState.eventById = null;

  const response = await awardEvent(postRequest(), context(EVENT_ID));

  assert.strictEqual(response.status, 404);
  assert.deepStrictEqual(dbState.awardCalls, []);
});

test('awarding resolves the amount from the event, never from the request', async () => {
  // The single most important assertion in this file. The manager's action
  // carries no number, and a number smuggled into the body must not be used.
  reset();
  signInAsManager();
  dbState.eventById = eventRow({ activityCode: 'membership' });
  dbState.awardResult = { ok: true, awarded: 3 };

  const response = await awardEvent(
    postRequest({ xpAmount: 9999, xp: 9999, amount: 9999 }),
    context(EVENT_ID)
  );
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(dbState.awardCalls.length, 1);
  assert.strictEqual(dbState.awardCalls[0].xpAmount, 50);
  assert.strictEqual(payload.xpAmount, 50);
});

test('awarding uses the Handbook amount for whichever activity the event names', async () => {
  for (const activity of XP_ACTIVITIES) {
    reset();
    signInAsManager();
    dbState.eventById = eventRow({ activityCode: activity.code });
    dbState.awardResult = { ok: true, awarded: 1 };

    await awardEvent(postRequest(), context(EVENT_ID));

    assert.strictEqual(dbState.awardCalls[0].xpAmount, activity.xp, activity.code);
  }
});

test('awarding reports the count and the amount', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow({ activityCode: 'internal-coding-contest' });
  dbState.awardResult = { ok: true, awarded: 4 };

  const response = await awardEvent(postRequest(), context(EVENT_ID));
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.awarded, 4);
  assert.strictEqual(payload.xpAmount, 100);
  assert.strictEqual(payload.activityLabel, 'Internal coding contest');
  assert.strictEqual(payload.ok, true);
});

test('awarding twice reports zero the second time, and is still a 200', async () => {
  // The idempotency guard, seen from the route: everything was already awarded,
  // so the second run changes nothing and says so. Zero is not an error.
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.awardResult = { ok: true, awarded: 2 };

  const first = await awardEvent(postRequest(), context(EVENT_ID));

  assert.strictEqual((await first.json()).awarded, 2);

  dbState.awardResult = { ok: true, awarded: 0 };

  const second = await awardEvent(postRequest(), context(EVENT_ID));
  const payload = await second.json();

  assert.strictEqual(second.status, 200);
  assert.strictEqual(payload.awarded, 0);
});

test('awarding refuses an event whose activity left the Handbook', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow({ activityCode: 'retired-activity' });

  const response = await awardEvent(postRequest(), context(EVENT_ID));

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(await response.json(), { error: 'Unknown activity code' });
  // Nothing may be written when there is no amount to write.
  assert.deepStrictEqual(dbState.awardCalls, []);
});

test('awarding answers 500 when the award fails', async () => {
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.awardResult = { ok: false };

  const response = await awardEvent(postRequest(), context(EVENT_ID));

  assert.strictEqual(response.status, 500);
});

test('awarding writes no attendance of its own', async () => {
  // Awarding pays the people already recorded; it must not add or remove
  // attendance rows.
  reset();
  signInAsManager();
  dbState.eventById = eventRow();
  dbState.awardResult = { ok: true, awarded: 1 };

  await awardEvent(postRequest(), context(EVENT_ID));

  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});
