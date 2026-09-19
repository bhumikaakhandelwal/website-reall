// Phase 8C: the XP ledger explorer.
//
// Two halves, deliberately in one file because they cover one feature:
//
//   1. the enrichment and the four filters in lib/manager/ledger.ts. This
//      project has no DOM test environment (Node's type stripping does not
//      transform JSX, so a .tsx component cannot be imported into a test at
//      all), so these functions are where the page's decisions live.
//
//   2. the route, run for real against in-memory doubles for the Supabase
//      boundary and the session reader.
//
// The enrichment gets the most attention, because it is the part that can go
// quietly wrong: a member who is not on the roster, an event that has been
// deleted, an entry with no event at all, and a link that points at the same
// ledger entry twice are all states the ledger must survive without losing or
// duplicating a row.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import {
  EMPTY_LEDGER_FILTERS,
  UNKNOWN_MEMBER,
  activityOptions,
  dateBounds,
  enrichLedgerEntries,
  filterLedgerEntries,
  loadLedger,
  summariseLedger,
} from '@/lib/manager/ledger';
import { GET as getLedger } from '@/app/api/manager/ledger/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const BHUMIKA_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';

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

function fetchStub(status, body) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** A ledger row, as the database layer reads it. */
function row(overrides = {}) {
  return {
    entryId: 1,
    memberId: MEMBER_ID,
    xpAmount: 50,
    activityCode: 'membership',
    reason: 'Membership',
    createdAt: '2026-09-17T22:13:22.202146+00:00',
    ...overrides,
  };
}

const MEMBERS = [
  { memberId: MEMBER_ID, displayName: 'Ordinary Member', email: 'ordinary@dbcegoa.ac.in' },
  { memberId: BASIL_ID, displayName: 'Basil Shaikh Mohammad', email: '2414011@dbcegoa.ac.in' },
];

const EVENTS = [{ id: EVENT_ID, title: 'git workshop' }];

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

test('the member name and email are joined on', () => {
  const enriched = enrichLedgerEntries([row()], MEMBERS, [], EVENTS);

  assert.strictEqual(enriched[0].displayName, 'Ordinary Member');
  assert.strictEqual(enriched[0].email, 'ordinary@dbcegoa.ac.in');
});

test('a member who is not on the roster still yields a readable entry', () => {
  // The ledger is an append-only audit trail that outlives the things it refers
  // to. An entry must never vanish because the member is gone.
  const enriched = enrichLedgerEntries([row()], [], [], EVENTS);

  assert.strictEqual(enriched.length, 1);
  assert.strictEqual(enriched[0].displayName, UNKNOWN_MEMBER);
  assert.strictEqual(enriched[0].email, '');
});

test('the event title is joined on when the entry came from an event', () => {
  const enriched = enrichLedgerEntries(
    [row({ entryId: 7 })],
    MEMBERS,
    [{ xpLedgerId: 7, eventId: EVENT_ID }],
    EVENTS
  );

  assert.strictEqual(enriched[0].eventId, EVENT_ID);
  assert.strictEqual(enriched[0].eventTitle, 'git workshop');
});

test('an entry with no event names no event', () => {
  const enriched = enrichLedgerEntries([row()], MEMBERS, [], EVENTS);

  assert.strictEqual(enriched[0].eventId, null);
  assert.strictEqual(enriched[0].eventTitle, null);
});

test('a link to an event that no longer exists leaves the entry readable', () => {
  // The event was deleted; the ledger entry it awarded survives, and must not
  // show a broken event.
  const enriched = enrichLedgerEntries(
    [row({ entryId: 7 })],
    MEMBERS,
    [{ xpLedgerId: 7, eventId: EVENT_ID }],
    []
  );

  assert.strictEqual(enriched.length, 1);
  assert.strictEqual(enriched[0].eventId, null);
  assert.strictEqual(enriched[0].eventTitle, null);
});

test('two links pointing at one ledger entry do not duplicate it', () => {
  // Phase 7B writes one ledger row per attendance row, so this cannot happen -
  // but the explorer must not depend on that to avoid showing an entry twice.
  const enriched = enrichLedgerEntries(
    [row({ entryId: 7 })],
    MEMBERS,
    [
      { xpLedgerId: 7, eventId: EVENT_ID },
      { xpLedgerId: 7, eventId: '99999999-9999-4999-8999-999999999999' },
    ],
    EVENTS
  );

  assert.strictEqual(enriched.length, 1);
});

test('enrichment preserves the order it was given', () => {
  // The database ordered it newest-first; nothing here re-sorts.
  const enriched = enrichLedgerEntries(
    [row({ entryId: 3 }), row({ entryId: 2 }), row({ entryId: 1 })],
    MEMBERS,
    [],
    EVENTS
  );

  assert.deepStrictEqual(
    enriched.map((item) => item.entryId),
    [3, 2, 1]
  );
});

test('an entry with no activity code is a correction', () => {
  const enriched = enrichLedgerEntries(
    [row({ xpAmount: -200, activityCode: null, reason: 'Phase 3 correction' })],
    MEMBERS,
    [],
    EVENTS
  );

  assert.strictEqual(enriched[0].isCorrection, true);
  assert.strictEqual(enriched[0].activityLabel, 'Correction');
  assert.strictEqual(enriched[0].xpLabel, '-200');
});

test('an entry with an activity code is an award', () => {
  const enriched = enrichLedgerEntries([row()], MEMBERS, [], EVENTS);

  assert.strictEqual(enriched[0].isCorrection, false);
  assert.strictEqual(enriched[0].activityLabel, 'Membership');
});

test('a Handbook activity is labelled from the Handbook', () => {
  const enriched = enrichLedgerEntries(
    [row({ activityCode: 'win-hackathon', xpAmount: 250 })],
    MEMBERS,
    [],
    EVENTS
  );

  assert.strictEqual(enriched[0].activityLabel, 'Win hackathon');
  assert.strictEqual(enriched[0].xpLabel, '+250');
});

test('an activity code that has left the Handbook still renders', () => {
  const enriched = enrichLedgerEntries(
    [row({ activityCode: 'retired-activity' })],
    MEMBERS,
    [],
    EVENTS
  );

  assert.strictEqual(enriched[0].activityLabel, 'retired-activity');
  assert.strictEqual(enriched[0].isCorrection, false);
});

test('a missing reason is stated plainly', () => {
  const enriched = enrichLedgerEntries([row({ reason: null })], MEMBERS, [], EVENTS);

  assert.strictEqual(enriched[0].reason, 'No reason recorded');
});

test('the timestamp is formatted in UTC', () => {
  const enriched = enrichLedgerEntries([row()], MEMBERS, [], EVENTS);

  assert.strictEqual(enriched[0].timestamp, 'Sep 17, 2026, 22:13');
  // The raw instant is kept for a <time dateTime> attribute.
  assert.strictEqual(enriched[0].createdAt, '2026-09-17T22:13:22.202146+00:00');
});

// ---------------------------------------------------------------------------
// dateBounds
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

test('a date range is half-open, so the last day is included in full', () => {
  // "From the 1st to the 30th" must include the 30th. The bound is the start of
  // the 31st, which is the same half-open convention the leaderboards use.
  const bounds = dateBounds('2026-09-01', '2026-09-30');

  assert.strictEqual(bounds.start, Date.parse('2026-09-01T00:00:00Z'));
  assert.strictEqual(bounds.end, Date.parse('2026-09-30T00:00:00Z') + DAY);
});

test('an open lower bound starts at the beginning of time', () => {
  const bounds = dateBounds('', '2026-09-30');

  assert.strictEqual(bounds.start, Number.NEGATIVE_INFINITY);
  assert.strictEqual(bounds.end, Date.parse('2026-09-30T00:00:00Z') + DAY);
});

test('an open upper bound never ends', () => {
  const bounds = dateBounds('2026-09-01', '');

  assert.strictEqual(bounds.start, Date.parse('2026-09-01T00:00:00Z'));
  assert.strictEqual(bounds.end, Number.POSITIVE_INFINITY);
});

test('no bounds means no date filter at all', () => {
  assert.strictEqual(dateBounds('', ''), null);
});

test('a bound that is not a real date is ignored', () => {
  // The inputs are native date pickers, so the only other thing they can be is
  // empty - but a hand-set value must not throw or silently match everything.
  assert.strictEqual(dateBounds('nope', ''), null);
  assert.strictEqual(dateBounds('2026-02-31', ''), null);
});

// ---------------------------------------------------------------------------
// filterLedgerEntries - member search
// ---------------------------------------------------------------------------

const LEDGER = [
  enrichLedgerEntries(
    [
      row({ entryId: 1, memberId: MEMBER_ID, activityCode: 'membership' }),
      row({ entryId: 2, memberId: BASIL_ID, activityCode: 'github-project' }),
      row({ entryId: 3, memberId: MEMBER_ID, activityCode: null, xpAmount: -50 }),
    ],
    MEMBERS,
    [],
    EVENTS
  ),
][0];

function filters(overrides = {}) {
  return { ...EMPTY_LEDGER_FILTERS, ...overrides };
}

test('a blank filter set returns everything', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, EMPTY_LEDGER_FILTERS).map((e) => e.entryId),
    [1, 2, 3]
  );
});

test('the member search matches a name, case-insensitively', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ memberQuery: 'basil' })).map((e) => e.entryId),
    [2]
  );
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ memberQuery: 'ORDINARY' })).map((e) => e.entryId),
    [1, 3]
  );
});

test('the member search matches an email', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ memberQuery: '2414011' })).map((e) => e.entryId),
    [2]
  );
});

test('the member search trims, and blank means everyone', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ memberQuery: '   ' })).map((e) => e.entryId),
    [1, 2, 3]
  );
});

test('the member search can match nobody', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ memberQuery: 'zzzz' })),
    []
  );
});

// ---------------------------------------------------------------------------
// filterLedgerEntries - activity and kind
// ---------------------------------------------------------------------------

test('the activity filter is an exact match', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ activityCode: 'membership' })).map((e) => e.entryId),
    [1]
  );
});

test('the activity filter excludes corrections, which carry no code', () => {
  // A correction has activityCode === null, so it can never match a code filter.
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ activityCode: 'github-project' })).map((e) => e.entryId),
    [2]
  );
});

test('an empty activity filter means every activity', () => {
  assert.strictEqual(filterLedgerEntries(LEDGER, filters()).length, 3);
});

test('the kind filter separates awards from corrections', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ kind: 'award' })).map((e) => e.entryId),
    [1, 2]
  );
  assert.deepStrictEqual(
    filterLedgerEntries(LEDGER, filters({ kind: 'correction' })).map((e) => e.entryId),
    [3]
  );
});

test('the kind filter defaults to everything', () => {
  assert.strictEqual(filterLedgerEntries(LEDGER, filters({ kind: 'all' })).length, 3);
});

// ---------------------------------------------------------------------------
// filterLedgerEntries - date range
// ---------------------------------------------------------------------------

const DATED = enrichLedgerEntries(
  [
    row({ entryId: 1, createdAt: '2026-09-01T00:00:00Z' }),
    row({ entryId: 2, createdAt: '2026-09-15T12:00:00Z' }),
    row({ entryId: 3, createdAt: '2026-09-30T23:59:59.999Z' }),
    row({ entryId: 4, createdAt: '2026-10-01T00:00:00Z' }),
  ],
  MEMBERS,
  [],
  EVENTS
);

test('the date range includes both end days', () => {
  // The classic bug here is dropping everything after midnight on the last day.
  assert.deepStrictEqual(
    filterLedgerEntries(DATED, filters({ from: '2026-09-01', to: '2026-09-30' })).map((e) => e.entryId),
    [1, 2, 3]
  );
});

test('the date range is exclusive of the day after the end', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(DATED, filters({ from: '2026-09-30', to: '2026-09-30' })).map((e) => e.entryId),
    [3]
  );
});

test('an open lower bound filters only upwards', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(DATED, filters({ to: '2026-09-15' })).map((e) => e.entryId),
    [1, 2]
  );
});

test('an open upper bound filters only downwards', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(DATED, filters({ from: '2026-09-30' })).map((e) => e.entryId),
    [3, 4]
  );
});

test('a range that matches nothing returns nothing', () => {
  assert.deepStrictEqual(
    filterLedgerEntries(DATED, filters({ from: '2027-01-01', to: '2027-12-31' })),
    []
  );
});

test('an inverted range returns nothing rather than everything', () => {
  // A start after the end is an empty window, not a filter to ignore.
  assert.deepStrictEqual(
    filterLedgerEntries(DATED, filters({ from: '2026-10-01', to: '2026-09-01' })),
    []
  );
});

// ---------------------------------------------------------------------------
// filterLedgerEntries - combinations
// ---------------------------------------------------------------------------

test('the filters combine with AND', () => {
  // Narrowing one filter narrows the result; it does not widen it.
  const result = filterLedgerEntries(
    LEDGER,
    filters({ memberQuery: 'ordinary', kind: 'award' })
  );

  assert.deepStrictEqual(result.map((e) => e.entryId), [1]);
});

test('filters that cannot both hold return nothing', () => {
  const result = filterLedgerEntries(
    LEDGER,
    filters({ activityCode: 'membership', kind: 'correction' })
  );

  assert.deepStrictEqual(result, []);
});

test('filtering preserves the order it was given', () => {
  const result = filterLedgerEntries(LEDGER, filters({ memberQuery: 'ordinary' }));

  assert.deepStrictEqual(result.map((e) => e.entryId), [1, 3]);
});

test('filtering does not mutate the entries', () => {
  const before = JSON.stringify(LEDGER);

  filterLedgerEntries(LEDGER, filters({ memberQuery: 'basil' }));

  assert.strictEqual(JSON.stringify(LEDGER), before);
});

// ---------------------------------------------------------------------------
// summariseLedger
// ---------------------------------------------------------------------------

test('the summary counts awards, corrections and net XP', () => {
  const summary = summariseLedger(LEDGER, 94);

  assert.strictEqual(summary.shown, 3);
  assert.strictEqual(summary.total, 94);
  assert.strictEqual(summary.awards, 2);
  assert.strictEqual(summary.corrections, 1);
  assert.strictEqual(summary.netXp, 50);
});

test('net XP goes negative when corrections outweigh awards', () => {
  const corrections = enrichLedgerEntries(
    [
      row({ entryId: 1, xpAmount: 50, activityCode: 'membership' }),
      row({ entryId: 2, xpAmount: -300, activityCode: null }),
    ],
    MEMBERS,
    [],
    EVENTS
  );

  assert.strictEqual(summariseLedger(corrections, 2).netXp, -250);
});

test('the summary of nothing is all zeroes', () => {
  assert.deepStrictEqual(summariseLedger([], 0), {
    shown: 0,
    total: 0,
    awards: 0,
    corrections: 0,
    netXp: 0,
  });
});

// ---------------------------------------------------------------------------
// activityOptions
// ---------------------------------------------------------------------------

test('the activity options are derived from the entries, with counts', () => {
  // Only activities that would return something are offered: a filter that can
  // only ever produce an empty list is worse than no filter.
  assert.deepStrictEqual(activityOptions(LEDGER), [
    { code: 'github-project', label: 'GitHub project', count: 1 },
    { code: 'membership', label: 'Membership', count: 1 },
  ]);
});

test('the activity options are sorted by label', () => {
  const many = enrichLedgerEntries(
    [
      row({ entryId: 1, activityCode: 'win-hackathon' }),
      row({ entryId: 2, activityCode: 'github-project' }),
      row({ entryId: 3, activityCode: 'github-project' }),
    ],
    MEMBERS,
    [],
    EVENTS
  );

  assert.deepStrictEqual(
    activityOptions(many).map((option) => option.label),
    ['GitHub project', 'Win hackathon']
  );
  assert.strictEqual(activityOptions(many)[0].count, 2);
});

test('corrections are not an activity option', () => {
  // They carry no code; the Award/Correction filter is what selects them.
  const correctionsOnly = enrichLedgerEntries(
    [row({ activityCode: null, xpAmount: -50 })],
    MEMBERS,
    [],
    EVENTS
  );

  assert.deepStrictEqual(activityOptions(correctionsOnly), []);
});

test('there are no activity options for an empty ledger', () => {
  assert.deepStrictEqual(activityOptions([]), []);
});

// ---------------------------------------------------------------------------
// loadLedger
// ---------------------------------------------------------------------------

test('loadLedger returns the entries', async () => {
  const outcome = await loadLedger(fetchStub(200, { entries: LEDGER }));

  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.entries, LEDGER);
});

test('loadLedger requests the manager ledger url', async () => {
  let url = null;

  await loadLedger(async (input) => {
    url = input;
    return new Response(JSON.stringify({ entries: [] }), { status: 200 });
  });

  assert.strictEqual(url, '/api/manager/ledger');
});

test('loadLedger separates 401 from 403', async () => {
  const unauthorized = await loadLedger(fetchStub(401, {}));
  const forbidden = await loadLedger(fetchStub(403, {}));

  assert.strictEqual(unauthorized.kind, 'unauthorized');
  assert.strictEqual(forbidden.kind, 'forbidden');
});

test('loadLedger reports a server or network failure as unavailable', async () => {
  const server = await loadLedger(fetchStub(500, {}));
  const network = await loadLedger(async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(server.kind, 'unavailable');
  assert.strictEqual(network.kind, 'unavailable');
});

test('loadLedger never turns a broken body into an empty ledger', async () => {
  // "No XP has been recorded" and "the response was broken" must not look the
  // same.
  for (const body of [{}, { entries: null }, { entries: 'nope' }, null]) {
    const outcome = await loadLedger(fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

// ---------------------------------------------------------------------------
// GET /api/manager/ledger
// ---------------------------------------------------------------------------

test('the ledger answers 401 with no session', async () => {
  reset();

  const response = await getLedger();

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(await response.json(), { error: 'Unauthorized' });
  assert.strictEqual(dbState.ledgerEntriesCalls, 0);
});

test('the ledger answers 403 for a non-manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await getLedger();

  assert.strictEqual(response.status, 403);
  assert.strictEqual(dbState.ledgerEntriesCalls, 0, 'a non-manager must read nothing');
});

test('the ledger answers 200 for each of the two XP managers', async () => {
  for (const manager of [BASIL, { ...BASIL, id: BHUMIKA_ID, email: '2414012@dbcegoa.ac.in' }]) {
    reset();
    signInAsManager(manager);
    dbState.ledgerEntries = [];
    dbState.directoryRows = [];
    dbState.ledgerLinks = [];
    dbState.eventRows = [];

    const response = await getLedger();

    assert.strictEqual(response.status, 200, `${manager.email} must be allowed`);
  }
});

test('the ledger returns enriched entries, newest first', async () => {
  reset();
  signInAsManager();
  dbState.ledgerEntries = [
    row({ entryId: 2, memberId: BASIL_ID, activityCode: 'github-project' }),
    row({ entryId: 1, memberId: MEMBER_ID }),
  ];
  dbState.directoryRows = [
    {
      memberId: MEMBER_ID,
      email: 'ordinary@dbcegoa.ac.in',
      displayName: 'Ordinary Member',
      membershipStatus: 'active',
      joinedAt: '2026-09-01T00:00:00Z',
      totalXp: 0,
    },
    {
      memberId: BASIL_ID,
      email: '2414011@dbcegoa.ac.in',
      displayName: 'Basil Shaikh Mohammad',
      membershipStatus: 'active',
      joinedAt: '2026-09-01T00:00:00Z',
      totalXp: 0,
    },
  ];
  dbState.ledgerLinks = [];
  dbState.eventRows = [];

  const response = await getLedger();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(
    payload.entries.map((item) => item.entryId),
    [2, 1]
  );
  assert.strictEqual(payload.entries[0].displayName, 'Basil Shaikh Mohammad');
  assert.strictEqual(payload.entries[0].activityLabel, 'GitHub project');
  assert.strictEqual(payload.entries[1].displayName, 'Ordinary Member');
});

test('the ledger joins the event name through the attendance link', async () => {
  reset();
  signInAsManager();
  dbState.ledgerEntries = [row({ entryId: 7 })];
  dbState.directoryRows = [
    {
      memberId: MEMBER_ID,
      email: 'ordinary@dbcegoa.ac.in',
      displayName: 'Ordinary Member',
      membershipStatus: 'active',
      joinedAt: '2026-09-01T00:00:00Z',
      totalXp: 0,
    },
  ];
  dbState.ledgerLinks = [{ xpLedgerId: 7, eventId: EVENT_ID }];
  dbState.eventRows = [
    {
      id: EVENT_ID,
      title: 'git workshop',
      eventType: 'workshop',
      eventDate: '2026-09-15',
      activityCode: 'membership',
      createdBy: BASIL_ID,
      createdAt: '2026-09-01T10:00:00.000Z',
      archivedAt: null,
      archivedBy: null,
    },
  ];

  const payload = await (await getLedger()).json();

  assert.strictEqual(payload.entries[0].eventTitle, 'git workshop');
});

test('an empty ledger is a valid page, not an error', async () => {
  reset();
  signInAsManager();
  dbState.ledgerEntries = [];
  dbState.directoryRows = [];
  dbState.ledgerLinks = [];
  dbState.eventRows = [];

  const response = await getLedger();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual((await response.json()).entries, []);
});

test('the ledger answers 500 when any of the four reads fails', async () => {
  // A partial ledger would be worse than none: some entries would render with a
  // blank member or a missing event, and look authoritative.
  const breakages = [
    () => {
      dbState.ledgerEntriesFail = true;
    },
    () => {
      dbState.directoryFails = true;
    },
    () => {
      dbState.ledgerLinksFail = true;
    },
    () => {
      dbState.eventsFail = true;
    },
  ];

  for (const breakIt of breakages) {
    reset();
    signInAsManager();
    breakIt();

    const response = await getLedger();

    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(await response.json(), {
      error: 'Internal server error',
    });
  }
});

test('the ledger reads all four sources exactly once', async () => {
  reset();
  signInAsManager();
  dbState.ledgerEntries = [];
  dbState.directoryRows = [];
  dbState.ledgerLinks = [];
  dbState.eventRows = [];

  await getLedger();

  assert.strictEqual(dbState.ledgerEntriesCalls, 1);
  assert.strictEqual(dbState.directoryCalls, 1);
  assert.strictEqual(dbState.ledgerLinksCalls, 1);
  assert.strictEqual(dbState.eventListCalls, 1);
});

test('the ledger is read-only: it writes nothing at all', async () => {
  // "Keep the ledger completely read-only" is a requirement, so it is asserted
  // rather than assumed.
  reset();
  signInAsManager();
  dbState.ledgerEntries = [row()];
  dbState.directoryRows = [];
  dbState.ledgerLinks = [];
  dbState.eventRows = [];

  await getLedger();

  assert.deepStrictEqual(dbState.writes, [], 'no XP may be written');
  assert.deepStrictEqual(dbState.eventWrites, [], 'no event may be created');
  assert.deepStrictEqual(dbState.updateEventCalls, [], 'no event may be edited');
  assert.deepStrictEqual(dbState.archiveEventCalls, []);
  assert.deepStrictEqual(dbState.deleteEventCalls, []);
  assert.deepStrictEqual(dbState.setAttendanceCalls, [], 'no attendance may be saved');
  assert.deepStrictEqual(dbState.awardCalls, [], 'no award may be run');
});
