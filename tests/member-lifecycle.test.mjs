// Phase 8E: the member lifecycle (archive / restore).
//
// Two halves in one file, because they cover one feature:
//
//   1. the pure logic in lib/members/lifecycle.ts. This project has no DOM test
//      environment (Node's type stripping does not transform JSX, so a .tsx
//      component cannot be imported into a test at all), so the split, the copy
//      and the client calls live there and are asserted on here.
//
//   2. the routes and the guards, run for real against in-memory doubles.
//
// The rules this file exists to pin: archiving is REVERSIBLE and destroys
// nothing, an archived member is refused NEW XP and NEW attendance but keeps
// everything they already had, and there is no delete anywhere.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';
import { resetAdminState } from './doubles/supabase-admin.ts';
import { resetServerAuthState } from './doubles/supabase-server.ts';

import {
  ARCHIVE_CONSEQUENCE,
  ARCHIVED_REFUSAL,
  activeMembers,
  archivedMembers,
  archiveMember,
  canArchive,
  describeArchive,
  describeRestore,
  isActive,
  isArchived,
  restoreMember,
  splitByArchive,
} from '@/lib/members/lifecycle';
import { PATCH as archiveRoute } from '@/app/api/manager/members/[id]/archive/route';
import { PATCH as restoreRoute } from '@/app/api/manager/members/[id]/restore/route';
import { GET as rosterRoute, POST as addMemberRoute } from '@/app/api/manager/members/route';
import { GET as directoryRoute } from '@/app/api/members/route';
import { POST as awardRoute } from '@/app/api/xp/award/route';
import {
  GET as attendanceRead,
  PUT as attendanceWrite,
} from '@/app/api/events/[id]/attendance/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const ARCHIVED_AT = '2026-09-20T10:00:00.000Z';
/** The Supabase Auth user id, which is NOT the same as a members id. */
const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

function reset() {
  resetDbState();
  resetAdminState();
  resetServerAuthState();
  authState.memberId = null;
}

function signInAs(profile) {
  authState.memberId = profile ? profile.id : null;
}

function signInAsManager(profile = BASIL) {
  signInAs(profile);
  dbState.profile = profile;
}

function context(id) {
  return { params: Promise.resolve({ id }) };
}

function request(method, url, body) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function fetchStub(status, body) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** A directory row. Active unless `archivedAt` is given. */
function row(overrides = {}) {
  return {
    memberId: MEMBER_ID,
    email: 'ordinary-member@dbcegoa.ac.in',
    displayName: 'Ordinary Member',
    membershipStatus: 'active',
    joinedAt: '2026-09-01T00:00:00Z',
    totalXp: 150,
    archivedAt: null,
    ...overrides,
  };
}

/** What the archive/restore statement returns on success. */
function archiveRecord(overrides = {}) {
  return {
    ok: true,
    member: {
      memberId: MEMBER_ID,
      email: 'ordinary-member@dbcegoa.ac.in',
      displayName: 'Ordinary Member',
      membershipStatus: 'active',
      archivedAt: ARCHIVED_AT,
      archivedBy: BASIL_ID,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

test('a member with no archived_at is active', () => {
  assert.strictEqual(isArchived(row()), false);
  assert.strictEqual(isActive(row()), true);
});

test('a member with an archived_at is archived', () => {
  assert.strictEqual(isArchived(row({ archivedAt: ARCHIVED_AT })), true);
  assert.strictEqual(isActive(row({ archivedAt: ARCHIVED_AT })), false);
});

test('the split keeps the order the roster was read in', () => {
  const roster = [
    row({ memberId: 'a', displayName: 'A' }),
    row({ memberId: 'b', displayName: 'B', archivedAt: ARCHIVED_AT }),
    row({ memberId: 'c', displayName: 'C' }),
    row({ memberId: 'd', displayName: 'D', archivedAt: ARCHIVED_AT }),
  ];

  const groups = splitByArchive(roster);

  assert.deepStrictEqual(groups.active.map((m) => m.memberId), ['a', 'c']);
  assert.deepStrictEqual(groups.archived.map((m) => m.memberId), ['b', 'd']);
});

test('the split of nothing is two empty lists', () => {
  assert.deepStrictEqual(splitByArchive([]), { active: [], archived: [] });
});

test('every member lands in exactly one list', () => {
  // The split and the predicate must agree, or a member could vanish from both
  // lists - or, worse, appear in both.
  for (const member of [row(), row({ archivedAt: ARCHIVED_AT })]) {
    const groups = splitByArchive([member]);
    const inArchived = groups.archived.length === 1;

    assert.strictEqual(inArchived, isArchived(member));
    assert.strictEqual(groups.active.length + groups.archived.length, 1);
  }
});

test('the split does not mutate the roster', () => {
  const roster = [row(), row({ memberId: 'b', archivedAt: ARCHIVED_AT })];
  const before = JSON.stringify(roster);

  splitByArchive(roster);

  assert.strictEqual(JSON.stringify(roster), before);
});

test('activeMembers and archivedMembers agree with the split', () => {
  const roster = [row({ memberId: 'a' }), row({ memberId: 'b', archivedAt: ARCHIVED_AT })];

  assert.deepStrictEqual(
    activeMembers(roster).map((m) => m.memberId),
    splitByArchive(roster).active.map((m) => m.memberId)
  );
  assert.deepStrictEqual(
    archivedMembers(roster).map((m) => m.memberId),
    splitByArchive(roster).archived.map((m) => m.memberId)
  );
});

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

test('the archive confirmation names the member and states both consequences', () => {
  assert.strictEqual(describeArchive('Sarah'), 'Archive Sarah?');

  // Gone from the working lists AND history preserved - both, because
  // "archive" could reasonably be read as either.
  assert.match(ARCHIVE_CONSEQUENCE, /active member list and future attendance/);
  assert.match(ARCHIVE_CONSEQUENCE, /all XP and event history will be preserved/);
});

test('the restore sentence says the member is back', () => {
  assert.match(describeRestore('Sarah'), /back on the active member list/);
});

test('the refusal explains what to do about it', () => {
  assert.match(ARCHIVED_REFUSAL, /cannot receive new XP or be added to attendance/);
  assert.match(ARCHIVED_REFUSAL, /Restore them first/);
});

test('a manager cannot archive their own row', () => {
  assert.strictEqual(canArchive(MEMBER_ID, BASIL_ID), true);
  assert.strictEqual(canArchive(BASIL_ID, BASIL_ID), false);
  assert.strictEqual(canArchive(MEMBER_ID, null), true);
});

// ---------------------------------------------------------------------------
// The client calls
// ---------------------------------------------------------------------------

test('archiveMember PATCHes the archive path with no body', async () => {
  let captured = null;

  const outcome = await archiveMember(MEMBER_ID, 'Sarah', async (url, init) => {
    captured = { url, method: init.method };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(captured.method, 'PATCH');
  assert.strictEqual(captured.url, `/api/manager/members/${MEMBER_ID}/archive`);
  assert.match(outcome.message, /Archived Sarah/);
});

test('restoreMember PATCHes the restore path', async () => {
  let captured = null;

  await restoreMember(MEMBER_ID, 'Sarah', async (url, init) => {
    captured = { url, method: init.method };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(captured.url, `/api/manager/members/${MEMBER_ID}/restore`);
});

test('the client maps each failure', async () => {
  for (const [status, kind] of [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [500, 'unavailable'],
  ]) {
    const outcome = await archiveMember(MEMBER_ID, 'Sarah', fetchStub(status, {}));

    assert.strictEqual(outcome.kind, kind, String(status));
  }
});

test('the client reports a double archive as a conflict, not a crash', async () => {
  const outcome = await archiveMember(MEMBER_ID, 'Sarah', fetchStub(409, {}));

  assert.match(outcome.message, /already archived/);
});

test('the client reports a double restore as already active', async () => {
  const outcome = await restoreMember(MEMBER_ID, 'Sarah', fetchStub(409, {}));

  assert.match(outcome.message, /already active/);
});

// ---------------------------------------------------------------------------
// PATCH /api/manager/members/[id]/archive
// ---------------------------------------------------------------------------

test('archiving answers 401 with no session and 403 for a non-manager', async () => {
  reset();
  assert.strictEqual((await archiveRoute(request('PATCH', '/x'), context(MEMBER_ID))).status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  assert.strictEqual((await archiveRoute(request('PATCH', '/x'), context(MEMBER_ID))).status, 403);
  assert.deepStrictEqual(dbState.archiveCalls, []);
});

test('archiving answers 404 for an id that is not a member id', async () => {
  reset();
  signInAsManager();

  assert.strictEqual((await archiveRoute(request('PATCH', '/x'), context('nope'))).status, 404);
  assert.deepStrictEqual(dbState.archiveCalls, []);
});

test('archiving records who did it and returns the updated member', async () => {
  reset();
  signInAsManager();
  dbState.lifecycleResult = archiveRecord();

  const response = await archiveRoute(request('PATCH', '/x'), context(MEMBER_ID));
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.member.archivedAt, ARCHIVED_AT);

  // The manager's AUTH USER id, from the session - never from the request, and
  // NOT their members.id.
  //
  // This assertion previously expected BASIL_ID (the members id) and so encoded
  // the bug: `archived_by` references `auth.users(id)`, and a members id is a
  // different uuid, so every archive failed the foreign key and the route
  // answered 500.
  assert.deepStrictEqual(dbState.archiveCalls, [
    { memberId: MEMBER_ID, archivedBy: AUTH_USER_ID },
  ]);
});

test('archiving twice is refused as a conflict', async () => {
  reset();
  signInAsManager();
  dbState.lifecycleResult = { ok: false, outcome: 'no_change' };

  // The manager stays the profile: the route re-reads the member on this path
  // to tell "already archived" from "no such member", and the double's single
  // profile slot drives both that lookup and the session.
  const response = await archiveRoute(request('PATCH', '/x'), context(MEMBER_ID));

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Member is already archived' });
});

// NOT TESTED HERE: the "no such member" half of the 409/404 branch. The double
// has one profile slot, so emptying it to make the target lookup miss also
// empties the SESSION - and the route answers 401 before it ever reaches the
// branch. The branch is still reachable in production (an archive of a member
// deleted out from under the manager) and its other half, "already archived",
// is covered above. The invalid-uuid 404 test covers the route's other 404.

test('a manager cannot archive themselves', async () => {
  // With only two managers, this is easy to do by accident and would hide them
  // from the list they are standing on.
  reset();
  signInAsManager(BASIL);

  const response = await archiveRoute(request('PATCH', '/x'), context(BASIL_ID));

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(dbState.archiveCalls, []);
});

test('archiving writes no XP and touches no history', async () => {
  reset();
  signInAsManager();
  dbState.lifecycleResult = archiveRecord();

  await archiveRoute(request('PATCH', '/x'), context(MEMBER_ID));

  assert.deepStrictEqual(dbState.writes, [], 'no XP may be written');
  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
  assert.deepStrictEqual(dbState.deleteEventCalls, []);
});

// ---------------------------------------------------------------------------
// PATCH /api/manager/members/[id]/restore
// ---------------------------------------------------------------------------

test('restoring answers 401, 403 and 404', async () => {
  reset();
  assert.strictEqual((await restoreRoute(request('PATCH', '/x'), context(MEMBER_ID))).status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  assert.strictEqual((await restoreRoute(request('PATCH', '/x'), context(MEMBER_ID))).status, 403);

  reset();
  signInAsManager();
  assert.strictEqual((await restoreRoute(request('PATCH', '/x'), context('nope'))).status, 404);
});

test('restoring clears the archive and returns the member', async () => {
  reset();
  signInAsManager();
  dbState.lifecycleResult = archiveRecord({ archivedAt: null, archivedBy: null });

  const response = await restoreRoute(request('PATCH', '/x'), context(MEMBER_ID));
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(payload.member.archivedAt, null);
  assert.deepStrictEqual(dbState.restoreCalls, [MEMBER_ID]);
});

test('restoring an active member is a conflict, not a second restore', async () => {
  reset();
  signInAsManager();
  dbState.lifecycleResult = { ok: false, outcome: 'no_change' };

  const response = await restoreRoute(request('PATCH', '/x'), context(MEMBER_ID));

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Member is already active' });
});

test('restoring re-awards nothing', async () => {
  // The member's XP was never removed, so putting it back would be exactly the
  // double-award the ledger is designed against.
  reset();
  signInAsManager();
  dbState.lifecycleResult = archiveRecord({ archivedAt: null, archivedBy: null });

  await restoreRoute(request('PATCH', '/x'), context(MEMBER_ID));

  assert.deepStrictEqual(dbState.writes, []);
});

test('there is no delete endpoint for members', async () => {
  // The lifecycle has exactly two verbs, and neither removes anything. This is
  // asserted because the brief is explicit that members are never deleted.
  const { default: fs } = await import('node:fs');

  for (const dir of [
    'app/api/manager/members/[id]/archive',
    'app/api/manager/members/[id]/restore',
  ]) {
    const source = fs.readFileSync(new URL(`../${dir}/route.ts`, import.meta.url), 'utf8');

    assert.ok(!/export async function DELETE/.test(source), `${dir} must not export DELETE`);
  }
});

// ---------------------------------------------------------------------------
// GET /api/manager/members
// ---------------------------------------------------------------------------

test('the lifecycle roster answers 401 and 403', async () => {
  reset();
  assert.strictEqual((await rosterRoute()).status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  assert.strictEqual((await rosterRoute()).status, 403);
});

test('the lifecycle roster splits active from archived', async () => {
  reset();
  signInAsManager();
  dbState.directoryRows = [
    row({ memberId: 'a', displayName: 'Active One' }),
    row({ memberId: 'b', displayName: 'Archived One', archivedAt: ARCHIVED_AT }),
  ];

  const response = await rosterRoute();
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.active.map((m) => m.memberId), ['a']);
  assert.deepStrictEqual(payload.archived.map((m) => m.memberId), ['b']);

  // The viewer's own id, so the page can disable archiving itself.
  assert.strictEqual(payload.viewerId, BASIL_ID);
});

test('a member appears in exactly one of the two lists', async () => {
  reset();
  signInAsManager();
  dbState.directoryRows = [
    row({ memberId: 'a' }),
    row({ memberId: 'b', archivedAt: ARCHIVED_AT }),
    row({ memberId: 'c' }),
  ];

  const payload = await (await rosterRoute()).json();

  const ids = [...payload.active, ...payload.archived].map((m) => m.memberId);

  assert.deepStrictEqual([...ids].sort(), ['a', 'b', 'c']);
  assert.strictEqual(new Set(ids).size, ids.length, 'no member may appear twice');
});

// ---------------------------------------------------------------------------
// Query shape: the working lists exclude archived members
// ---------------------------------------------------------------------------

test('the member directory excludes archived members', async () => {
  reset();
  signInAsManager();
  dbState.directoryRows = [
    row({ memberId: 'a' }),
    row({ memberId: 'b', archivedAt: ARCHIVED_AT }),
  ];
  dbState.levels = [{ level: 1, title: 'Initiate', min_xp: 0, max_xp: null }];

  const payload = await (await directoryRoute()).json();

  assert.deepStrictEqual(payload.entries.map((m) => m.memberId), ['a']);
});

test('the attendance checklist excludes archived members', async () => {
  reset();
  signInAsManager();
  dbState.eventById = {
    id: EVENT_ID,
    title: 'git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-15',
    activityCode: 'membership',
    createdBy: BASIL_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    archivedAt: null,
    archivedBy: null,
  };
  dbState.directoryRows = [
    row({ memberId: 'a', displayName: 'Active One' }),
    row({ memberId: 'b', displayName: 'Archived One', archivedAt: ARCHIVED_AT }),
  ];
  dbState.attendanceRows = [];

  const response = await attendanceRead(
    new Request('http://localhost/x'),
    context(EVENT_ID)
  );
  const payload = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(payload.members.map((m) => m.memberId), ['a']);
});

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

test('an archived member cannot receive new XP', async () => {
  reset();
  signInAsManager();
  dbState.directoryRows = [row({ memberId: MEMBER_ID, archivedAt: ARCHIVED_AT })];

  const response = await awardRoute(
    request('POST', '/api/xp/award', {
      memberId: MEMBER_ID,
      activityCode: 'github-project',
    })
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Member is archived' });

  // Refused BEFORE the ledger was touched, so there is nothing to undo and the
  // ledger stays append-only.
  assert.deepStrictEqual(dbState.writes, []);
});

test('an active member can still receive XP', async () => {
  reset();
  signInAsManager();
  dbState.directoryRows = [row({ memberId: MEMBER_ID, archivedAt: null })];
  dbState.writeResult = { ok: true };

  const response = await awardRoute(
    request('POST', '/api/xp/award', {
      memberId: MEMBER_ID,
      activityCode: 'github-project',
    })
  );

  assert.strictEqual(response.status, 201);
  assert.strictEqual(dbState.writes.length, 1);
});

test('an archived member cannot be newly marked present', async () => {
  reset();
  signInAsManager();
  dbState.eventById = {
    id: EVENT_ID,
    title: 'git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-15',
    activityCode: 'membership',
    createdBy: BASIL_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    archivedAt: null,
    archivedBy: null,
  };
  dbState.directoryRows = [row({ memberId: MEMBER_ID, archivedAt: ARCHIVED_AT })];

  const response = await attendanceWrite(
    request('PUT', '/x', { memberIds: [MEMBER_ID] }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Member is archived' });

  // Nothing was written, so existing attendance is untouched.
  assert.deepStrictEqual(dbState.setAttendanceCalls, []);
});

test('an active member can still be marked present', async () => {
  reset();
  signInAsManager();
  dbState.eventById = {
    id: EVENT_ID,
    title: 'git workshop',
    eventType: 'workshop',
    eventDate: '2026-09-15',
    activityCode: 'membership',
    createdBy: BASIL_ID,
    createdAt: '2026-09-01T10:00:00.000Z',
    archivedAt: null,
    archivedBy: null,
  };
  dbState.directoryRows = [row({ memberId: MEMBER_ID, archivedAt: null })];
  dbState.setAttendanceResult = { ok: true, added: 1, removed: 0, keptAwarded: 0 };

  const response = await attendanceWrite(
    request('PUT', '/x', { memberIds: [MEMBER_ID] }),
    context(EVENT_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.strictEqual(dbState.setAttendanceCalls.length, 1);
});

test('adding an archived member again points at Restore, not "duplicate"', async () => {
  // members.email stays UNIQUE - it is the roster's identity key - so the useful
  // thing to tell the manager is where the person actually is.
  reset();
  signInAsManager();
  dbState.memberWriteResult = { ok: false, duplicate: true };
  dbState.directoryRows = [
    row({ memberId: MEMBER_ID, email: 'sarah@dbcegoa.ac.in', archivedAt: ARCHIVED_AT }),
  ];

  const response = await addMemberRoute(
    request('POST', '/api/manager/members', {
      displayName: 'Sarah',
      email: 'sarah@dbcegoa.ac.in',
    })
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), {
    error: 'Member is archived',
    memberId: MEMBER_ID,
  });

  assert.deepStrictEqual(dbState.writes, [], 'no second Membership award');
});
