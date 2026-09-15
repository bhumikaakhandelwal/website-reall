// Phase 3 route tests: GET /api/xp/me and POST /api/xp/award.
//
// These import the real route handlers and run the real authorization,
// validation, and XP-amount resolution code. Only the Supabase data-access
// boundary and the session reader are replaced with in-memory doubles
// (tests/doubles/, wired up by tests/helpers/hooks.mjs), so no request reaches
// the network and nothing is ever written to the production member roster.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import { GET as getMyXp } from '@/app/api/xp/me/route';
import { POST as awardXp } from '@/app/api/xp/award/route';

const LEVELS = [
  { id: 1, title: 'Rookie', xp_required: 0, sort_order: 1 },
  { id: 2, title: 'Novice Coder', xp_required: 500, sort_order: 2 },
  { id: 3, title: 'Code Explorer', xp_required: 1000, sort_order: 3 },
  { id: 4, title: 'Code Warrior', xp_required: 2000, sort_order: 4 },
  { id: 5, title: 'Coding Champion', xp_required: 3000, sort_order: 5 },
  { id: 6, title: 'Code Master', xp_required: 4000, sort_order: 6 },
  { id: 7, title: 'Coding Legend', xp_required: 5000, sort_order: 7 },
];

const BASIL = {
  id: '11111111-1111-4111-8111-111111111111',
  email: '2414011@dbcegoa.ac.in',
  display_name: 'Basil Shaikh Mohammad',
  membership_status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

// Synthetic identities only. The two manager addresses are the ones the
// allowlist itself names (lib/xp/managers.ts); everyone else here is invented,
// so no real roster entry is used as a test fixture.
const MEMBER = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'ordinary-member@dbcegoa.ac.in',
  display_name: 'Ordinary Member',
  membership_status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const BHUMIKA = {
  ...BASIL,
  id: '22222222-2222-4222-8222-222222222222',
  email: '2414012@dbcegoa.ac.in',
  display_name: 'Bhumika Khandelwal',
};

const OTHER_MEMBER_ID = '99999999-9999-4999-8999-999999999999';

function signInAs(profile) {
  authState.memberId = profile ? profile.id : null;
}

function awardRequest(body, url = 'http://localhost/api/xp/award') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reset() {
  resetDbState();
  authState.memberId = null;
}

// ---------------------------------------------------------------------------
// GET /api/xp/me
// ---------------------------------------------------------------------------

test('GET /api/xp/me: 401 without a session, and reads nothing', async () => {
  reset();

  const response = await getMyXp();

  assert.equal(response.status, 401);
  assert.deepEqual(dbState.profileLookups, []);
});

test('GET /api/xp/me: returns the member own total and level', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;
  dbState.totalXp = 750;
  dbState.levels = LEVELS;

  const response = await getMyXp();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    memberId: MEMBER.id,
    totalXp: 750,
    level: 2,
    levelName: 'Novice Coder',
    nextLevelXp: 1000,
  });
});

test('GET /api/xp/me: reports no next level at the top level', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;
  dbState.totalXp = 5000;
  dbState.levels = LEVELS;

  const body = await (await getMyXp()).json();

  assert.equal(body.level, 7);
  assert.equal(body.levelName, 'Coding Legend');
  assert.equal(body.nextLevelXp, null);
});

test('GET /api/xp/me: a member cannot ask for anyone else', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;
  dbState.totalXp = 100;
  dbState.levels = LEVELS;

  // A member id in the query string is ignored — identity is the session.
  const response = await getMyXp(
    new Request(`http://localhost/api/xp/me?memberId=${BASIL.id}`)
  );
  const body = await response.json();

  assert.equal(body.memberId, MEMBER.id);
  assert.deepEqual(dbState.profileLookups, [MEMBER.id]);
});

test('GET /api/xp/me: a manager gets their own XP too, not a lookup endpoint', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.totalXp = 5000;
  dbState.levels = LEVELS;

  // Being a manager does not turn this into a way to read other members.
  const response = await getMyXp(
    new Request(`http://localhost/api/xp/me?memberId=${MEMBER.id}`)
  );
  const body = await response.json();

  assert.equal(body.memberId, BASIL.id);
  assert.equal(body.totalXp, 5000);
  assert.deepEqual(dbState.profileLookups, [BASIL.id]);
});

test('GET /api/xp/me: a zero total is a level 1 member, not an error', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;
  dbState.totalXp = 0;
  dbState.levels = LEVELS;

  const response = await getMyXp();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.totalXp, 0);
  assert.equal(body.level, 1);
});

test('GET /api/xp/me: 500 when the ledger sum or levels cannot be read', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;
  dbState.totalXp = null; // read failure, distinguishable from a real 0
  dbState.levels = LEVELS;

  assert.equal((await getMyXp()).status, 500);

  dbState.totalXp = 100;
  dbState.levels = []; // levels table not seeded

  assert.equal((await getMyXp()).status, 500);
});

// ---------------------------------------------------------------------------
// POST /api/xp/award — authorization
// ---------------------------------------------------------------------------

test('POST /api/xp/award: 401 without a session, and writes nothing', async () => {
  reset();

  const response = await awardXp(
    awardRequest({ memberId: MEMBER.id, activityCode: 'github-project' })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: 403 for a signed-in non-manager, and writes nothing', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;

  const response = await awardXp(
    awardRequest({ memberId: MEMBER.id, activityCode: 'github-project' })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: a non-manager cannot promote themselves in the body', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;

  const response = await awardXp(
    awardRequest({
      memberId: MEMBER.id,
      activityCode: 'github-project',
      email: BASIL.email,
      isManager: true,
    })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: authorization is decided before the body is validated', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;

  // Garbage body from a non-manager is still 403, never a validation hint.
  const response = await awardXp(awardRequest({ nonsense: true }));

  assert.equal(response.status, 403);
});

// ---------------------------------------------------------------------------
// POST /api/xp/award — awarding
// ---------------------------------------------------------------------------

test('POST /api/xp/award: a manager awards the Handbook amount for an activity', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const response = await awardXp(
    awardRequest({ memberId: MEMBER.id, activityCode: 'win-hackathon' })
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.xpAmount, 250); // Handbook value, resolved server-side
  assert.equal(body.activityCode, 'win-hackathon');

  assert.equal(dbState.writes.length, 1);
  assert.deepEqual(dbState.writes[0], {
    memberId: MEMBER.id,
    xpAmount: 250,
    activityCode: 'win-hackathon',
    reason: 'Win hackathon',
  });
});

test('POST /api/xp/award: the second manager is authorized too', async () => {
  reset();
  signInAs(BHUMIKA);
  dbState.profile = BHUMIKA;

  const response = await awardXp(
    awardRequest({ memberId: MEMBER.id, activityCode: 'membership' })
  );

  assert.equal(response.status, 201);
  assert.equal(dbState.writes[0].xpAmount, 50);
});

test('POST /api/xp/award: a client cannot choose the XP amount', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const response = await awardXp(
    awardRequest({
      memberId: MEMBER.id,
      activityCode: 'github-project',
      xpAmount: 9999, // ignored by the award path — rejected outright
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: an unknown activity code is rejected', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const response = await awardXp(
    awardRequest({ memberId: MEMBER.id, activityCode: 'free-xp-please' })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: a malformed or missing target member is rejected', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const malformed = await awardXp(
    awardRequest({ memberId: 'not-a-uuid', activityCode: 'membership' })
  );
  const missing = await awardXp(awardRequest({ activityCode: 'membership' }));

  assert.equal(malformed.status, 400);
  assert.equal(missing.status, 400);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: 404 when the target member does not exist', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.writeResult = { ok: false, memberNotFound: true };

  const response = await awardXp(
    awardRequest({ memberId: OTHER_MEMBER_ID, activityCode: 'membership' })
  );

  assert.equal(response.status, 404);
});

test('POST /api/xp/award: a failed write is a 500, not a silent success', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.writeResult = { ok: false, memberNotFound: false };

  const response = await awardXp(
    awardRequest({ memberId: MEMBER.id, activityCode: 'membership' })
  );

  assert.equal(response.status, 500);
});

// ---------------------------------------------------------------------------
// POST /api/xp/award — corrections
// ---------------------------------------------------------------------------

test('POST /api/xp/award: a manager can append a corrective entry', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const response = await awardXp(
    awardRequest({
      memberId: MEMBER.id,
      correctionXp: -50,
      reason: 'Duplicate GitHub project entry',
    })
  );

  assert.equal(response.status, 201);
  assert.deepEqual(dbState.writes[0], {
    memberId: MEMBER.id,
    xpAmount: -50,
    activityCode: null, // corrections are not handbook activities
    reason: 'Duplicate GitHub project entry',
  });
});

test('POST /api/xp/award: a correction requires a reason', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const noReason = await awardXp(
    awardRequest({ memberId: MEMBER.id, correctionXp: -50 })
  );
  const blankReason = await awardXp(
    awardRequest({ memberId: MEMBER.id, correctionXp: -50, reason: '   ' })
  );

  assert.equal(noReason.status, 400);
  assert.equal(blankReason.status, 400);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: a zero or oversized correction is rejected', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const zero = await awardXp(
    awardRequest({ memberId: MEMBER.id, correctionXp: 0, reason: 'oops' })
  );
  const huge = await awardXp(
    awardRequest({ memberId: MEMBER.id, correctionXp: -50000, reason: 'oops' })
  );
  const fractional = await awardXp(
    awardRequest({ memberId: MEMBER.id, correctionXp: -12.5, reason: 'oops' })
  );

  assert.equal(zero.status, 400);
  assert.equal(huge.status, 400);
  assert.equal(fractional.status, 400);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: the two request shapes are mutually exclusive', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const both = await awardXp(
    awardRequest({
      memberId: MEMBER.id,
      activityCode: 'membership',
      correctionXp: -50,
      reason: 'oops',
    })
  );

  assert.equal(both.status, 400);
  assert.deepEqual(dbState.writes, []);
});

test('POST /api/xp/award: a malformed body is rejected without touching the database', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;

  const notJson = new Request('http://localhost/api/xp/award', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json at all',
  });

  assert.equal((await awardXp(notJson)).status, 400);
  assert.equal((await awardXp(awardRequest(null))).status, 400);
  assert.deepEqual(dbState.writes, []);
});
