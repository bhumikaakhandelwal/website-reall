// Phase 6: the generated onboarding migration.
//
// The migration is a GENERATED artifact, and these tests are what keep it
// honest. They do two things:
//
//   1. parse the roster back OUT of the generated SQL and run it through the
//      real validator. The file that will actually be executed is therefore the
//      file that gets validated, not a copy of the input that produced it. If
//      someone hand-edits the migration and introduces a duplicate email, this
//      fails.
//
//   2. pin the properties the migration has to have in order to be safe to run
//      twice against a live roster: the two idempotency guards, the exact
//      membership constants, and the ABSENCE of anything destructive.
//
// Assertions on SQL text are weaker than running it, so the destructive half is
// written as a deny-list over the whole file - it is the kind of assertion that
// catches an accidental UPDATE added in a later edit.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MEMBERSHIP_ACTIVITY_CODE,
  MEMBERSHIP_REASON,
  MEMBERSHIP_XP,
  validateRoster,
} from '../lib/onboarding/roster.ts';
import { XP_ACTIVITIES } from '../lib/xp/activities.ts';
import { readdirSync } from 'node:fs';

// Resolved by suffix rather than by exact filename. The version prefix is a
// migration-ordering concern, not a content one: this file was renamed from
// 20260918000001 to 20260918000003 to resolve a duplicate-version collision
// with manager_dashboard, and a test that hardcoded the old name broke for a
// reason that had nothing to do with what it was checking.
const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith('_member_onboarding.sql')
);

assert.ok(
  MIGRATION_FILE,
  'a *_member_onboarding.sql migration must exist in supabase/migrations/'
);

const MIGRATION_URL = new URL(MIGRATION_FILE, MIGRATIONS_DIR);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Comments out, whitespace collapsed, lowercased: statement-level assertions
// then work on plain text. The roster VALUES lists are extracted from the
// ORIGINAL text below, because the collapse would destroy their layout.
const normalized = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/**
 * Every `('email', 'name')` pair in the file, in order, with SQL escaping
 * undone. The generated file has one such list per statement, so this returns
 * both lists concatenated.
 */
function parseRosterRows(text) {
  const rows = [];

  for (const match of text.matchAll(/\(\s*'([^']*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) {
    rows.push({
      email: match[1],
      displayName: match[2].replace(/''/g, "'"),
    });
  }

  return rows;
}

/**
 * The roster embedded in each of the two INSERT statements, kept separate so a
 * test can prove the two lists are identical.
 */
function rosterLists() {
  const blocks = [...sql.matchAll(/FROM \(VALUES([\s\S]*?)\) AS v \(email, display_name\)/g)];

  return blocks.map((block) => parseRosterRows(block[1]));
}

const lists = rosterLists();
const roster = lists[0] ?? [];

// ---------------------------------------------------------------------------
// The file exists and is well formed
// ---------------------------------------------------------------------------

test('the migration exists and declares itself generated', () => {
  assert.ok(sql.length > 0);
  // Checked against the raw text: the header is a `--` comment, and `normalized`
  // has comments stripped.
  assert.match(sql, /GENERATED FILE - do not edit by hand/);
});

test('the migration contains exactly two INSERT statements', () => {
  const inserts = [...normalized.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual(inserts, ['members', 'xp_ledger']);
});

test('the migration embeds the roster in both statements, identically', () => {
  // The list appears twice because SQL has no way to share it between two
  // statements without a temp table. If the two ever diverge, one of them is
  // wrong - and this catches it.
  assert.strictEqual(lists.length, 2, 'expected one roster list per statement');
  assert.deepStrictEqual(lists[0], lists[1], 'the two roster lists must be identical');
});

// ---------------------------------------------------------------------------
// The roster inside the file is valid
// ---------------------------------------------------------------------------

test('the embedded roster has 42 members', () => {
  assert.strictEqual(roster.length, 42);
});

test('the embedded roster passes the real validator', () => {
  // The file that runs is the file that is validated.
  const result = validateRoster(roster);

  if (!result.ok) {
    assert.fail(
      `the shipped roster is invalid: ${result.problems
        .map((p) => `row ${p.row} ${p.code}: ${p.message}`)
        .join('; ')}`
    );
  }

  assert.strictEqual(result.entries.length, 42);
});

test('the embedded roster round-trips through the validator unchanged', () => {
  // Every email is already normalized, so validating is a no-op. This catches a
  // hand-edit that introduces an uppercase or padded address, which would not
  // match the member row it is meant to update.
  const result = validateRoster(roster);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(
    result.entries,
    roster,
    'the embedded roster must already be normalized'
  );
});

test('every embedded email is lowercase and trimmed', () => {
  for (const entry of roster) {
    assert.strictEqual(entry.email, entry.email.trim().toLowerCase(), entry.email);
  }
});

test('the apostrophe in the roster is correctly escaped', () => {
  // "D'Souza" must appear doubled in the raw file, or the literal ends early.
  assert.ok(sql.includes("'Christopher Charles D''Souza'"));
  assert.ok(!sql.includes("'Christopher Charles D'Souza'"));
});

// ---------------------------------------------------------------------------
// Duplicate protection
// ---------------------------------------------------------------------------

test('the member insert is guarded by ON CONFLICT (email) DO NOTHING', () => {
  // Backed by the UNIQUE index members_email_key, so a second run inserts
  // nothing and an existing member is never touched.
  assert.match(
    normalized,
    /insert into public\.members \(email, display_name, membership_status\)[\s\S]*?on conflict \(email\) do nothing/
  );
});

test('the XP insert is guarded by NOT EXISTS on the membership activity code', () => {
  assert.match(
    normalized,
    /insert into public\.xp_ledger \(user_id, xp_amount, activity_code, reason\)[\s\S]*?where not exists \( select 1 from public\.xp_ledger x where x\.user_id = m\.id and x\.activity_code = 'membership' \)/
  );
});

test('the duplicate guard keys on the member AND the activity code', () => {
  // Keying on the amount alone would be wrong: a member whose Membership entry
  // was later corrected to a different amount still holds a Membership entry.
  const guard = normalized.match(/where not exists \(([\s\S]*?)\);/);

  assert.ok(guard, 'the XP insert must have a NOT EXISTS guard');
  assert.match(guard[1], /x\.user_id = m\.id/);
  assert.match(guard[1], /x\.activity_code = 'membership'/);
  assert.doesNotMatch(guard[1], /xp_amount/, 'the guard must not key on the amount');
});

test('the XP insert joins members on the normalized email', () => {
  assert.match(normalized, /join public\.members m on m\.email = v\.email/);
});

test('the XP insert is a separate statement from the member insert', () => {
  // A data-modifying CTE would NOT work: PostgreSQL runs WITH sub-statements
  // concurrently and they cannot see each other's effects on the target tables,
  // so a single-statement version would award XP to nobody on a fresh database.
  assert.doesNotMatch(normalized, /with .* as \(/);
  assert.doesNotMatch(normalized, /returning/);

  const memberInsert = normalized.indexOf('insert into public.members');
  const ledgerInsert = normalized.indexOf('insert into public.xp_ledger');

  assert.ok(memberInsert < ledgerInsert, 'members must be inserted first');
});

// ---------------------------------------------------------------------------
// The membership constants
// ---------------------------------------------------------------------------

test('the XP insert writes exactly 50 XP', () => {
  assert.strictEqual(MEMBERSHIP_XP, 50);
  assert.match(
    normalized,
    /select m\.id, 50, 'membership', 'membership' from \(values/
  );
});

test('the activity code and reason match the constants', () => {
  assert.strictEqual(MEMBERSHIP_ACTIVITY_CODE, 'membership');
  assert.strictEqual(MEMBERSHIP_REASON, 'Membership');
  assert.match(
    normalized,
    new RegExp(`select m\\.id, ${MEMBERSHIP_XP}, '${MEMBERSHIP_ACTIVITY_CODE}', '${MEMBERSHIP_REASON.toLowerCase()}'`)
  );
});

test('the membership constants match lib/xp/activities.ts', () => {
  // The SQL cannot import TypeScript, so the amount is written into the
  // migration. This is the test that stops the two drifting apart: if the
  // Handbook ever changes the Membership award, this fails.
  const activity = XP_ACTIVITIES.find(
    (candidate) => candidate.code === MEMBERSHIP_ACTIVITY_CODE
  );

  assert.ok(activity, 'membership must be a real Handbook activity code');
  assert.strictEqual(activity.xp, MEMBERSHIP_XP);
  assert.strictEqual(activity.label, MEMBERSHIP_REASON);
});

test('members are inserted as active', () => {
  assert.match(normalized, /select v\.email, v\.display_name, 'active' from \(values/);
});

// ---------------------------------------------------------------------------
// What the migration must never do
// ---------------------------------------------------------------------------

test('the migration never updates anything', () => {
  // An UPDATE would overwrite a display name, membership status or membership
  // dates that a manager has since corrected.
  assert.doesNotMatch(normalized, /\bupdate\b/);
  // The realistic way one sneaks in is by turning the member insert into an
  // upsert, so check that form specifically rather than the bare word "set"
  // (which would match unrelated SQL and fail for the wrong reason).
  assert.doesNotMatch(normalized, /do update/);
});

test('an existing member keeps their own display name', () => {
  // ON CONFLICT DO NOTHING, not DO UPDATE: the roster supplies a display_name
  // only for members it inserts. If a manager has since corrected someone's
  // name in the database, running this must not revert it.
  assert.doesNotMatch(normalized, /do update/);
  assert.match(normalized, /on conflict \(email\) do nothing/);
});

test('the migration never deletes anything', () => {
  // In particular it must not remove the pre-existing duplicate Membership
  // entry on 2414011@dbcegoa.ac.in: the ledger is append-only, and reversing an
  // entry is a correction, not a deletion.
  assert.doesNotMatch(normalized, /\bdelete\b/);
  assert.doesNotMatch(normalized, /\btruncate\b/);
  assert.doesNotMatch(normalized, /\bdrop\b/);
});

test('the migration makes no schema change', () => {
  assert.doesNotMatch(normalized, /\bcreate table\b/);
  assert.doesNotMatch(normalized, /\bcreate index\b/);
  assert.doesNotMatch(normalized, /\balter table\b/);
  assert.doesNotMatch(normalized, /\badd column\b/);
  assert.doesNotMatch(normalized, /\bcreate function\b/);
  assert.doesNotMatch(normalized, /\bgrant\b/);
  assert.doesNotMatch(normalized, /\brevoke\b/);
});

test('the migration does not touch RLS', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
});

test('the migration writes no role or authorization column', () => {
  // The manager allowlist lives in lib/xp/managers.ts and is not represented in
  // the database, so no manager assignment can be affected by this file.
  assert.doesNotMatch(normalized, /is_admin/);
  assert.doesNotMatch(normalized, /\brole\b/);
  assert.doesNotMatch(normalized, /permission/);
});

test('the migration writes only the three member columns it declares', () => {
  // membership_start, membership_end and updated_at must be left to their
  // defaults rather than invented from the roster.
  assert.match(
    normalized,
    /insert into public\.members \(email, display_name, membership_status\)/
  );
  assert.doesNotMatch(normalized, /membership_start/);
  assert.doesNotMatch(normalized, /membership_end/);
});

test('the migration writes only the four ledger columns it declares', () => {
  assert.match(
    normalized,
    /insert into public\.xp_ledger \(user_id, xp_amount, activity_code, reason\)/
  );
  assert.doesNotMatch(normalized, /xp_ledger \(id/);
});
