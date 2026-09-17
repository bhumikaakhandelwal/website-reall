// Phase 4: route-level tests for GET /api/leaderboard.
//
// These drive the real route handler with the `@/lib/db/queries` double, so
// they cover the authorization check, the Handbook board wiring, rank
// assignment and the empty/error states. The mapping from supabase-js's raw
// `data` to `LeaderboardRow` lives in the real `lib/db/queries.ts` and is
// covered separately by tests/leaderboard-query-shape.test.mjs.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';

import { GET as getLeaderboard } from '@/app/api/leaderboard/route';
import { LEADERBOARDS } from '@/lib/xp/leaderboards.ts';

const MEMBER_1 = '11111111-1111-4111-8111-111111111111';
const MEMBER_2 = '22222222-2222-4222-8222-222222222222';
const MEMBER_3 = '33333333-3333-4333-8333-333333333333';
const MEMBER_4 = '44444444-4444-4444-8444-444444444444';

/** Key the overall board's rows are seeded under (it passes `null` codes). */
const OVERALL = 'null';
/** Key the hackathon board's rows are seeded under. */
const HACKATHON = [
  'external-contest-hackathon',
  'hackathon-finals',
  'win-hackathon',
].join(',');

test('GET /api/leaderboard: 401 without a session', async () => {
  resetDbState();
  authState.memberId = null; // No session

  const res = await getLeaderboard();
  assert.strictEqual(res.status, 401);
});

test('GET /api/leaderboard: returns empty boards when no XP earned', async () => {
  resetDbState();
  authState.memberId = 'member-1'; // Valid session

  const res = await getLeaderboard();
  assert.strictEqual(res.status, 200);

  const payload = await res.json();
  assert.deepStrictEqual(payload.boards.length, 3);
  for (const board of payload.boards) {
    assert.deepStrictEqual(board.entries, []);
  }
});

test('GET /api/leaderboard: answers all three Handbook boards in order', async () => {
  resetDbState();
  authState.memberId = 'member-1';

  const res = await getLeaderboard();
  const payload = await res.json();

  assert.deepStrictEqual(
    payload.boards.map((board) => board.id),
    LEADERBOARDS.map((board) => board.id)
  );

  // Each board is asked for once, with its own activity codes.
  assert.strictEqual(dbState.leaderboardCalls.length, 3);
  assert.deepStrictEqual(
    dbState.leaderboardCalls.map((call) => call.activityCodes),
    LEADERBOARDS.map((board) => board.activityCodes)
  );
});

test('GET /api/leaderboard: ranks a populated board and shares ties', async () => {
  resetDbState();
  authState.memberId = 'member-1';

  // Basil 300, Aisha 300 (tie -> both rank 1), Cyril 120 -> rank 3.
  dbState.leaderboardRows.set(OVERALL, [
    { memberId: MEMBER_1, displayName: 'Basil', xp: 300 },
    { memberId: MEMBER_2, displayName: 'Aisha', xp: 300 },
    { memberId: MEMBER_3, displayName: 'Cyril', xp: 120 },
  ]);

  const res = await getLeaderboard();
  assert.strictEqual(res.status, 200);

  const payload = await res.json();
  const overall = payload.boards.find((board) => board.id === 'overall');

  // Standard competition ranking: ties share a rank and the next rank skips.
  assert.deepStrictEqual(overall.entries, [
    { memberId: MEMBER_1, displayName: 'Basil', xp: 300, rank: 1 },
    { memberId: MEMBER_2, displayName: 'Aisha', xp: 300, rank: 1 },
    { memberId: MEMBER_3, displayName: 'Cyril', xp: 120, rank: 3 },
  ]);
});

test('GET /api/leaderboard: reports the same ties on a restricted board', async () => {
  resetDbState();
  authState.memberId = 'member-1';

  dbState.leaderboardRows.set(HACKATHON, [
    { memberId: MEMBER_1, displayName: 'Basil', xp: 100 },
    { memberId: MEMBER_2, displayName: 'Aisha', xp: 100 },
    { memberId: MEMBER_3, displayName: 'Cyril', xp: 100 },
    { memberId: MEMBER_4, displayName: 'Devika', xp: 40 },
  ]);

  const res = await getLeaderboard();
  const payload = await res.json();
  const hackathon = payload.boards.find(
    (board) => board.id === 'hackathon'
  );

  // A three-way tie takes ranks 1, 1, 1; the next distinct XP continues at 4.
  assert.deepStrictEqual(
    hackathon.entries.map((entry) => entry.rank),
    [1, 1, 1, 4]
  );

  // The open-source board keeps its own, distinct data.
  const openSource = payload.boards.find(
    (board) => board.id === 'open-source'
  );
  assert.deepStrictEqual(openSource.entries, []);
});

test('GET /api/leaderboard: returns the current UTC month as a half-open range', async () => {
  resetDbState();
  authState.memberId = 'member-1';

  const res = await getLeaderboard();
  const payload = await res.json();

  const start = new Date(payload.period.start);
  const end = new Date(payload.period.end);

  assert.strictEqual(start.getUTCDate(), 1);
  assert.strictEqual(start.getUTCHours(), 0);
  assert.strictEqual(start.getUTCMinutes(), 0);
  assert.strictEqual(start.getUTCSeconds(), 0);
  assert.strictEqual(start.getUTCMilliseconds(), 0);

  // The end is the first instant of the next month, exclusive.
  assert.strictEqual(end.getUTCDate(), 1);
  assert.strictEqual(end.getUTCHours(), 0);
  assert.ok(end > start);
  assert.strictEqual((end.getUTCMonth() - start.getUTCMonth() + 12) % 12, 1);
});

test('GET /api/leaderboard: every board read uses the same period', async () => {
  resetDbState();
  authState.memberId = 'member-1';

  await getLeaderboard();

  const [first] = dbState.leaderboardCalls;
  for (const call of dbState.leaderboardCalls) {
    assert.deepStrictEqual(call.period.start, first.period.start);
    assert.deepStrictEqual(call.period.end, first.period.end);
  }
});

test('GET /api/leaderboard: 500 when the aggregation is unavailable', async () => {
  resetDbState();
  authState.memberId = 'member-1';
  dbState.leaderboardFails = true;

  const res = await getLeaderboard();

  // A failed read must not render as an empty leaderboard.
  assert.strictEqual(res.status, 500);
  const payload = await res.json();
  assert.strictEqual(payload.error, 'Internal server error');
});
