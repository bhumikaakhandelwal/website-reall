// Phase 7A migration tests.
//
// The two new tables hold manager-only operational data, and they are reached
// only through the service-role client behind a session- and manager-checked
// route. These assertions pin the parts of the migration that make that true,
// and the parts that make Phase 7B's bulk award possible without a schema
// change:
//
//   * RLS is ENABLED on both tables with NO policy, so no browser-facing role
//     can reach either one even holding the publishable key
//   * attendance is UNIQUE (event_id, member_id) - the structural guard that
//     stops a member being awarded twice for the same event
//   * attendance.xp_ledger_id exists, is nullable, and starts NULL - which is
//     what will make the Phase 7B award idempotent
//   * NO XP is written by this phase, and nothing existing is altered
//
// Assertions on SQL text are weaker than running it, so the destructive and
// scope half is written as a deny-list over the whole file - the kind of
// assertion that catches an accidental `INSERT INTO xp_ledger` added later.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EVENT_TYPES } from '../lib/events/events.ts';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260918000002_event_foundation.sql',
  import.meta.url
);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Line comments out, whitespace collapsed, lowercased: statement-level
// assertions then work on plain text.
const normalized = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The body of one CREATE TABLE, from its name to the closing paren. */
function tableDefinition(name) {
  const start = normalized.indexOf(`create table public.${name} (`);

  assert.notEqual(start, -1, `${name} must be created by this migration`);

  const end = normalized.indexOf(');', start);

  assert.notEqual(end, -1, `${name} must have a terminated definition`);

  return normalized.slice(start, end);
}

const EVENTS = tableDefinition('events');
const ATTENDANCE = tableDefinition('attendance');

// ---------------------------------------------------------------------------
// What the migration creates
// ---------------------------------------------------------------------------

test('the migration creates exactly the two tables', () => {
  const created = [...normalized.matchAll(/create table public\.(\w+)/g)].map(
    (match) => match[1]
  );

  assert.deepStrictEqual(created.sort(), ['attendance', 'events']);
});

test('events has exactly the declared columns', () => {
  for (const column of [
    'id uuid primary key default gen_random_uuid()',
    'title text not null',
    'event_type text not null',
    'event_date date not null',
    'activity_code text not null',
    'created_by uuid',
    'created_at timestamptz not null default now()',
  ]) {
    assert.ok(EVENTS.includes(column), `events must declare ${column}`);
  }
});

test('attendance has exactly the declared columns', () => {
  for (const column of [
    'id uuid primary key default gen_random_uuid()',
    'event_id uuid not null',
    'member_id uuid not null',
    'recorded_at timestamptz not null default now()',
    'xp_ledger_id integer',
  ]) {
    assert.ok(ATTENDANCE.includes(column), `attendance must declare ${column}`);
  }
});

test('event_date is a DATE, not a timestamp', () => {
  // A DATE cannot carry a timezone, so it cannot render as the previous day for
  // a manager west of UTC - the bug class lib/events/events.ts guards against.
  assert.match(EVENTS, /event_date date not null/);
  assert.doesNotMatch(EVENTS, /event_date timestamptz/);
});

// ---------------------------------------------------------------------------
// RLS
// ---------------------------------------------------------------------------

test('RLS is enabled on both tables', () => {
  assert.match(normalized, /alter table public\.events enable row level security/);
  assert.match(normalized, /alter table public\.attendance enable row level security/);
});

test('neither table gets a policy', () => {
  // The strictest option: with RLS on and no policy, no browser-facing role can
  // read or write either table. The application reaches them only through the
  // service-role client, which bypasses RLS, behind the manager-checked route.
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
});

test('the migration never disables RLS', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
});

test('the migration grants nothing to any role', () => {
  // No new SECURITY DEFINER function, so there is nothing to grant.
  assert.doesNotMatch(normalized, /\bgrant\b/);
  assert.doesNotMatch(normalized, /\brevoke\b/);
  assert.doesNotMatch(normalized, /create function/);
});

// ---------------------------------------------------------------------------
// The duplicate guard that Phase 7B depends on
// ---------------------------------------------------------------------------

test('attendance is unique per member per event', () => {
  // This is the whole reason the foundation comes before the award: it makes
  // "this member attended this event" a fact the database enforces.
  assert.match(
    ATTENDANCE,
    /constraint attendance_event_member_key unique \(event_id, member_id\)/
  );
});

test('attendance.xp_ledger_id exists, is nullable, and starts unawarded', () => {
  // Nullable with no default, so a fresh attendance row is unawarded. Phase 7B
  // awards WHERE xp_ledger_id IS NULL, which makes the award idempotent by
  // construction rather than by a heuristic.
  assert.match(ATTENDANCE, /xp_ledger_id integer/);
  assert.doesNotMatch(ATTENDANCE, /xp_ledger_id integer not null/);
  assert.doesNotMatch(ATTENDANCE, /xp_ledger_id integer[^,]*default/);
});

test('there is a partial index for the unawarded rows', () => {
  assert.match(
    normalized,
    /create index idx_attendance_unawarded on public\.attendance \(event_id\) where xp_ledger_id is null/
  );
});

// ---------------------------------------------------------------------------
// Foreign keys and their delete behaviour
// ---------------------------------------------------------------------------

test('removing a member never deletes club history', () => {
  // events.created_by is SET NULL: the event survives, it just loses its author.
  assert.match(EVENTS, /created_by uuid references public\.members\(id\) on delete set null/);

  // attendance.xp_ledger_id is SET NULL for the same reason - the record that a
  // member was present must outlive the ledger row.
  assert.match(ATTENDANCE, /xp_ledger_id integer references public\.xp_ledger\(id\) on delete set null/);
});

test('deleting an event removes only its own attendance rows', () => {
  assert.match(ATTENDANCE, /event_id uuid not null references public\.events\(id\) on delete cascade/);
});

// ---------------------------------------------------------------------------
// The event type vocabulary
// ---------------------------------------------------------------------------

test('event_type is constrained to the declared vocabulary', () => {
  const check = EVENTS.match(/event_type text not null check \(event_type in \(([^)]*)\)\)/);

  assert.ok(check, 'event_type must have a CHECK constraint');

  const values = [...check[1].matchAll(/'([^']*)'/g)].map((match) => match[1]);

  assert.deepStrictEqual(
    values.sort(),
    EVENT_TYPES.map((type) => type.code).sort(),
    'the CHECK constraint must match lib/events/events.ts'
  );
});

test('the activity code is deliberately NOT constrained to a hardcoded list', () => {
  // The Handbook activity list lives in lib/xp/activities.ts and is the single
  // source of truth. A CHECK here would be a second copy that drifts the first
  // time the Handbook changes, so the API validates it instead.
  const column = EVENTS.match(/activity_code text not null[^,]*/);

  assert.ok(column, 'activity_code must be declared');

  // Checked on the COLUMN, not the whole table: some strings legitimately appear
  // in the events table because they are event types as well as activity codes
  // ('technical-session' is both), so a whole-table search would fail for the
  // wrong reason.
  assert.doesNotMatch(column[0], /'/, 'activity_code must not name any code');
  assert.doesNotMatch(column[0], /\bin \(/);
  assert.doesNotMatch(column[0], /any \(/);
});

test('the activity code has a length bound rather than a vocabulary', () => {
  assert.match(EVENTS, /activity_code text not null check \(length\(btrim\(activity_code\)\)/);
});

test('the title cannot be blank', () => {
  // A CHECK, not just NOT NULL: a title of spaces is not a title.
  assert.match(EVENTS, /title text not null check \(length\(btrim\(title\)\)/);
});

// ---------------------------------------------------------------------------
// The phase boundary: no XP, no scope creep
// ---------------------------------------------------------------------------

test('the migration writes no XP', () => {
  // Phase 7A creates the tables. Awarding attendance is Phase 7B and must not
  // have leaked in.
  assert.doesNotMatch(normalized, /insert into/);
  assert.doesNotMatch(normalized, /xp_amount/);
  assert.doesNotMatch(normalized, /\bupdate\b/);
  assert.doesNotMatch(normalized, /\bdelete from\b/);
});

test('the migration does not alter any existing table', () => {
  const altered = [...normalized.matchAll(/alter table public\.(\w+)/g)].map(
    (match) => match[1]
  );

  // Only the two new tables, and only to enable RLS on them.
  assert.deepStrictEqual([...new Set(altered)].sort(), ['attendance', 'events']);
  assert.doesNotMatch(normalized, /alter table public\.members/);
  assert.doesNotMatch(normalized, /alter table public\.xp_ledger/);
  assert.doesNotMatch(normalized, /alter table public\.levels/);
});

test('the migration adds no role column and no permission table', () => {
  // Authorization stays in lib/xp/managers.ts; the database gains no way to
  // express a role.
  assert.doesNotMatch(normalized, /is_admin/);
  assert.doesNotMatch(normalized, /add column/);
  assert.doesNotMatch(normalized, /materialized view/);
  assert.doesNotMatch(normalized, /add constraint.*check.*role/);
});

test('the migration stores no XP amount on either table', () => {
  // An event names an activity; the amount is resolved at award time. Storing
  // one would be a second copy of the Handbook that drifts silently.
  assert.doesNotMatch(EVENTS, /xp_amount/);
  assert.doesNotMatch(ATTENDANCE, /xp_amount/);
  assert.doesNotMatch(ATTENDANCE, /\bxp integer\b/);
});
