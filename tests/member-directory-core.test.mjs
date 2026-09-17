// Phase 5A: route-level tests for GET /api/members.
//
// These drive the real route handler with the `@/lib/db/queries` double, so
// they cover the authorization chain (401 -> 401 -> 403), the empty and error
// states, and the level each row is given. The mapping from supabase-js's raw
// `data` to `MemberDirectoryRow` lives in the real `lib/db/queries.ts` and is
// covered separately by tests/member-directory-query-shape.test.mjs.
//
// The directory is the only endpoint in the app that returns other members'
// data, so the negative cases here matter more than the positive one: a normal
// member must not be able to read the roster, and must not be able to talk
// their way in through the request.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import { GET as getMembers } from '@/app/api/members/route';

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

const BHUMIKA = {
  ...BASIL,
  id: '22222222-2222-4222-8222-222222222222',
  email: '2414012@dbcegoa.ac.in',
  display_name: 'Bhumika Khandelwal',
};

// Synthetic identities only. The two manager addresses are the ones the
// allowlist itself names (lib/xp/managers.ts); everyone else here is invented.
const MEMBER = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'ordinary-member@dbcegoa.ac.in',
  display_name: 'Ordinary Member',
  membership_status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const ROSTER = [
  {
    memberId: BASIL.id,
    email: BASIL.email,
    displayName: 'Basil Shaikh Mohammad',
    membershipStatus: 'active',
    joinedAt: '2026-07-01T00:00:00Z',
    totalXp: 750,
  },
  {
    memberId: MEMBER.id,
    email: MEMBER.email,
    displayName: 'Ordinary Member',
    membershipStatus: 'pending',
    joinedAt: '2026-08-15T00:00:00Z',
    totalXp: 0,
  },
];

function signInAs(profile) {
  authState.memberId = profile ? profile.id : null;
}

function reset() {
  resetDbState();
  authState.memberId = null;
}

test('GET /api/members: 401 without a session, and reads nothing', async () => {
  reset();

  const response = await getMembers();

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(dbState.profileLookups, []);
  assert.strictEqual(dbState.directoryCalls, 0);
});

test('GET /api/members: 403 for a signed-in non-manager, and reads nothing', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;

  const response = await getMembers();

  assert.strictEqual(response.status, 403);

  // Authorization is decided before the roster is touched.
  assert.strictEqual(dbState.directoryCalls, 0);
});

test('GET /api/members: a member cannot promote themselves in the request', async () => {
  reset();
  signInAs(MEMBER);
  dbState.profile = MEMBER;

  // There is no body or query parameter this route reads, but pass one anyway:
  // the authorization decision must come from the session-resolved email alone.
  const response = await getMembers(
    new Request(
      `http://localhost/api/members?email=${BASIL.email}&isManager=true`
    )
  );

  assert.strictEqual(response.status, 403);
  assert.strictEqual(dbState.directoryCalls, 0);
});

test('GET /api/members: a stale session that resolves to no member is 401', async () => {
  reset();
  // Cookie verifies, but the member it names is gone.
  authState.memberId = MEMBER.id;
  dbState.profile = null;

  const response = await getMembers();

  assert.strictEqual(response.status, 401);
  assert.strictEqual(dbState.directoryCalls, 0);
});

test('GET /api/members: a manager sees the whole roster with levels', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.levels = LEVELS;
  dbState.directoryRows = ROSTER;

  const response = await getMembers();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.entries, [
    {
      memberId: BASIL.id,
      email: BASIL.email,
      displayName: 'Basil Shaikh Mohammad',
      membershipStatus: 'active',
      joinedAt: '2026-07-01T00:00:00Z',
      totalXp: 750,
      level: 2,
      levelName: 'Novice Coder',
    },
    {
      memberId: MEMBER.id,
      email: MEMBER.email,
      displayName: 'Ordinary Member',
      membershipStatus: 'pending',
      joinedAt: '2026-08-15T00:00:00Z',
      totalXp: 0,
      level: 1,
      levelName: 'Rookie',
    },
  ]);
});

test('GET /api/members: the second manager is authorized too', async () => {
  reset();
  signInAs(BHUMIKA);
  dbState.profile = BHUMIKA;
  dbState.levels = LEVELS;
  dbState.directoryRows = ROSTER;

  const response = await getMembers();

  assert.strictEqual(response.status, 200);
});

test('GET /api/members: a pending member is listed, not filtered out', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.levels = LEVELS;
  dbState.directoryRows = ROSTER;

  const payload = await (await getMembers()).json();

  // The directory is the whole roster: membership_status explains a missing
  // leaderboard entry rather than hiding the member.
  assert.strictEqual(payload.entries.length, 2);
  assert.ok(
    payload.entries.some((entry) => entry.membershipStatus === 'pending')
  );
});

test('GET /api/members: a zero total is level 1, and a negative total falls back to level 1', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.levels = LEVELS;
  dbState.directoryRows = [
    { ...ROSTER[0], totalXp: 0 },
    { ...ROSTER[0], memberId: MEMBER.id, totalXp: -40 },
  ];

  const payload = await (await getMembers()).json();

  assert.deepStrictEqual(
    payload.entries.map((entry) => entry.level),
    [1, 1]
  );
});

test('GET /api/members: rows reach the top level', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.levels = LEVELS;
  dbState.directoryRows = [{ ...ROSTER[0], totalXp: 5000 }];

  const payload = await (await getMembers()).json();

  assert.strictEqual(payload.entries[0].level, 7);
  assert.strictEqual(payload.entries[0].levelName, 'Coding Legend');
});

test('GET /api/members: an empty roster is an empty list, not an error', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.levels = LEVELS;
  dbState.directoryRows = [];

  const response = await getMembers();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.entries, []);
});

test('GET /api/members: 500 when the directory read fails', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.levels = LEVELS;
  dbState.directoryFails = true;

  const response = await getMembers();

  // A failed read must not render as an empty roster.
  assert.strictEqual(response.status, 500);
  const payload = await response.json();
  assert.strictEqual(payload.error, 'Internal server error');
});

test('GET /api/members: 500 when the levels table is not seeded', async () => {
  reset();
  signInAs(BASIL);
  dbState.profile = BASIL;
  dbState.directoryRows = ROSTER;
  dbState.levels = [];

  // Without levels the level column would be a guess, so this is an error.
  assert.strictEqual((await getMembers()).status, 500);
});
