// Phase 8B: event analytics.
//
// Two halves, deliberately in one file because they cover one feature:
//
//   1. the pure aggregation in lib/events/analytics.ts - the totals, the
//      average, the best-attended pick, the monthly trend and the type
//      breakdown. This project has no DOM test environment (Node's type
//      stripping does not transform JSX, so a .tsx component cannot be imported
//      into a test at all), so these functions are where the page's arithmetic
//      lives and where it can actually be asserted.
//
//   2. the route, run for real against in-memory doubles for the Supabase
//      boundary and the session reader.
//
// The arithmetic is the point of this file: an average that quietly divides by
// the wrong number, or a trend that drops a quiet month, is a wrong figure on a
// page nobody would think to double-check.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import {
  formatAverage,
  formatMonthLabel,
  loadAnalytics,
  monthOf,
  summariseAnalytics,
} from '@/lib/events/analytics';
import { GET as getAnalytics } from '@/app/api/manager/analytics/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const BHUMIKA_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

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

function fetchStub(status, body) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** An event, as the API returns it. */
function event(overrides = {}) {
  return {
    id: 'e1',
    title: 'git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-15',
    activityCode: 'membership',
    createdBy: BASIL_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
}

function total(overrides = {}) {
  return { eventId: 'e1', attendanceCount: 42, xpAwarded: 2100, ...overrides };
}

// ---------------------------------------------------------------------------
// monthOf and formatMonthLabel
// ---------------------------------------------------------------------------

test('monthOf takes the month from a stored date', () => {
  // A pure string slice: parsing into a Date would reintroduce the timezone
  // hazard the rest of the project pins against.
  assert.strictEqual(monthOf('2026-09-15'), '2026-09');
  assert.strictEqual(monthOf('2027-01-01'), '2027-01');
});

test('formatMonthLabel renders a month key', () => {
  assert.strictEqual(formatMonthLabel('2026-09'), 'Sep 2026');
  assert.strictEqual(formatMonthLabel('2027-01'), 'Jan 2027');
  assert.strictEqual(formatMonthLabel('2026-12'), 'Dec 2026');
});

test('formatMonthLabel returns an unparseable key unchanged', () => {
  assert.strictEqual(formatMonthLabel('nonsense'), 'nonsense');
  assert.strictEqual(formatMonthLabel('2026-13'), '2026-13');
});

test('formatAverage always shows one decimal place', () => {
  assert.strictEqual(formatAverage(42), '42.0');
  assert.strictEqual(formatAverage(12.25), '12.3');
  assert.strictEqual(formatAverage(0), '0.0');
});

// ---------------------------------------------------------------------------
// summariseAnalytics - the empty club
// ---------------------------------------------------------------------------

test('a club with no events summarises to zeroes, not to NaN', () => {
  // Dividing by zero events is the obvious way to get NaN onto the page.
  const analytics = summariseAnalytics([], []);

  assert.strictEqual(analytics.totalEvents, 0);
  assert.strictEqual(analytics.totalAttendance, 0);
  assert.strictEqual(analytics.averageAttendance, 0);
  assert.strictEqual(analytics.xpThroughAttendance, 0);
  assert.strictEqual(analytics.highestAttended, null);
  assert.deepStrictEqual(analytics.trend, []);
  assert.deepStrictEqual(analytics.breakdown, []);
});

test('the empty club average formats as 0.0', () => {
  assert.strictEqual(
    formatAverage(summariseAnalytics([], []).averageAttendance),
    '0.0'
  );
});

// ---------------------------------------------------------------------------
// summariseAnalytics - the real data shape
// ---------------------------------------------------------------------------

test('the live data shape summarises to the figures the page will show', () => {
  // Mirrors the real database: one archived event, 42 members recorded, 2100 XP
  // awarded through that attendance.
  const analytics = summariseAnalytics(
    [event({ archivedAt: '2026-09-19T10:00:00.000Z', archivedBy: BASIL_ID })],
    [total()]
  );

  assert.strictEqual(analytics.totalEvents, 1);
  assert.strictEqual(analytics.totalAttendance, 42);
  assert.strictEqual(analytics.averageAttendance, 42);
  assert.strictEqual(analytics.xpThroughAttendance, 2100);
  assert.deepStrictEqual(analytics.highestAttended, {
    eventId: 'e1',
    title: 'git workshop',
    attendanceCount: 42,
  });
  assert.deepStrictEqual(analytics.trend, [
    { month: '2026-09', label: 'Sep 2026', attendance: 42 },
  ]);
  assert.deepStrictEqual(analytics.breakdown, [
    {
      eventType: 'workshop',
      label: 'Workshop',
      events: 1,
      attendance: 42,
      xp: 2100,
    },
  ]);
});

test('archived events are counted, not filtered out', () => {
  // Analytics cover the club's whole history. Excluding archived events would
  // quietly shrink every figure.
  const archived = event({ archivedAt: '2026-09-19T10:00:00.000Z', archivedBy: BASIL_ID });
  const active = event({ id: 'e2', title: 'session', eventDate: '2026-10-01' });

  const analytics = summariseAnalytics(
    [archived, active],
    [total({ eventId: 'e1' }), total({ eventId: 'e2', attendanceCount: 10, xpAwarded: 500 })]
  );

  assert.strictEqual(analytics.totalEvents, 2);
  assert.strictEqual(analytics.totalAttendance, 52);
});

// ---------------------------------------------------------------------------
// The average
// ---------------------------------------------------------------------------

test('an event nobody attended still counts in the average', () => {
  // "Average attendance per event" means per event that RAN. An event with no
  // attendance is a real, and telling, zero.
  const analytics = summariseAnalytics(
    [event({ id: 'e1' }), event({ id: 'e2', eventDate: '2026-10-01' })],
    [total({ eventId: 'e1', attendanceCount: 42, xpAwarded: 2100 })]
  );

  assert.strictEqual(analytics.totalEvents, 2);
  assert.strictEqual(analytics.totalAttendance, 42);
  assert.strictEqual(analytics.averageAttendance, 21);
  assert.strictEqual(formatAverage(analytics.averageAttendance), '21.0');
});

test('the average is not rounded before it is returned', () => {
  // The number is returned raw so the arithmetic stays assertable; only the
  // display rounds.
  const analytics = summariseAnalytics(
    [event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })],
    [total({ eventId: 'a', attendanceCount: 10, xpAwarded: 0 })]
  );

  assert.strictEqual(analytics.averageAttendance, 10 / 3);
  assert.strictEqual(formatAverage(analytics.averageAttendance), '3.3');
});

// ---------------------------------------------------------------------------
// The best-attended event
// ---------------------------------------------------------------------------

test('the best-attended event is the one with the most attendance', () => {
  const analytics = summariseAnalytics(
    [event({ id: 'a', title: 'small' }), event({ id: 'b', title: 'big' })],
    [
      total({ eventId: 'a', attendanceCount: 3 }),
      total({ eventId: 'b', attendanceCount: 40 }),
    ]
  );

  assert.deepStrictEqual(analytics.highestAttended, {
    eventId: 'b',
    title: 'big',
    attendanceCount: 40,
  });
});

test('a tie for best-attended goes to the earlier event', () => {
  // Deterministic rather than dependent on the order the rows arrived in.
  const analytics = summariseAnalytics(
    [
      event({ id: 'later', title: 'later', eventDate: '2026-11-01' }),
      event({ id: 'earlier', title: 'earlier', eventDate: '2026-09-01' }),
    ],
    [
      total({ eventId: 'later', attendanceCount: 20 }),
      total({ eventId: 'earlier', attendanceCount: 20 }),
    ]
  );

  assert.strictEqual(analytics.highestAttended.eventId, 'earlier');
});

test('a tie on the same date goes to the lower id', () => {
  const analytics = summariseAnalytics(
    [
      event({ id: 'b', title: 'b', eventDate: '2026-09-01' }),
      event({ id: 'a', title: 'a', eventDate: '2026-09-01' }),
    ],
    [
      total({ eventId: 'a', attendanceCount: 5 }),
      total({ eventId: 'b', attendanceCount: 5 }),
    ]
  );

  assert.strictEqual(analytics.highestAttended.eventId, 'a');
});

test('there is no best-attended event when nobody attended anything', () => {
  const analytics = summariseAnalytics(
    [event({ id: 'a' }), event({ id: 'b' })],
    [total({ eventId: 'a', attendanceCount: 0, xpAwarded: 0 })]
  );

  assert.strictEqual(analytics.highestAttended, null);
});

// ---------------------------------------------------------------------------
// XP through attendance
// ---------------------------------------------------------------------------

test('XP is summed across every event', () => {
  const analytics = summariseAnalytics(
    [event({ id: 'a' }), event({ id: 'b' })],
    [
      total({ eventId: 'a', attendanceCount: 2, xpAwarded: 100 }),
      total({ eventId: 'b', attendanceCount: 3, xpAwarded: 150 }),
    ]
  );

  assert.strictEqual(analytics.xpThroughAttendance, 250);
});

test('attendance that has not been awarded yet contributes zero XP', () => {
  // A real and temporary state: the attendance is recorded, the award has not
  // run. It must not look like an error.
  const analytics = summariseAnalytics(
    [event({ id: 'a' })],
    [total({ eventId: 'a', attendanceCount: 5, xpAwarded: 0 })]
  );

  assert.strictEqual(analytics.xpThroughAttendance, 0);
  assert.strictEqual(analytics.totalAttendance, 5);
});

// ---------------------------------------------------------------------------
// The monthly trend
// ---------------------------------------------------------------------------

test('the trend groups attendance by the month the event was held', () => {
  const analytics = summariseAnalytics(
    [
      event({ id: 'a', eventDate: '2026-09-15' }),
      event({ id: 'b', eventDate: '2026-09-28' }),
      event({ id: 'c', eventDate: '2026-10-02' }),
    ],
    [
      total({ eventId: 'a', attendanceCount: 10 }),
      total({ eventId: 'b', attendanceCount: 15 }),
      total({ eventId: 'c', attendanceCount: 7 }),
    ]
  );

  assert.deepStrictEqual(analytics.trend, [
    { month: '2026-09', label: 'Sep 2026', attendance: 25 },
    { month: '2026-10', label: 'Oct 2026', attendance: 7 },
  ]);
});

test('the trend is oldest first, across a year boundary', () => {
  const analytics = summariseAnalytics(
    [
      event({ id: 'b', eventDate: '2027-01-05' }),
      event({ id: 'a', eventDate: '2026-12-20' }),
    ],
    [
      total({ eventId: 'a', attendanceCount: 1 }),
      total({ eventId: 'b', attendanceCount: 2 }),
    ]
  );

  assert.deepStrictEqual(
    analytics.trend.map((point) => point.month),
    ['2026-12', '2027-01']
  );
});

test('a month whose events drew nobody is kept, as zero', () => {
  // The gap is the information: a month the club ran something and nobody came
  // is not the same as a month it ran nothing.
  const analytics = summariseAnalytics(
    [event({ id: 'a', eventDate: '2026-09-01' }), event({ id: 'b', eventDate: '2026-10-01' })],
    [total({ eventId: 'a', attendanceCount: 8, xpAwarded: 400 })]
  );

  assert.deepStrictEqual(analytics.trend, [
    { month: '2026-09', label: 'Sep 2026', attendance: 8 },
    { month: '2026-10', label: 'Oct 2026', attendance: 0 },
  ]);
});

test('the trend omits months with no events at all', () => {
  const analytics = summariseAnalytics(
    [event({ id: 'a', eventDate: '2026-09-01' }), event({ id: 'b', eventDate: '2027-02-01' })],
    [total({ eventId: 'a', attendanceCount: 1 })]
  );

  assert.deepStrictEqual(
    analytics.trend.map((point) => point.month),
    ['2026-09', '2027-02']
  );
});

// ---------------------------------------------------------------------------
// The type breakdown
// ---------------------------------------------------------------------------

test('the breakdown counts events and attendance per type', () => {
  const analytics = summariseAnalytics(
    [
      event({ id: 'a', eventType: 'workshop' }),
      event({ id: 'b', eventType: 'workshop', eventDate: '2026-10-01' }),
      event({ id: 'c', eventType: 'hackathon', eventDate: '2026-11-01' }),
    ],
    [
      total({ eventId: 'a', attendanceCount: 10, xpAwarded: 500 }),
      total({ eventId: 'b', attendanceCount: 5, xpAwarded: 250 }),
      total({ eventId: 'c', attendanceCount: 20, xpAwarded: 4000 }),
    ]
  );

  assert.deepStrictEqual(analytics.breakdown, [
    { eventType: 'workshop', label: 'Workshop', events: 2, attendance: 15, xp: 750 },
    { eventType: 'hackathon', label: 'Hackathon', events: 1, attendance: 20, xp: 4000 },
  ]);
});

test('the breakdown puts the most-used type first', () => {
  const analytics = summariseAnalytics(
    [
      event({ id: 'a', eventType: 'meeting' }),
      event({ id: 'b', eventType: 'meeting', eventDate: '2026-10-01' }),
      event({ id: 'c', eventType: 'meeting', eventDate: '2026-11-01' }),
      event({ id: 'd', eventType: 'workshop', eventDate: '2026-12-01' }),
    ],
    []
  );

  assert.deepStrictEqual(
    analytics.breakdown.map((row) => row.eventType),
    ['meeting', 'workshop']
  );
});

test('the breakdown omits types with no events', () => {
  // A row of zeroes for every declared type would be noise.
  const analytics = summariseAnalytics([event({ eventType: 'workshop' })], []);

  assert.strictEqual(analytics.breakdown.length, 1);
});

test('a type with events but no attendance still appears, at zero', () => {
  const analytics = summariseAnalytics(
    [event({ id: 'a', eventType: 'hackathon' })],
    []
  );

  assert.deepStrictEqual(analytics.breakdown, [
    { eventType: 'hackathon', label: 'Hackathon', events: 1, attendance: 0, xp: 0 },
  ]);
});

// ---------------------------------------------------------------------------
// Defensive: totals for an event that is not in the list
// ---------------------------------------------------------------------------

test('a totals row for an unknown event is ignored', () => {
  // Cannot happen - attendance has a foreign key to events - but counting it
  // would let totalAttendance exceed what the event list explains, and an
  // average larger than any event is worse than ignoring an impossible row.
  const analytics = summariseAnalytics(
    [event({ id: 'a' })],
    [total({ eventId: 'a', attendanceCount: 5, xpAwarded: 250 }), total({ eventId: 'ghost', attendanceCount: 999, xpAwarded: 999 })]
  );

  assert.strictEqual(analytics.totalAttendance, 5);
  assert.strictEqual(analytics.xpThroughAttendance, 250);
});

test('summariseAnalytics does not mutate what it was given', () => {
  const events = [event({ id: 'a' })];
  const totals = [total({ eventId: 'a' })];
  const before = JSON.stringify({ events, totals });

  summariseAnalytics(events, totals);

  assert.strictEqual(JSON.stringify({ events, totals }), before);
});

// ---------------------------------------------------------------------------
// loadAnalytics
// ---------------------------------------------------------------------------

const PAYLOAD = summariseAnalytics([event()], [total()]);

test('loadAnalytics returns the analytics', async () => {
  const outcome = await loadAnalytics(fetchStub(200, PAYLOAD));

  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.analytics, PAYLOAD);
});

test('loadAnalytics requests the manager analytics url', async () => {
  let url = null;

  await loadAnalytics(async (input) => {
    url = input;
    return new Response(JSON.stringify(PAYLOAD), { status: 200 });
  });

  assert.strictEqual(url, '/api/manager/analytics');
});

test('loadAnalytics separates 401 from 403', async () => {
  const unauthorized = await loadAnalytics(fetchStub(401, {}));
  const forbidden = await loadAnalytics(fetchStub(403, {}));

  assert.strictEqual(unauthorized.kind, 'unauthorized');
  assert.strictEqual(forbidden.kind, 'forbidden');
});

test('loadAnalytics reports a server or network failure as unavailable', async () => {
  const server = await loadAnalytics(fetchStub(500, {}));
  const network = await loadAnalytics(async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(server.kind, 'unavailable');
  assert.strictEqual(network.kind, 'unavailable');
});

test('loadAnalytics never turns a broken body into an all-zero page', async () => {
  // "The club has never run an event" and "the response was broken" must not
  // look the same.
  for (const body of [
    {},
    null,
    { totalEvents: '1' },
    { ...PAYLOAD, trend: null },
    { ...PAYLOAD, breakdown: 'nope' },
    { ...PAYLOAD, averageAttendance: undefined },
  ]) {
    const outcome = await loadAnalytics(fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

// ---------------------------------------------------------------------------
// GET /api/manager/analytics
// ---------------------------------------------------------------------------

test('analytics answers 401 with no session', async () => {
  reset();

  const response = await getAnalytics();

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(await response.json(), { error: 'Unauthorized' });
  assert.strictEqual(dbState.eventListCalls, 0);
  assert.strictEqual(dbState.attendanceTotalsCalls, 0);
});

test('analytics answers 403 for a non-manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await getAnalytics();

  assert.strictEqual(response.status, 403);
  assert.strictEqual(dbState.eventListCalls, 0, 'a non-manager must read nothing');
  assert.strictEqual(dbState.attendanceTotalsCalls, 0);
});

test('analytics answers 200 for each of the two XP managers', async () => {
  for (const manager of [BASIL, BHUMIKA]) {
    reset();
    signInAsManager(manager);
    dbState.eventRows = [];
    dbState.attendanceTotals = [];

    const response = await getAnalytics();

    assert.strictEqual(response.status, 200, `${manager.email} must be allowed`);
  }
});

test('analytics returns the computed figures', async () => {
  reset();
  signInAsManager();
  dbState.eventRows = [event({ id: 'e1' })];
  dbState.attendanceTotals = [total({ eventId: 'e1' })];

  const response = await getAnalytics();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.totalEvents, 1);
  assert.strictEqual(payload.totalAttendance, 42);
  assert.strictEqual(payload.averageAttendance, 42);
  assert.strictEqual(payload.xpThroughAttendance, 2100);
  assert.strictEqual(payload.highestAttended.title, 'git workshop');
});

test('an empty club is a valid analytics page, not an error', async () => {
  reset();
  signInAsManager();
  dbState.eventRows = [];
  dbState.attendanceTotals = [];

  const response = await getAnalytics();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.totalEvents, 0);
  assert.strictEqual(payload.averageAttendance, 0);
  assert.strictEqual(payload.highestAttended, null);
});

test('analytics answers 500 when the event read fails', async () => {
  reset();
  signInAsManager();
  dbState.eventsFail = true;

  assert.strictEqual((await getAnalytics()).status, 500);
});

test('analytics answers 500 when the totals read fails', async () => {
  reset();
  signInAsManager();
  dbState.eventRows = [];
  dbState.attendanceTotalsFail = true;

  const response = await getAnalytics();

  assert.strictEqual(response.status, 500);
  // An all-zero page would claim the club has never run an event. That is worse
  // than an error.
  assert.deepStrictEqual(await response.json(), { error: 'Internal server error' });
});

test('analytics reads both sources exactly once', async () => {
  reset();
  signInAsManager();
  dbState.eventRows = [];
  dbState.attendanceTotals = [];

  await getAnalytics();

  assert.strictEqual(dbState.eventListCalls, 1);
  assert.strictEqual(dbState.attendanceTotalsCalls, 1);
});

test('analytics is read-only: it writes nothing at all', async () => {
  // "Keep analytics read-only" is a requirement, so it is asserted rather than
  // assumed.
  reset();
  signInAsManager();
  dbState.eventRows = [event({ id: 'e1' })];
  dbState.attendanceTotals = [total({ eventId: 'e1' })];

  await getAnalytics();

  assert.deepStrictEqual(dbState.writes, [], 'no XP may be written');
  assert.deepStrictEqual(dbState.eventWrites, [], 'no event may be created');
  assert.deepStrictEqual(dbState.updateEventCalls, [], 'no event may be edited');
  assert.deepStrictEqual(dbState.archiveEventCalls, []);
  assert.deepStrictEqual(dbState.deleteEventCalls, []);
  assert.deepStrictEqual(dbState.setAttendanceCalls, [], 'no attendance may be saved');
  assert.deepStrictEqual(dbState.awardCalls, [], 'no award may be run');
});
