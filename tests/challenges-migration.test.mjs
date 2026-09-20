// Phase 9 migration tests.
//
// The migration runs against a live database with real members and real XP, so
// what matters is what it does NOT do - it awards nothing, changes no existing
// table, and adds no automatic award path - and that the XP it seeds is the
// Handbook's, not a number somebody liked the look of.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { XP_ACTIVITIES, getXpActivity } from '@/lib/xp/activities';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260920000002_challenges.sql',
  import.meta.url
);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Line comments out, whitespace collapsed, lowercased.
const normalized = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The seeded rows, as (slug, activity_code, xp_reward) triples. */
const SEED = [
  {
    slug: 'ship-your-first-cli',
    activityCode: 'github-project',
    xp: 50,
    title: 'Ship Your First CLI',
  },
  {
    slug: 'javascript-debug-sprint',
    activityCode: 'club-coding-problem',
    xp: 50,
    title: 'JavaScript Debug Sprint',
  },
  {
    slug: 'git-branch-rescue',
    activityCode: 'club-coding-problem',
    xp: 50,
    title: 'Git Branch Rescue',
  },
  {
    slug: 'open-source-patch',
    activityCode: 'open-source-contribution',
    xp: 100,
    title: 'Open-source Patch',
  },
  {
    slug: '30-day-coding-streak',
    activityCode: 'coding-streak-30-days',
    xp: 250,
    title: '30-Day Coding Streak',
  },
];

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

test('both tables are created', () => {
  assert.match(normalized, /create table public\.challenges \(/);
  assert.match(normalized, /create table public\.challenge_submissions \(/);
});

test('challenges carries every column the brief asks for', () => {
  for (const column of [
    'id uuid primary key',
    'title text not null',
    'slug text not null unique',
    'activity_code text not null',
    'xp_reward integer not null',
    'difficulty text not null',
    'description text not null',
    'requirements text not null',
    'estimated_hours integer not null',
    'submission_type text not null',
    'archived_at timestamptz',
    'archived_by uuid',
  ]) {
    assert.ok(normalized.includes(column), `challenges must declare ${column}`);
  }
});

test('challenge_submissions carries every column the brief asks for', () => {
  for (const column of [
    'challenge_id uuid not null',
    'member_id uuid not null',
    'github_url text',
    'submission_text text',
    "status text not null default 'pending'",
    'manager_feedback text',
    'reviewed_by uuid',
    'reviewed_at timestamptz',
    'xp_ledger_id integer unique',
    'created_at timestamptz not null default now()',
  ]) {
    assert.ok(
      normalized.includes(column),
      `challenge_submissions must declare ${column}`
    );
  }
});

// ---------------------------------------------------------------------------
// The constraints
// ---------------------------------------------------------------------------

test('one pending submission per member per challenge, and only while pending', () => {
  // PARTIAL is the whole point: a member must be able to resubmit after a
  // rejection, so the index cannot constrain every row.
  const index = normalized.match(
    /create unique index \w+ on public\.challenge_submissions \(challenge_id, member_id\) where status = 'pending'/
  );

  assert.ok(index, 'the one-pending index must be partial on status');
});

test('xp_ledger_id is UNIQUE, which is half of "no duplicate awards"', () => {
  assert.match(normalized, /xp_ledger_id integer unique references public\.xp_ledger\(id\)/);
});

test('the status is constrained to the three real states', () => {
  assert.match(
    normalized,
    /check \(status in \('pending', 'approved', 'rejected'\)\)/
  );
});

test('nothing cascades away', () => {
  // Deleting a member or a challenge must never silently take submissions - and
  // certainly never a ledger row - with it.
  assert.doesNotMatch(normalized, /on delete cascade/);
  assert.match(normalized, /references public\.challenges\(id\) on delete restrict/);
  assert.match(normalized, /references public\.members\(id\) on delete restrict/);
});

// ---------------------------------------------------------------------------
// The award path
// ---------------------------------------------------------------------------

test('approval is a function, not a trigger', () => {
  // A trigger would award XP automatically, which is the one thing the Handbook
  // forbids. The award must require a manager calling it.
  assert.match(normalized, /create function public\.approve_challenge_submission\(/);
  assert.doesNotMatch(normalized, /create trigger/);
});

test('the approval function takes the amount from the challenge, never a caller', () => {
  // Its only parameters are the submission, the reviewer and a display string.
  // There is no XP parameter, so no caller can choose the amount.
  const signature = normalized.match(
    /create function public\.approve_challenge_submission\(([^)]*)\)/
  );

  assert.ok(signature);
  assert.ok(
    !/xp/.test(signature[1]),
    `the signature must not accept an XP amount, found: ${signature[1]}`
  );

  // ...and it reads the reward from the table.
  assert.match(normalized, /select s\.member_id, s\.status, s\.xp_ledger_id, c\.xp_reward, c\.activity_code/);
});

test('the approval locks the row and refuses anything not pending', () => {
  assert.match(normalized, /for update of s/);
  assert.match(normalized, /if v_status <> 'pending' or v_existing_ledger is not null then return; end if;/);
});

test('the approval writes exactly one ledger row and stamps the submission', () => {
  assert.match(normalized, /insert into public\.xp_ledger \(user_id, xp_amount, activity_code, reason\)/);
  assert.match(normalized, /set status = 'approved', xp_ledger_id = v_ledger_id/);
  assert.match(normalized, /reviewed_by = p_reviewed_by, reviewed_at = now\(\)/);
});

test('rejection writes no XP', () => {
  const start = normalized.indexOf('create function public.reject_challenge_submission(');
  const end = normalized.indexOf('$$;', start);

  assert.notEqual(start, -1);

  const body = normalized.slice(start, end);

  assert.ok(!body.includes('insert into public.xp_ledger'), 'rejection must not award');
  assert.match(body, /set status = 'rejected'/);
});

test('both functions are service_role only', () => {
  for (const fn of ['approve_challenge_submission', 'reject_challenge_submission']) {
    const revoke = normalized.match(
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from ([^;]+);`)
    );
    const grant = normalized.match(
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to ([^;]+);`)
    );

    assert.ok(revoke, `${fn} must revoke the default PUBLIC grant`);
    assert.ok(grant, `${fn} must be granted explicitly`);

    for (const role of ['public', 'anon', 'authenticated']) {
      assert.ok(revoke[1].includes(role), `${fn} revoke must name ${role}`);
    }

    assert.deepStrictEqual(grant[1].split(',').map((r) => r.trim()), ['service_role']);
  }
});

// ---------------------------------------------------------------------------
// Data preservation
// ---------------------------------------------------------------------------

test('the migration awards nobody any XP', () => {
  // It seeds CHALLENGES, not awards. A schema migration must never touch the
  // ledger - and the only insert into it anywhere in this file is inside
  // approve_challenge_submission, which a manager has to call deliberately.
  const inserts = [...normalized.matchAll(/insert into public\.xp_ledger/g)];

  assert.strictEqual(inserts.length, 1, 'exactly one ledger insert may exist');

  const approveAt = normalized.indexOf('create function public.approve_challenge_submission');
  const rejectAt = normalized.indexOf('create function public.reject_challenge_submission');
  const insertAt = inserts[0].index;

  assert.ok(approveAt !== -1 && rejectAt !== -1);
  assert.ok(
    insertAt > approveAt && insertAt < rejectAt,
    'the only ledger insert must sit inside the approval function'
  );
});


test('the migration changes no existing table', () => {
  for (const table of ['members', 'xp_ledger', 'attendance', 'events', 'levels']) {
    assert.ok(
      !normalized.includes(`alter table public.${table}`),
      `the migration must not alter ${table}`
    );
  }

  const altered = [...normalized.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual(
    [...new Set(altered)].sort(),
    ['challenge_submissions', 'challenges']
  );
});

test('there is no DELETE anywhere', () => {
  assert.doesNotMatch(normalized, /delete from/);
  assert.doesNotMatch(normalized, /drop table/);
});

// ---------------------------------------------------------------------------
// Handbook verification - the point of the whole phase
// ---------------------------------------------------------------------------

test('every seeded XP value is the Handbook value for its activity', () => {
  for (const seed of SEED) {
    const activity = getXpActivity(seed.activityCode);

    assert.ok(activity, `${seed.slug} uses unknown activity ${seed.activityCode}`);
    assert.strictEqual(
      seed.xp,
      activity.xp,
      `${seed.slug} must pay the Handbook value for ${seed.activityCode}`
    );
  }
});

test('the seeded values are exactly 50, 50, 50, 100 and 250', () => {
  // The five from the brief, in the Handbook's own numbers.
  assert.deepStrictEqual(
    SEED.map((seed) => seed.xp).sort((a, b) => a - b),
    [50, 50, 50, 100, 250]
  );
});

test('no seeded value is an unofficial one', () => {
  // The placeholder cards used to show 150 / 400 / 900. None of those is a
  // Handbook value for these activities, and none may survive.
  const handbook = new Set(XP_ACTIVITIES.map((activity) => activity.xp));

  for (const seed of SEED) {
    assert.ok(handbook.has(seed.xp), `${seed.xp} is not a Handbook value`);
  }

  for (const invented of [150, 400, 900]) {
    assert.ok(
      !SEED.some((seed) => seed.xp === invented),
      `${invented} XP was a placeholder and must not be seeded`
    );
  }
});

test('every seeded activity code exists in lib/xp/activities.ts', () => {
  for (const seed of SEED) {
    assert.ok(
      XP_ACTIVITIES.some((activity) => activity.code === seed.activityCode),
      `${seed.activityCode} is not a Handbook activity`
    );
  }
});

test('all five challenges are seeded, by slug', () => {
  for (const seed of SEED) {
    assert.ok(
      normalized.includes(`'${seed.slug}'`),
      `the migration must seed ${seed.slug}`
    );
  }
});

test('seeding is idempotent', () => {
  assert.match(normalized, /on conflict \(slug\) do nothing/);
});

test('the migration restates the same numbers the seed rows claim', () => {
  // The SQL cannot import TypeScript, so the values appear twice - once in the
  // migration and once in this test's SEED table. This asserts they agree, so a
  // typo in either fails the suite rather than quietly paying the wrong amount.
  for (const seed of SEED) {
    const row = normalized.match(
      new RegExp(`'${seed.slug}', '${seed.activityCode}', ${seed.xp},`)
    );

    assert.ok(row, `the migration must seed ${seed.slug} with ${seed.xp} XP`);
  }
});

// ---------------------------------------------------------------------------
// The submission-type correction (20260920000003)
// ---------------------------------------------------------------------------
//
// The Phase 9 seed gave 30-Day Coding Streak `github_url`, which the Handbook
// does not support - a streak on LeetCode or HackerRank is proved by a profile
// or a write-up, not a repository. The row was already in the database, so the
// fix had to be a migration.

const CORRECTION_URL = new URL(
  '../supabase/migrations/20260920000003_challenge_submission_types.sql',
  import.meta.url
);

const correctionSql = readFileSync(CORRECTION_URL, 'utf8');

const correction = correctionSql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

test('the correction changes only the streak, and only its submission type', () => {
  assert.match(correction, /update public\.challenges/);
  assert.match(correction, /set submission_type = 'text'/);
  assert.match(correction, /where slug = '30-day-coding-streak'/);
});

test('the correction is idempotent', () => {
  // The guard means a second run matches nothing, so a database created fresh
  // from the original migration and one that has had this applied end up the
  // same.
  assert.match(correction, /and submission_type <> 'text'/);
});

test('the correction touches no XP value', () => {
  // The streak still pays the Handbook's 250. Only the evidence changes.
  assert.doesNotMatch(correction, /xp_reward/);
  assert.doesNotMatch(correction, /set xp/);
});

test('the correction changes no other challenge', () => {
  for (const slug of [
    'ship-your-first-cli',
    'javascript-debug-sprint',
    'git-branch-rescue',
    'open-source-patch',
  ]) {
    assert.ok(
      !correction.includes(slug),
      `the correction must not touch ${slug}`
    );
  }
});

test('the correction adds no column, table or constraint', () => {
  assert.doesNotMatch(correction, /alter table/);
  assert.doesNotMatch(correction, /add column/);
  assert.doesNotMatch(correction, /create table/);
  assert.doesNotMatch(correction, /create index/);
});

test('the correction touches no submission and no ledger row', () => {
  assert.doesNotMatch(correction, /challenge_submissions/);
  assert.doesNotMatch(correction, /xp_ledger/);
  assert.doesNotMatch(correction, /delete from/);
});

test('the corrected types are the ones the form mapping expects', () => {
  // The seed table in tests/challenges.test.mjs, and the correction, must agree -
  // otherwise a fresh database and a migrated one would render different forms.
  const expected = {
    'ship-your-first-cli': 'github_url',
    'javascript-debug-sprint': 'text',
    'git-branch-rescue': 'text',
    'open-source-patch': 'github_url',
    '30-day-coding-streak': 'text',
  };

  // Four of the five were already right in the original seed; the fifth is the
  // correction. Assert the original seed for the four it got right...
  for (const slug of Object.keys(expected)) {
    if (slug === '30-day-coding-streak') continue;

    assert.ok(
      normalized.includes(`'${slug}'`),
      `the original seed must contain ${slug}`
    );
  }

  // ...and that the correction supplies the fifth.
  assert.strictEqual(expected['30-day-coding-streak'], 'text');
  assert.match(correction, /set submission_type = 'text'/);
});
