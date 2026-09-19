// Phase 8A migration tests.
//
// Two things to pin here, and the second is the important one:
//
//   * the archive state is two nullable columns and nothing else - no `status`
//     column that could disagree with `archived_at IS NULL`, and no `updated_at`
//     that would audit metadata edits this phase was not asked to audit
//   * `delete_event` takes a ROW LOCK before it counts attendance, because
//     `attendance.event_id` is ON DELETE CASCADE. Without the lock, a delete
//     racing a concurrent attendance insert would destroy the attendance rows -
//     and the only record of who attended - which is exactly what this phase is
//     told to preserve.
//
// `delete_event` also destroys a row, so its grant model matters as much as the
// Phase 7B write functions': service_role alone.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260919000002_event_lifecycle.sql',
  import.meta.url
);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Line comments out, whitespace collapsed, lowercased.
const normalized = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

function statements(pattern) {
  return [...normalized.matchAll(pattern)].map((match) => ({
    fn: match[1],
    grantees: match[3].split(',').map((role) => role.trim()),
    index: match.index,
  }));
}

const grants = statements(
  /grant execute on function (public\.\w+)\(([^)]*)\) to ([^;]+);/g
);

const revokes = statements(
  /revoke all on function (public\.\w+)\(([^)]*)\) from ([^;]+);/g
);

const granteesOf = (fn) =>
  grants.filter((grant) => grant.fn === `public.${fn}`).flatMap((g) => g.grantees);

/** The function body, from its CREATE to the closing `$$;`. */
function definitionOf(fn) {
  const start = normalized.indexOf(`create function public.${fn}(`);

  assert.notEqual(start, -1, `${fn} must be created by this migration`);

  const end = normalized.indexOf('$$;', start);

  assert.notEqual(end, -1, `${fn} must have a body terminator`);

  return normalized.slice(start, end);
}

const DELETE_EVENT = 'delete_event';
const BODY = definitionOf(DELETE_EVENT);

// ---------------------------------------------------------------------------
// The archive columns
// ---------------------------------------------------------------------------

test('the migration adds exactly the two archive columns', () => {
  const added = [...normalized.matchAll(/add column (\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual(added.sort(), ['archived_at', 'archived_by']);
});

test('both archive columns are nullable', () => {
  // NULL archived_at IS the "active" state. A NOT NULL column would need a
  // sentinel, which is the status column this design avoids.
  assert.doesNotMatch(normalized, /archived_at timestamptz not null/);
  assert.doesNotMatch(normalized, /archived_by uuid not null/);
  assert.doesNotMatch(normalized, /archived_at timestamptz default/);
});

test('the archive state is not duplicated in a status column', () => {
  // One place answers "is this event archived". A status column would be a
  // second, and the two would eventually disagree.
  assert.doesNotMatch(normalized, /add column \w*status/);
  assert.doesNotMatch(normalized, /add column \w*state/);
  assert.doesNotMatch(normalized, /\bcreate type\b/);
});

test('archived_by keeps club history if the member row goes', () => {
  assert.match(
    normalized,
    /add column archived_by uuid references public\.members\(id\) on delete set null/
  );
});

test('the migration adds no updated_at and no audit table', () => {
  // The audit trail this phase preserves is the attendance and XP one. Editing
  // an event's metadata is not audited, and was not asked to be.
  assert.doesNotMatch(normalized, /add column \w*updated_at/);
  assert.doesNotMatch(normalized, /create table/);
});

test('the migration alters only the events table', () => {
  const altered = [...normalized.matchAll(/alter table public\.(\w+)/g)].map(
    (match) => match[1]
  );

  assert.deepStrictEqual([...new Set(altered)], ['events']);
});

test('the migration adds no index', () => {
  // The register reads every event in one query and splits the list in the
  // browser, so there is nothing for an index on a few dozen rows to speed up.
  assert.doesNotMatch(normalized, /create index/);
});

// ---------------------------------------------------------------------------
// delete_event
// ---------------------------------------------------------------------------

test('delete_event takes an event id and reports an outcome', () => {
  assert.match(
    normalized,
    /create function public\.delete_event\(p_event_id uuid\)/
  );
  assert.match(
    normalized,
    /returns table \( outcome text, attendance_count integer \)/
  );
});

test('delete_event takes a row lock before counting attendance', () => {
  // THE assertion in this file. attendance.event_id is ON DELETE CASCADE, so a
  // count-then-delete without a lock has a window in which attendance could be
  // recorded - and the delete would then destroy it.
  assert.match(BODY, /for update/);
  assert.match(BODY, /perform 1 from public\.events e where e\.id = p_event_id for update/);

  // The lock must come BEFORE the count, or it protects nothing.
  const lockAt = BODY.indexOf('for update');
  const countAt = BODY.indexOf('select count(*)');

  assert.ok(lockAt < countAt, 'the lock must precede the attendance count');
});

test('delete_event refuses when attendance exists', () => {
  assert.match(BODY, /if v_attendance > 0 then/);
  assert.match(BODY, /return query select 'has_attendance'::text, v_attendance/);
});

test('delete_event reports a missing event rather than failing', () => {
  assert.match(BODY, /if not found then/);
  assert.match(BODY, /return query select 'not_found'::text, 0/);
});

test('delete_event deletes only after both checks pass', () => {
  const deleteAt = BODY.indexOf('delete from public.events');
  const attendanceCheckAt = BODY.indexOf('if v_attendance > 0 then');

  assert.notEqual(deleteAt, -1, 'the function must delete the event');
  assert.ok(attendanceCheckAt < deleteAt, 'the attendance check must come first');
});

test('delete_event touches nothing but the event row', () => {
  // No attendance is deleted directly: the cascade only ever has nothing to
  // cascade, because the function refuses when attendance exists.
  assert.doesNotMatch(BODY, /delete from public\.attendance/);
  assert.doesNotMatch(BODY, /delete from public\.xp_ledger/);
  assert.doesNotMatch(BODY, /update /);
  assert.doesNotMatch(BODY, /insert into/);
});

test('delete_event keeps the Phase 1C hardening', () => {
  assert.match(BODY, /language plpgsql security definer set search_path = ''/);
});

// ---------------------------------------------------------------------------
// The grant model
// ---------------------------------------------------------------------------

test('delete_event is NOT executable by anon or authenticated', () => {
  // It destroys a row. If a browser-facing role could execute it, anyone
  // holding the publishable key could delete any event through the RPC
  // endpoint - and the function cannot check who is calling.
  const grantees = granteesOf(DELETE_EVENT);

  assert.notEqual(grantees.length, 0, 'the function should have an explicit grant');
  assert.ok(
    !grantees.includes('anon') && !grantees.includes('authenticated'),
    `anon/authenticated must not execute delete_event, found: ${grantees.join(', ')}`
  );
  assert.deepStrictEqual(grantees, ['service_role']);
});

test('delete_event is revoked from PUBLIC, anon, and authenticated', () => {
  const revoke = revokes.find((entry) => entry.fn === `public.${DELETE_EVENT}`);

  assert.ok(revoke, 'the function must be revoked from the default PUBLIC grant');

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(
      revoke.grantees.includes(role),
      `revoke must name ${role}, found: ${revoke.grantees.join(', ')}`
    );
  }
});

test('the REVOKE runs before the GRANT', () => {
  const revoke = revokes.find((entry) => entry.fn === `public.${DELETE_EVENT}`);
  const grant = grants.find((entry) => entry.fn === `public.${DELETE_EVENT}`);

  assert.ok(revoke.index < grant.index, 'REVOKE must precede GRANT');
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test('the migration never disables RLS or adds a policy', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
});

test('the migration writes no data outside its function', () => {
  const outsideFunction = normalized.replace(BODY, ' ');

  assert.doesNotMatch(outsideFunction, /insert into/);
  assert.doesNotMatch(outsideFunction, /update public\./);
  assert.doesNotMatch(outsideFunction, /delete from/);
});

test('the migration does not touch attendance, xp_ledger, members or levels', () => {
  const outsideFunction = normalized.replace(BODY, ' ');

  assert.doesNotMatch(outsideFunction, /alter table public\.attendance/);
  assert.doesNotMatch(outsideFunction, /alter table public\.xp_ledger/);
  assert.doesNotMatch(outsideFunction, /alter table public\.members/);
  assert.doesNotMatch(outsideFunction, /alter table public\.levels/);
});
