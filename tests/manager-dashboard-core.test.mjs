// Phase 5C: the manager dashboard.
//
// Two halves, deliberately in one file because they cover one feature:
//
//   1. the pure derivations in lib/manager/dashboard.ts - the counts, the month
//      label, the signed XP labels and the timestamp formatting. This project
//      has no DOM test environment, so these functions are where the dashboard's
//      decisions live and where they can actually be asserted on.
//
//   2. the route, GET /api/manager/dashboard, run for real against in-memory
//      doubles for the Supabase boundary and the session reader
//      (tests/doubles/, wired up by tests/helpers/hooks.mjs). The real
//      authorization, the real manager allowlist and the real response mapping
//      all execute; nothing reaches the network.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import {
  RECENT_ENTRY_LIMIT,
  entryReason,
  formatLedgerTimestamp,
  formatMonthLabel,
  formatSignedXp,
  summariseDashboard,
} from '@/lib/manager/dashboard';
import { GET as getDashboard } from '@/app/api/manager/dashboard/route';

// Synthetic identities only. The two manager addresses are the ones the
// allowlist itself names (lib/xp/managers.ts); everyone else here is invented,
// so no real roster entry is used as a test fixture.
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

/** A directory row, as GET /api/members would serve it. */
function member(overrides = {}) {
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

/** A ledger row, as lib/db/queries.ts maps it out of the database. */
function ledgerEntry(overrides = {}) {
  return {
    entryId: 1,
    memberId: MEMBER_ID,
    displayName: 'Ordinary Member',
    xpAmount: 50,
    activityCode: 'github-project',
    reason: 'GitHub project',
    createdAt: '2026-09-17T22:13:22.202146+00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Timezone independence
//
// The dashboard's two formatted values are derived from UTC instants, and both
// must read the same wherever the manager is sitting. This is checked in child
// processes with different TZ values, because a single process cannot change
// its own timezone - and because the failure mode is invisible on a machine
// whose clock happens to be east of UTC.
//
// The pin is real: without `timeZone: 'UTC'`, America/New_York renders the
// month as "August 2026" and the timestamp as 18:13, and Pacific/Kiritimati
// renders the timestamp a day late. That is what these assertions catch.
// ---------------------------------------------------------------------------

const TZ_PROBE = `
import { formatMonthLabel, formatLedgerTimestamp } from './lib/manager/dashboard.ts';

console.log(JSON.stringify({
  month: formatMonthLabel({ start: new Date(Date.UTC(2026, 8, 1)) }),
  timestamp: formatLedgerTimestamp('2026-09-17T22:13:22.202146+00:00'),
}));
`;

test('the month label and timestamp do not move with the visitor timezone', () => {
  // West of UTC (would render the previous month and an earlier hour), far east
  // (would render the next day), UTC itself, and the machine's own zone.
  const zones = ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Kolkata'];

  for (const TZ of zones) {
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', TZ_PROBE],
      { env: { ...process.env, TZ }, encoding: 'utf8' }
    );

    assert.deepStrictEqual(
      JSON.parse(output),
      { month: 'September 2026', timestamp: 'Sep 17, 2026, 22:13' },
      `formatting must be UTC-pinned, but TZ=${TZ} produced ${output.trim()}`
    );
  }
});

// ---------------------------------------------------------------------------
// formatMonthLabel
// ---------------------------------------------------------------------------

test('formatMonthLabel names the UTC calendar month', () => {
  const period = { start: new Date(Date.UTC(2026, 8, 1)) };

  assert.strictEqual(formatMonthLabel(period), 'September 2026');
});

test('formatMonthLabel handles the year boundary in both directions', () => {
  assert.strictEqual(
    formatMonthLabel({ start: new Date(Date.UTC(2026, 11, 1)) }),
    'December 2026'
  );
  assert.strictEqual(
    formatMonthLabel({ start: new Date(Date.UTC(2027, 0, 1)) }),
    'January 2027'
  );
});

test('formatMonthLabel works from a period produced by utcMonthPeriod', async () => {
  // The real source of the period, so the two cannot disagree about which month
  // a given instant falls in.
  const { utcMonthPeriod } = await import('@/lib/xp/leaderboards');

  assert.strictEqual(
    formatMonthLabel(utcMonthPeriod(new Date('2026-09-18T02:46:28Z'))),
    'September 2026'
  );
  // 23:30 UTC on the last day of the month is still that month.
  assert.strictEqual(
    formatMonthLabel(utcMonthPeriod(new Date('2026-09-30T23:30:00Z'))),
    'September 2026'
  );
});

// ---------------------------------------------------------------------------
// formatSignedXp
// ---------------------------------------------------------------------------

test('formatSignedXp always shows the sign of a non-zero amount', () => {
  assert.strictEqual(formatSignedXp(50), '+50');
  assert.strictEqual(formatSignedXp(150), '+150');
  assert.strictEqual(formatSignedXp(-300), '-300');
  assert.strictEqual(formatSignedXp(-10), '-10');
});

test('formatSignedXp groups thousands deterministically', () => {
  // Pinned to en-US, so the separator cannot change with the host locale.
  assert.strictEqual(formatSignedXp(1200), '+1,200');
  assert.strictEqual(formatSignedXp(-1500), '-1,500');
});

test('formatSignedXp renders zero unsigned', () => {
  // The ledger column forbids zero, but the function is exported and generic.
  assert.strictEqual(formatSignedXp(0), '0');
});

// ---------------------------------------------------------------------------
// formatLedgerTimestamp
// ---------------------------------------------------------------------------

test('formatLedgerTimestamp renders the UTC instant', () => {
  assert.strictEqual(
    formatLedgerTimestamp('2026-09-17T22:13:22.202146+00:00'),
    'Sep 17, 2026, 22:13'
  );
});

test('formatLedgerTimestamp renders midnight as 00:00, not 24:00', () => {
  // A known ICU quirk with hour12: false; the ledger's first entry of a month
  // would otherwise read as the end of the previous day.
  assert.strictEqual(
    formatLedgerTimestamp('2026-09-01T00:00:00.000Z'),
    'Sep 01, 2026, 00:00'
  );
});

test('formatLedgerTimestamp returns an unparseable value unchanged', () => {
  // A guard, not a code path: the row schema rejects such a value first. An
  // "Invalid Date" on the dashboard would be worse than showing the raw string.
  assert.strictEqual(formatLedgerTimestamp('not-a-date'), 'not-a-date');
});

// ---------------------------------------------------------------------------
// entryReason
// ---------------------------------------------------------------------------

test('entryReason trims the stored reason', () => {
  assert.strictEqual(
    entryReason({ reason: '  GitHub project  ', activityCode: 'github-project' }),
    'GitHub project'
  );
});

test('entryReason states a missing reason plainly', () => {
  // Null is a real case: the column is nullable and a pre-Phase-3 row has no
  // activity code to fall back to either.
  assert.strictEqual(
    entryReason({ reason: null, activityCode: null }),
    'No reason recorded'
  );
});

test('entryReason does not substitute the activity code for a reason', () => {
  // The activity code is a different field, and showing it as the answer to
  // "why" would be misleading. Whitespace is not a reason either.
  assert.strictEqual(
    entryReason({ reason: '   ', activityCode: 'github-project' }),
    'No reason recorded'
  );
});

// ---------------------------------------------------------------------------
// summariseDashboard
// ---------------------------------------------------------------------------

const SEPTEMBER = { start: new Date(Date.UTC(2026, 8, 1)), end: new Date(Date.UTC(2026, 9, 1)) };

test('summariseDashboard counts the whole roster and the active part of it', () => {
  const summary = summariseDashboard({
    members: [
      member({ memberId: BASIL_ID, membershipStatus: 'active' }),
      member({ memberId: BHUMIKA_ID, membershipStatus: 'active' }),
      member({ memberId: MEMBER_ID, membershipStatus: 'pending' }),
    ],
    monthXp: 250,
    entries: [],
    period: SEPTEMBER,
  });

  assert.strictEqual(summary.cards.totalMembers, 3);
  assert.strictEqual(summary.cards.activeMembers, 2);
});

test('summariseDashboard counts an inactive member in the total but not in the active count', () => {
  const summary = summariseDashboard({
    members: [
      member({ membershipStatus: 'active' }),
      member({ memberId: BHUMIKA_ID, membershipStatus: 'inactive' }),
    ],
    monthXp: 0,
    entries: [],
    period: SEPTEMBER,
  });

  assert.strictEqual(summary.cards.totalMembers, 2);
  assert.strictEqual(summary.cards.activeMembers, 1);
});

test('summariseDashboard reports an empty roster as two zeroes', () => {
  const summary = summariseDashboard({
    members: [],
    monthXp: 0,
    entries: [],
    period: SEPTEMBER,
  });

  assert.strictEqual(summary.cards.totalMembers, 0);
  assert.strictEqual(summary.cards.activeMembers, 0);
  assert.deepStrictEqual(summary.recent, []);
});

test('summariseDashboard passes a negative month total through unchanged', () => {
  // Corrections can outweigh awards in a month; a clamped or absolute value
  // would misreport the club as having earned XP it did not.
  const summary = summariseDashboard({
    members: [],
    monthXp: -450,
    entries: [],
    period: SEPTEMBER,
  });

  assert.strictEqual(summary.cards.monthXp, -450);
});

test('summariseDashboard labels the month from the period it was given', () => {
  const summary = summariseDashboard({
    members: [],
    monthXp: 0,
    entries: [],
    period: SEPTEMBER,
  });

  assert.strictEqual(summary.cards.monthLabel, 'September 2026');
});

test('summariseDashboard formats each entry for display', () => {
  const summary = summariseDashboard({
    members: [],
    monthXp: 0,
    entries: [
      ledgerEntry({ entryId: 51, xpAmount: -300, activityCode: null, reason: 'test' }),
      ledgerEntry({ entryId: 50, xpAmount: 50, reason: 'Membership' }),
    ],
    period: SEPTEMBER,
  });

  assert.deepStrictEqual(summary.recent, [
    {
      entryId: 51,
      memberId: MEMBER_ID,
      displayName: 'Ordinary Member',
      xpAmount: -300,
      xpLabel: '-300',
      reason: 'test',
      timestamp: 'Sep 17, 2026, 22:13',
      createdAt: '2026-09-17T22:13:22.202146+00:00',
    },
    {
      entryId: 50,
      memberId: MEMBER_ID,
      displayName: 'Ordinary Member',
      xpAmount: 50,
      xpLabel: '+50',
      reason: 'Membership',
      timestamp: 'Sep 17, 2026, 22:13',
      createdAt: '2026-09-17T22:13:22.202146+00:00',
    },
  ]);
});

test('summariseDashboard keeps the database order and never re-sorts', () => {
  // "Most recent first" is the database's job (created_at DESC, id DESC). Two
  // identical requests must not produce two different orders.
  const summary = summariseDashboard({
    members: [],
    monthXp: 0,
    entries: [
      ledgerEntry({ entryId: 9, displayName: 'Zara' }),
      ledgerEntry({ entryId: 8, displayName: 'Aisha' }),
      ledgerEntry({ entryId: 7, displayName: 'Basil' }),
    ],
    period: SEPTEMBER,
  });

  assert.deepStrictEqual(
    summary.recent.map((entry) => entry.displayName),
    ['Zara', 'Aisha', 'Basil']
  );
});

test('summariseDashboard renders at most RECENT_ENTRY_LIMIT entries', () => {
  // The database already limits the read; this is the belt-and-braces bound so
  // the list cannot grow past ten whatever the query returns.
  const entries = Array.from({ length: 25 }, (_, index) =>
    ledgerEntry({ entryId: 100 - index })
  );

  const summary = summariseDashboard({
    members: [],
    monthXp: 0,
    entries,
    period: SEPTEMBER,
  });

  assert.strictEqual(RECENT_ENTRY_LIMIT, 10);
  assert.strictEqual(summary.recent.length, 10);
  assert.deepStrictEqual(
    summary.recent.map((entry) => entry.entryId),
    [100, 99, 98, 97, 96, 95, 94, 93, 92, 91]
  );
});

test('summariseDashboard does not mutate the entries it was given', () => {
  const entries = Array.from({ length: 12 }, (_, index) =>
    ledgerEntry({ entryId: index })
  );
  const before = JSON.parse(JSON.stringify(entries));

  summariseDashboard({ members: [], monthXp: 0, entries, period: SEPTEMBER });

  assert.deepStrictEqual(entries, before);
});

// ---------------------------------------------------------------------------
// GET /api/manager/dashboard — authorization
// ---------------------------------------------------------------------------

test('the dashboard answers 401 with no session', async () => {
  reset();

  const response = await getDashboard();

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(await response.json(), { error: 'Unauthorized' });

  // Nothing was read, so a caller without a session learns nothing.
  assert.strictEqual(dbState.directoryCalls, 0);
  assert.strictEqual(dbState.monthXpCalls.length, 0);
  assert.strictEqual(dbState.recentEntryLimits.length, 0);
});

test('the dashboard answers 401 when the session no longer maps to a member', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = null;

  const response = await getDashboard();

  assert.strictEqual(response.status, 401);
  assert.strictEqual(dbState.directoryCalls, 0);
});

test('the dashboard answers 403 for a signed-in member who is not an XP manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await getDashboard();

  assert.strictEqual(response.status, 403);
  assert.deepStrictEqual(await response.json(), { error: 'Forbidden' });

  // The roster, the month total and the ledger are all manager data; a
  // non-manager must not cause any of them to be read.
  assert.strictEqual(dbState.directoryCalls, 0);
  assert.strictEqual(dbState.monthXpCalls.length, 0);
  assert.strictEqual(dbState.recentEntryLimits.length, 0);
});

test('the dashboard resolves the actor from the session, not the request', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  await getDashboard();

  // The only member id asked about is the session's own.
  assert.deepStrictEqual(dbState.profileLookups, [MEMBER_ID]);
});

test('the dashboard answers 200 for each of the two XP managers', async () => {
  for (const manager of [BASIL, BHUMIKA]) {
    reset();
    signInAs(manager);
    dbState.profile = manager;

    const response = await getDashboard();

    assert.strictEqual(
      response.status,
      200,
      `${manager.email} must be allowed`
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/manager/dashboard — payload
// ---------------------------------------------------------------------------

test('the dashboard returns the cards, the period and the recent entries', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.directoryRows = [
    member({ memberId: BASIL_ID, membershipStatus: 'active' }),
    member({ memberId: BHUMIKA_ID, membershipStatus: 'active' }),
    member({ memberId: MEMBER_ID, membershipStatus: 'pending' }),
  ];
  dbState.monthXp = 250;
  dbState.recentEntries = [
    ledgerEntry({ entryId: 51, xpAmount: -300, activityCode: null, reason: 'test' }),
  ];

  const response = await getDashboard();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.cards, {
    totalMembers: 3,
    activeMembers: 2,
    monthXp: 250,
    monthLabel: 'September 2026',
  });
  assert.deepStrictEqual(payload.recent, [
    {
      entryId: 51,
      memberId: MEMBER_ID,
      displayName: 'Ordinary Member',
      xpAmount: -300,
      xpLabel: '-300',
      reason: 'test',
      timestamp: 'Sep 17, 2026, 22:13',
      createdAt: '2026-09-17T22:13:22.202146+00:00',
    },
  ]);

  // The window is echoed as ISO so the client can show which month the figures
  // describe, exactly as GET /api/leaderboard does.
  assert.strictEqual(typeof payload.period.start, 'string');
  assert.strictEqual(typeof payload.period.end, 'string');
  assert.strictEqual(new Date(payload.period.start).getUTCDate(), 1);
  assert.strictEqual(new Date(payload.period.start).getUTCHours(), 0);
});

test('the dashboard asks for the current UTC month, half-open', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const before = new Date();
  await getDashboard();
  const after = new Date();

  assert.strictEqual(dbState.monthXpCalls.length, 1);

  const { start, end } = dbState.monthXpCalls[0];

  // Midnight on the 1st, to midnight on the 1st of the next month - and the
  // window must contain the instant the request was made.
  assert.strictEqual(start.getUTCDate(), 1);
  assert.strictEqual(start.getUTCHours(), 0);
  assert.strictEqual(start.getUTCMinutes(), 0);
  assert.strictEqual(start.getUTCSeconds(), 0);
  assert.strictEqual(start.getUTCMilliseconds(), 0);

  assert.strictEqual(end.getUTCDate(), 1);
  assert.strictEqual(end.getUTCHours(), 0);

  assert.ok(start <= before, 'the window must start at or before the request');
  assert.ok(end > after, 'the window must end after the request');
  assert.strictEqual(end.getTime() - start.getTime() > 0, true);
});

test('the dashboard requests exactly the recent-entry limit it reports', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  await getDashboard();

  assert.deepStrictEqual(dbState.recentEntryLimits, [RECENT_ENTRY_LIMIT]);
});

test('the dashboard renders at most ten recent entries even if more are returned', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.recentEntries = Array.from({ length: 30 }, (_, index) =>
    ledgerEntry({ entryId: 1000 - index })
  );

  const payload = await (await getDashboard()).json();

  assert.strictEqual(payload.recent.length, 10);
});

test('an empty roster and an empty ledger are a valid dashboard, not an error', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.directoryRows = [];
  dbState.monthXp = 0;
  dbState.recentEntries = [];

  const response = await getDashboard();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.cards.totalMembers, 0);
  assert.strictEqual(payload.cards.activeMembers, 0);
  assert.strictEqual(payload.cards.monthXp, 0);
  assert.deepStrictEqual(payload.recent, []);
});

test('a month total of zero is data, and a null month total is an error', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  dbState.monthXp = 0;
  assert.strictEqual((await getDashboard()).status, 200);

  dbState.monthXp = null;
  assert.strictEqual((await getDashboard()).status, 500);
});

// ---------------------------------------------------------------------------
// GET /api/manager/dashboard — failure handling
// ---------------------------------------------------------------------------

test('the dashboard answers 500 when the directory read fails', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.directoryFails = true;

  assert.strictEqual((await getDashboard()).status, 500);
});

test('the dashboard answers 500 when the month total read fails', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.monthXpFails = true;

  assert.strictEqual((await getDashboard()).status, 500);
});

test('the dashboard answers 500 when the recent-entries read fails', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.recentEntriesFail = true;

  const response = await getDashboard();

  assert.strictEqual(response.status, 500);
  // A partial dashboard would be worse than none: three of the four figures
  // would look authoritative while the fourth was silently absent.
  assert.deepStrictEqual(await response.json(), {
    error: 'Internal server error',
  });
});

test('the dashboard reads all three sources, once each', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  await getDashboard();

  assert.strictEqual(dbState.directoryCalls, 1);
  assert.strictEqual(dbState.monthXpCalls.length, 1);
  assert.strictEqual(dbState.recentEntryLimits.length, 1);
});

test('the dashboard never writes to the ledger', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  await getDashboard();

  assert.deepStrictEqual(dbState.writes, []);
});
