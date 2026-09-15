// Phase 3 unit tests: level boundaries, handbook XP amounts, and the XP
// manager allowlist.
//
// These cover the pure modules only — no database, no network, no Supabase.
// Level boundaries are asserted against the same seven definitions the
// `levels` table is seeded with (supabase/migrations/20260912000001_initial_schema.sql),
// so a drift between the two is caught here.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLevel } from '../lib/xp/levels.ts';
import { XP_ACTIVITIES, getXpActivity } from '../lib/xp/activities.ts';
import { isXpManager } from '../lib/xp/managers.ts';

// The seven Handbook levels, exactly as seeded in the levels table.
const LEVELS = [
  { id: 1, title: 'Rookie', xp_required: 0, sort_order: 1 },
  { id: 2, title: 'Novice Coder', xp_required: 500, sort_order: 2 },
  { id: 3, title: 'Code Explorer', xp_required: 1000, sort_order: 3 },
  { id: 4, title: 'Code Warrior', xp_required: 2000, sort_order: 4 },
  { id: 5, title: 'Coding Champion', xp_required: 3000, sort_order: 5 },
  { id: 6, title: 'Code Master', xp_required: 4000, sort_order: 6 },
  { id: 7, title: 'Coding Legend', xp_required: 5000, sort_order: 7 },
];

// ---------------------------------------------------------------------------
// Level boundaries
// ---------------------------------------------------------------------------

test('level boundaries land on the correct side of each threshold', () => {
  const cases = [
    // [total XP, level, title, next level threshold]
    [0, 1, 'Rookie', 500],
    [499, 1, 'Rookie', 500], // one below the first threshold
    [500, 2, 'Novice Coder', 1000],
    [999, 2, 'Novice Coder', 1000],
    [1000, 3, 'Code Explorer', 2000],
    [1999, 3, 'Code Explorer', 2000],
    [2000, 4, 'Code Warrior', 3000],
    [2999, 4, 'Code Warrior', 3000],
    [3000, 5, 'Coding Champion', 4000],
    [3999, 5, 'Coding Champion', 4000],
    [4000, 6, 'Code Master', 5000],
    [4999, 6, 'Code Master', 5000],
    [5000, 7, 'Coding Legend', null],
    [25000, 7, 'Coding Legend', null], // far above the top threshold
  ];

  for (const [xp, level, title, nextLevelXp] of cases) {
    const progress = resolveLevel(xp, LEVELS);

    assert.deepEqual(
      progress,
      { level, title, nextLevelXp },
      `${xp} XP should resolve to level ${level} (${title})`
    );
  }
});

test('a negative total falls back to the lowest level instead of failing', () => {
  // Possible if a corrective entry overshoots everything the member earned.
  assert.deepEqual(resolveLevel(-50, LEVELS), {
    level: 1,
    title: 'Rookie',
    nextLevelXp: 500,
  });
});

test('resolveLevel throws when the levels table has not been seeded', () => {
  assert.throws(() => resolveLevel(0, []), /levels table seeded/);
});

test('resolveLevel does not depend on the order of the rows it is given', () => {
  const reversed = [...LEVELS].reverse();

  assert.deepEqual(resolveLevel(2500, reversed), resolveLevel(2500, LEVELS));
  assert.equal(resolveLevel(2500, reversed).level, 4);
});

// ---------------------------------------------------------------------------
// Handbook XP amounts
// ---------------------------------------------------------------------------

// The authoritative values from the Handbook. Duplicated here on purpose:
// this test is what stops an accidental edit of the source of truth from
// silently changing every future award.
const HANDBOOK_XP = {
  membership: 50,
  'technical-session': 50,
  'club-coding-problem': 50,
  'github-project': 50,
  'technical-tutorial': 50,
  'open-source-contribution': 100,
  'organizing-club-events': 100,
  'internal-coding-contest': 100,
  'top-10-internal': 150,
  'external-contest-hackathon': 150,
  'top-3-internal': 200,
  'conduct-workshop-session': 200,
  'hackathon-finals': 200,
  'win-hackathon': 250,
  'coding-streak-30-days': 250,
};

test('the activity list contains exactly the 15 Handbook activities', () => {
  assert.equal(XP_ACTIVITIES.length, 15);
  assert.deepEqual(
    XP_ACTIVITIES.map((activity) => activity.code).sort(),
    Object.keys(HANDBOOK_XP).sort()
  );
});

test('every activity resolves to its Handbook XP amount', () => {
  for (const [code, xp] of Object.entries(HANDBOOK_XP)) {
    const activity = getXpActivity(code);

    assert.ok(activity, `${code} should resolve`);
    assert.equal(activity.xp, xp, `${code} should be worth ${xp} XP`);
    assert.ok(activity.label.length > 0, `${code} needs a label`);
  }
});

test('activity codes are unique and every amount is positive', () => {
  const codes = XP_ACTIVITIES.map((activity) => activity.code);

  assert.equal(new Set(codes).size, codes.length);

  for (const activity of XP_ACTIVITIES) {
    assert.ok(
      Number.isInteger(activity.xp) && activity.xp > 0,
      `${activity.code} must have a positive integer amount`
    );
  }
});

test('an unknown or malformed activity code resolves to nothing', () => {
  // The route turns every one of these into 400 rather than a default amount.
  const rejected = [
    'not-a-real-activity',
    '',
    '   ',
    'GITHUB-PROJECT', // codes are case-sensitive
    'github-project ', // untrimmed input is trimmed, so this one is valid...
  ];

  for (const code of rejected.slice(0, 4)) {
    assert.equal(getXpActivity(code), null, `${JSON.stringify(code)} must not resolve`);
  }

  // ...which the next line documents rather than forbids.
  assert.equal(getXpActivity('github-project ').xp, 50);

  const nonStrings = [null, undefined, 50, {}, [], true];

  for (const value of nonStrings) {
    assert.equal(getXpActivity(value), null);
  }
});

// ---------------------------------------------------------------------------
// XP manager authorization
// ---------------------------------------------------------------------------

test('only the two XP managers are authorized', () => {
  assert.equal(isXpManager('2414011@dbcegoa.ac.in'), true); // Basil Shaikh Mohammad
  assert.equal(isXpManager('2414012@dbcegoa.ac.in'), true); // Bhumika Khandelwal
});

test('manager emails are matched case-insensitively and trimmed', () => {
  assert.equal(isXpManager('2414011@DBCEGOA.AC.IN'), true);
  assert.equal(isXpManager('  2414012@dbcegoa.ac.in  '), true);
});

test('everyone else is rejected', () => {
  const rejected = [
    'ordinary-member@dbcegoa.ac.in', // synthetic, not a real roster entry
    '2414011@dbcegoa.ac.in.evil.com', // suffix attack on the domain
    'x2414011@dbcegoa.ac.in',
    '241401@dbcegoa.ac.in',
    'basil@example.com',
    '',
    '   ',
    null,
    undefined,
    2414011,
    {},
  ];

  for (const email of rejected) {
    assert.equal(isXpManager(email), false, `${JSON.stringify(email)} must be rejected`);
  }
});
