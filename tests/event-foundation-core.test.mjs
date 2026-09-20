// Phase 7A: the event foundation.
//
// Two halves, deliberately in one file because they cover one feature:
//
//   1. the pure logic in lib/events/events.ts - the event type vocabulary, the
//      draft validation, the XP preview, the date formatting and the two client
//      calls. This project has no DOM test environment (Node's type stripping
//      does not transform JSX, so a .tsx component cannot be imported into a
//      test at all), so these functions are where the page's decisions live and
//      where they can actually be asserted on.
//
//   2. /api/events, run for real against in-memory doubles for the Supabase
//      boundary and the session reader (tests/doubles/, wired up by
//      tests/helpers/hooks.mjs). The real authorization, the real manager
//      allowlist, the real request validation and the real response mapping all
//      execute; nothing reaches the network.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import {
  ACTIVITY_OPTIONS,
  EVENT_TITLE_MAX,
  EVENT_TYPES,
  activityXpPreview,
  eventTypeLabel,
  fetchEvents,
  formatEventDate,
  isCalendarDate,
  submitEvent,
  validateEventDraft,
} from '@/lib/events/events';
import { eventTypeSchema } from '@/lib/db/schema';
import { XP_ACTIVITIES } from '@/lib/xp/activities';
import { GET as listEvents, POST as createEvent } from '@/app/api/events/route';

// Synthetic identities only. The two manager addresses are the ones the
// allowlist itself names (lib/xp/managers.ts); everyone else here is invented,
// so no real roster entry is used as a test fixture.
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

function postRequest(body, url = 'http://localhost/api/events') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A valid create payload, so each test varies exactly one thing. */
function validBody(overrides = {}) {
  return {
    title: 'Intro to Git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'technical-session',
    ...overrides,
  };
}

/** An event row, as lib/db/queries.ts maps it out of the table. */
function eventRow(overrides = {}) {
  return {
    id: EVENT_ID,
    title: 'Intro to Git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'technical-session',
    createdBy: BASIL_ID,
    createdAt: '2026-09-10T10:00:00.000Z',
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
// The event type vocabulary
// ---------------------------------------------------------------------------

test('the event types match the database enum', () => {
  // The codes are written out in lib/events/events.ts so that importing the zod
  // schema does not pull zod into the browser bundle. This is the test that
  // stops the two lists drifting, and it is why the duplication is acceptable.
  assert.deepStrictEqual(
    EVENT_TYPES.map((type) => type.code),
    [...eventTypeSchema.options]
  );
});

test('every event type has a label and the codes are unique', () => {
  const codes = EVENT_TYPES.map((type) => type.code);

  assert.strictEqual(new Set(codes).size, codes.length, 'codes must be unique');

  for (const type of EVENT_TYPES) {
    assert.ok(type.label.length > 0, `${type.code} needs a label`);
  }
});

test('eventTypeLabel resolves a code and falls back to the code itself', () => {
  assert.strictEqual(eventTypeLabel('workshop'), 'Workshop');
  assert.strictEqual(eventTypeLabel('coding-contest'), 'Coding contest');
  // A stored value that is no longer in the vocabulary must still render as
  // something, rather than blanking the row.
  assert.strictEqual(eventTypeLabel('retired-type'), 'retired-type');
});

test('the activity options are mapped from the Handbook list', () => {
  // Not redefined: the dropdown must not be able to offer an activity the
  // server would reject.
  assert.deepStrictEqual(
    ACTIVITY_OPTIONS.map((option) => option.code),
    XP_ACTIVITIES.map((activity) => activity.code)
  );

  for (const option of ACTIVITY_OPTIONS) {
    const activity = XP_ACTIVITIES.find((a) => a.code === option.code);

    assert.strictEqual(option.xp, activity.xp);
    assert.strictEqual(option.label, activity.label);
  }
});

// ---------------------------------------------------------------------------
// isCalendarDate
// ---------------------------------------------------------------------------

test('isCalendarDate accepts real dates', () => {
  for (const date of ['2026-09-18', '2026-01-01', '2026-12-31', '2028-02-29']) {
    assert.strictEqual(isCalendarDate(date), true, date);
  }
});

test('isCalendarDate rejects a date that does not exist', () => {
  // The round-trip is the point: Date.parse('2026-02-31T00:00:00Z') SUCCEEDS by
  // rolling over to 3 March, so a parse check alone would accept a date the
  // manager never typed.
  for (const date of ['2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10', '2026-09-31']) {
    assert.strictEqual(isCalendarDate(date), false, date);
  }
});

test('isCalendarDate rejects a non-leap 29 February', () => {
  assert.strictEqual(isCalendarDate('2028-02-29'), true, '2028 is a leap year');
  assert.strictEqual(isCalendarDate('2026-02-29'), false, '2026 is not');
});

test('isCalendarDate rejects anything not in YYYY-MM-DD form', () => {
  for (const value of ['', 'nope', '18/09/2026', '2026-9-18', '2026-09-18T00:00:00Z', '20260918']) {
    assert.strictEqual(isCalendarDate(value), false, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// validateEventDraft
// ---------------------------------------------------------------------------

const GOOD_DRAFT = {
  title: 'Intro to Git workshop',
  eventType: 'workshop',
  eventDate: '2026-09-18',
  activityCode: 'technical-session',
};

test('a complete draft is accepted and normalized', () => {
  const result = validateEventDraft({
    title: '  Intro to Git workshop  ',
    eventType: 'workshop',
    eventDate: '  2026-09-18  ',
    activityCode: '  technical-session  ',
  });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result, {
    ok: true,
    title: 'Intro to Git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'technical-session',
  });
});

test('a missing or blank title is rejected', () => {
  for (const title of ['', '   ', '\t']) {
    const result = validateEventDraft({ ...GOOD_DRAFT, title });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'title');
    assert.ok(result.message.length > 0);
  }
});

test('an over-long title is rejected', () => {
  const result = validateEventDraft({
    ...GOOD_DRAFT,
    title: 'a'.repeat(EVENT_TITLE_MAX + 1),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.field, 'title');
});

test('a title at exactly the limit is accepted', () => {
  const result = validateEventDraft({
    ...GOOD_DRAFT,
    title: 'a'.repeat(EVENT_TITLE_MAX),
  });

  assert.strictEqual(result.ok, true);
});

test('an unknown or missing event type is rejected', () => {
  for (const eventType of ['', 'retired-type', 'WORKSHOP']) {
    const result = validateEventDraft({ ...GOOD_DRAFT, eventType });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'eventType');
  }
});

test('every declared event type is accepted', () => {
  for (const type of EVENT_TYPES) {
    const result = validateEventDraft({ ...GOOD_DRAFT, eventType: type.code });

    assert.strictEqual(result.ok, true, type.code);
    assert.strictEqual(result.eventType, type.code);
  }
});

test('an invalid or missing date is rejected', () => {
  for (const eventDate of ['', 'nope', '2026-02-31', '18/09/2026']) {
    const result = validateEventDraft({ ...GOOD_DRAFT, eventDate });

    assert.strictEqual(result.ok, false, JSON.stringify(eventDate));
    assert.strictEqual(result.field, 'eventDate');
  }
});

test('an activity code that is not in the Handbook is rejected', () => {
  for (const activityCode of ['', 'not-an-activity', 'MEMBERSHIP']) {
    const result = validateEventDraft({ ...GOOD_DRAFT, activityCode });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'activityCode');
  }
});

test('every Handbook activity is accepted as the awarded activity', () => {
  for (const activity of XP_ACTIVITIES) {
    const result = validateEventDraft({
      ...GOOD_DRAFT,
      activityCode: activity.code,
    });

    assert.strictEqual(result.ok, true, activity.code);
  }
});

test('the first problem is reported with the field it belongs to', () => {
  // The form puts the message next to the input, so naming the field matters.
  const result = validateEventDraft({
    title: '',
    eventType: 'nope',
    eventDate: 'nope',
    activityCode: 'nope',
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.field, 'title');
});

test('validateEventDraft does not mutate the draft it was given', () => {
  const draft = { ...GOOD_DRAFT, title: '  padded  ' };
  const before = { ...draft };

  validateEventDraft(draft);

  assert.deepStrictEqual(draft, before);
});

// ---------------------------------------------------------------------------
// activityXpPreview
// ---------------------------------------------------------------------------

test('activityXpPreview shows the signed amount for a Handbook activity', () => {
  assert.strictEqual(activityXpPreview('membership'), '+50 XP');
  assert.strictEqual(activityXpPreview('win-hackathon'), '+250 XP');
});

test('activityXpPreview is null when nothing is chosen', () => {
  assert.strictEqual(activityXpPreview(''), null);
  assert.strictEqual(activityXpPreview('not-an-activity'), null);
});

// ---------------------------------------------------------------------------
// formatEventDate
// ---------------------------------------------------------------------------

test('formatEventDate renders a stored date', () => {
  assert.strictEqual(formatEventDate('2026-09-18'), 'Fri, Sep 18, 2026');
  assert.strictEqual(formatEventDate('2026-01-01'), 'Thu, Jan 01, 2026');
});

test('formatEventDate returns an invalid date unchanged', () => {
  // A guard, not a code path: the column is a DATE, so Postgres guarantees
  // validity. Showing the raw value beats showing "Invalid Date".
  assert.strictEqual(formatEventDate('2026-02-31'), '2026-02-31');
  assert.strictEqual(formatEventDate('nope'), 'nope');
});

test('formatEventDate does not move the date with the visitor timezone', () => {
  // The date is midnight UTC with no zone. Formatting it locally renders the
  // PREVIOUS day for anyone west of UTC, which is why the function pins UTC.
  // A single process cannot change its own timezone, so this runs in children.
  const probe = `
import { formatEventDate } from '@/lib/events/events';

console.log(JSON.stringify({
  event: formatEventDate('2026-09-18'),
  first: formatEventDate('2026-01-01'),
}));
`;

  for (const TZ of ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
    const output = execFileSync(
      process.execPath,
      ['--import', './tests/helpers/hooks.mjs', '--input-type=module', '-e', probe],
      { env: { ...process.env, TZ }, encoding: 'utf8' }
    );

    assert.deepStrictEqual(
      JSON.parse(output),
      { event: 'Fri, Sep 18, 2026', first: 'Thu, Jan 01, 2026' },
      `formatting must be UTC-pinned, but TZ=${TZ} produced ${output.trim()}`
    );
  }
});

// ---------------------------------------------------------------------------
// fetchEvents
// ---------------------------------------------------------------------------

test('fetchEvents returns the list', async () => {
  const outcome = await fetchEvents(
    fetchStub(200, { events: [eventRow()] })
  );

  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.events, [eventRow()]);
});

test('fetchEvents treats an empty list as data, not a failure', async () => {
  const outcome = await fetchEvents(fetchStub(200, { events: [] }));

  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.events, []);
});

test('fetchEvents separates 401 from 403', async () => {
  // The page responds to them differently: 401 re-gates and returns to /login,
  // 403 shows a "managers only" panel and stays put.
  const unauthorized = await fetchEvents(fetchStub(401, { error: 'Unauthorized' }));
  const forbidden = await fetchEvents(fetchStub(403, { error: 'Forbidden' }));

  assert.strictEqual(unauthorized.ok, false);
  assert.strictEqual(unauthorized.kind, 'unauthorized');
  assert.strictEqual(forbidden.ok, false);
  assert.strictEqual(forbidden.kind, 'forbidden');
});

test('fetchEvents reports a server error as unavailable', async () => {
  const outcome = await fetchEvents(fetchStub(500, { error: 'Internal server error' }));

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('fetchEvents reports a network failure as unavailable', async () => {
  const outcome = await fetchEvents(async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('fetchEvents never turns a malformed body into an empty list', async () => {
  // "No events yet" and "the response was broken" must not look the same.
  for (const body of [{}, { events: null }, { events: 'nope' }, null]) {
    const outcome = await fetchEvents(fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

// ---------------------------------------------------------------------------
// submitEvent
// ---------------------------------------------------------------------------

test('submitEvent posts exactly the four chosen fields', async () => {
  let captured = null;

  const outcome = await submitEvent(
    {
      title: 'Intro to Git workshop',
      eventType: 'workshop',
      eventDate: '2026-09-18',
      activityCode: 'technical-session',
    },
    async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ ok: true, id: EVENT_ID }), { status: 201 });
    }
  );

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.id, EVENT_ID);
  assert.strictEqual(captured.url, '/api/events');
  assert.strictEqual(captured.method, 'POST');

  // Exactly these keys, and in particular NO xpAmount: an event names an
  // activity, and the amount is resolved server-side at award time.
  assert.deepStrictEqual(Object.keys(captured.body).sort(), [
    'activityCode',
    'eventDate',
    'eventType',
    'title',
  ]);
});

test('submitEvent reports 401 and 403 separately', async () => {
  const draft = {
    title: 'x',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'membership',
  };

  const unauthorized = await submitEvent(draft, fetchStub(401, { error: 'Unauthorized' }));
  const forbidden = await submitEvent(draft, fetchStub(403, { error: 'Forbidden' }));

  assert.strictEqual(unauthorized.kind, 'unauthorized');
  assert.strictEqual(forbidden.kind, 'forbidden');
});

test('submitEvent turns a 400 into a manager-readable rejection', async () => {
  const outcome = await submitEvent(
    { title: 'x', eventType: 'workshop', eventDate: '2026-09-18', activityCode: 'membership' },
    fetchStub(400, { error: 'Invalid request body' })
  );

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'rejected');
  assert.match(outcome.message, /not valid/i);
  assert.match(outcome.message, /try again/i);
});

test('submitEvent explains an unknown activity code', async () => {
  const outcome = await submitEvent(
    { title: 'x', eventType: 'workshop', eventDate: '2026-09-18', activityCode: 'membership' },
    fetchStub(400, { error: 'Unknown activity code' })
  );

  assert.strictEqual(outcome.kind, 'rejected');
  assert.match(outcome.message, /handbook/i);
});

test('submitEvent reports a server error and a network failure as unavailable', async () => {
  const draft = {
    title: 'x',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'membership',
  };

  const server = await submitEvent(draft, fetchStub(500, { error: 'Internal server error' }));
  const network = await submitEvent(draft, async () => {
    throw new TypeError('fetch failed');
  });

  assert.strictEqual(server.kind, 'unavailable');
  assert.strictEqual(network.kind, 'unavailable');
  // Nothing was saved, and the manager must be told so.
  assert.match(server.message, /not saved/i);
});

test('submitEvent never reports success without an id', async () => {
  // A 2xx with no id is a broken response. Reporting success would leave the
  // manager believing an event exists when it does not.
  for (const body of [{}, { ok: true }, { id: 42 }, null]) {
    const outcome = await submitEvent(
      { title: 'x', eventType: 'workshop', eventDate: '2026-09-18', activityCode: 'membership' },
      fetchStub(201, body)
    );

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

test('the event list answers 401 with no session', async () => {
  reset();

  const response = await listEvents();

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(await response.json(), { error: 'Unauthorized' });

  // Nothing was read, so a caller without a session learns nothing.
  assert.strictEqual(dbState.eventListCalls, 0);
});

test('the event list answers 401 when the session no longer maps to a member', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = null;

  const response = await listEvents();

  assert.strictEqual(response.status, 401);
  assert.strictEqual(dbState.eventListCalls, 0);
});

test('the event list answers 403 for a signed-in member who is not an XP manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await listEvents();

  assert.strictEqual(response.status, 403);
  assert.deepStrictEqual(await response.json(), { error: 'Forbidden' });
  assert.strictEqual(dbState.eventListCalls, 0, 'a non-manager must read nothing');
});

test('the event list answers 200 for each of the two XP managers', async () => {
  for (const manager of [BASIL, BHUMIKA]) {
    reset();
    signInAsManager(manager);

    const response = await listEvents();

    assert.strictEqual(response.status, 200, `${manager.email} must be allowed`);
  }
});

test('the event list returns the events', async () => {
  reset();
  signInAsManager();
  dbState.eventRows = [eventRow()];

  const response = await listEvents();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.events, [eventRow()]);
});

test('an empty register is a valid list, not an error', async () => {
  reset();
  signInAsManager();
  dbState.eventRows = [];

  const response = await listEvents();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual((await response.json()).events, []);
});

test('the event list answers 500 when the read fails', async () => {
  reset();
  signInAsManager();
  dbState.eventsFail = true;

  const response = await listEvents();

  assert.strictEqual(response.status, 500);
  assert.deepStrictEqual(await response.json(), { error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// POST /api/events
// ---------------------------------------------------------------------------

test('creating an event answers 401 with no session', async () => {
  reset();

  const response = await createEvent(postRequest(validBody()));

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(dbState.eventWrites, []);
});

test('creating an event answers 403 for a non-manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await createEvent(postRequest(validBody()));

  assert.strictEqual(response.status, 403);
  assert.deepStrictEqual(dbState.eventWrites, []);
});

test('creating an event answers 201 with the new id', async () => {
  reset();
  signInAsManager();
  dbState.eventWriteResult = { ok: true, id: EVENT_ID };

  const response = await createEvent(postRequest(validBody()));

  assert.strictEqual(response.status, 201);
  assert.deepStrictEqual(await response.json(), { ok: true, id: EVENT_ID });
});

test('the created event records the manager from the session, not the request', async () => {
  reset();
  signInAsManager();

  await createEvent(postRequest(validBody()));

  assert.strictEqual(dbState.eventWrites.length, 1);
  assert.strictEqual(dbState.eventWrites[0].createdBy, BASIL_ID);
});

test('an unknown key in the body is rejected, not ignored', async () => {
  // The schema is strict so that a client sending xpAmount learns this endpoint
  // does not accept one, rather than having it silently dropped.
  reset();
  signInAsManager();

  const response = await createEvent(
    postRequest({ ...validBody(), xpAmount: 500 })
  );

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(dbState.eventWrites, []);
});

test('an invalid body is rejected before anything is written', async () => {
  reset();
  signInAsManager();

  const invalid = [
    {},
    { ...validBody(), title: '' },
    { ...validBody(), title: '   ' },
    { ...validBody(), title: 'a'.repeat(EVENT_TITLE_MAX + 1) },
    { ...validBody(), eventType: 'retired-type' },
    { ...validBody(), eventType: '' },
    { ...validBody(), eventDate: '2026-02-31' },
    { ...validBody(), eventDate: '18/09/2026' },
    { ...validBody(), activityCode: '' },
    { ...validBody(), activityCode: 'not-an-activity' },
  ];

  for (const body of invalid) {
    const response = await createEvent(postRequest(body));

    assert.strictEqual(response.status, 400, JSON.stringify(body));
  }

  assert.deepStrictEqual(dbState.eventWrites, [], 'nothing may be written');
});

test('a malformed JSON body is a 400, not a 500', async () => {
  reset();
  signInAsManager();

  const response = await createEvent(
    new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })
  );

  assert.strictEqual(response.status, 400);
});

test('the activity code is checked against the Handbook list', async () => {
  reset();
  signInAsManager();

  const response = await createEvent(
    postRequest(validBody({ activityCode: 'a-code-that-does-not-exist' }))
  );

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(await response.json(), { error: 'Unknown activity code' });
  assert.deepStrictEqual(dbState.eventWrites, []);
});

test('every Handbook activity can be attached to an event', async () => {
  for (const activity of XP_ACTIVITIES) {
    reset();
    signInAsManager();

    const response = await createEvent(
      postRequest(validBody({ activityCode: activity.code }))
    );

    assert.strictEqual(response.status, 201, activity.code);
  }
});

test('the body is trimmed and normalized before the write', async () => {
  reset();
  signInAsManager();

  await createEvent(
    postRequest({
      title: '  Padded title  ',
      eventType: 'workshop',
      eventDate: '  2026-09-18  ',
      activityCode: '  membership  ',
    })
  );

  assert.deepStrictEqual(dbState.eventWrites[0], {
    title: 'Padded title',
    eventType: 'workshop',
    eventDate: '2026-09-18',
    activityCode: 'membership',
    createdBy: BASIL_ID,
  });
});

test('creating an event answers 500 when the write fails', async () => {
  reset();
  signInAsManager();
  dbState.eventWriteResult = { ok: false };

  const response = await createEvent(postRequest(validBody()));

  assert.strictEqual(response.status, 500);
  assert.deepStrictEqual(await response.json(), { error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// The phase boundary: no XP is written
// ---------------------------------------------------------------------------

test('creating an event writes no XP', async () => {
  // Phase 7A creates events. Awarding attendance is Phase 7B and must not have
  // leaked in: if this ever fails, an event was created and someone was paid
  // for it in the same request.
  reset();
  signInAsManager();

  await createEvent(postRequest(validBody()));

  assert.deepStrictEqual(dbState.writes, [], 'no ledger entry may be written');
});

test('the event body cannot carry an XP amount', async () => {
  // The amount is resolved from the activity code at award time, so a client
  // must not be able to name a value at all.
  reset();
  signInAsManager();

  for (const key of ['xpAmount', 'xp', 'correctionXp']) {
    reset();
    signInAsManager();

    const response = await createEvent(postRequest({ ...validBody(), [key]: 9999 }));

    assert.strictEqual(response.status, 400, key);
  }
});
