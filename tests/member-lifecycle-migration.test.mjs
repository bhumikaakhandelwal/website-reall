// Phase 8E migration tests.
//
// The migration runs against 42 real members with real XP, attendance and event
// history, so what matters most is what it does NOT do: no data touched, no
// cascade, no delete path, and no new state machine beyond one nullable column.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260920000001_member_archive.sql',
  import.meta.url
);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Line comments out, whitespace collapsed, lowercased.
const normalized = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The function body, from its CREATE to the closing `$$;`. */
function definitionOf(fn) {
  const start = normalized.indexOf(`create function public.${fn}(`);

  assert.notEqual(start, -1, `${fn} must be created by this migration`);

  const end = normalized.indexOf('$$;', start);

  assert.notEqual(end, -1, `${fn} must have a body terminator`);

  return normalized.slice(start, end);
}

const BODY = definitionOf('get_member_directory');

// ---------------------------------------------------------------------------
// The columns
// ---------------------------------------------------------------------------

test('the migration adds exactly the two archive columns, on members', () => {
  const added = [...normalized.matchAll(/add column (\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual(added.sort(), ['archived_at', 'archived_by']);
  assert.match(normalized, /alter table public\.members add column archived_at timestamptz/);
});

test('both columns are nullable, so the 42 existing members stay active', () => {
  // NULL archived_at IS the active state. A NOT NULL column would need a
  // sentinel, and a DEFAULT would archive or activate everyone by accident.
  assert.doesNotMatch(normalized, /archived_at timestamptz not null/);
  assert.doesNotMatch(normalized, /archived_at timestamptz default/);
  assert.doesNotMatch(normalized, /archived_by uuid not null/);
});

test('archived_by points at auth.users and survives a deleted account', () => {
  assert.match(normalized, /add column archived_by uuid references auth\.users\(id\) on delete set null/);
});

test('there is no cascade anywhere', () => {
  // A cascade would let archiving or an auth-account deletion take a member with
  // it, which is the opposite of what this phase is for.
  assert.doesNotMatch(normalized, /on delete cascade/);
});

test('no deleted state is introduced', () => {
  // Archiving is reversible; deletion is not. The brief is explicit that
  // permanent deletion is NOT part of this phase.
  assert.doesNotMatch(normalized, /add column \w*deleted/);
  assert.doesNotMatch(normalized, /add column is_deleted/);
  assert.doesNotMatch(normalized, /\bdelete from\b/);
  assert.doesNotMatch(normalized, /\btruncate\b/);
});

test('the archive columns are separate from membership_status', () => {
  // Two different states with different consequences: 'inactive' refuses
  // sign-in, archived does not. Collapsing them would lose the distinction.
  assert.doesNotMatch(normalized, /membership_status\s*=/);
  assert.doesNotMatch(normalized, /alter column membership_status/);
});

// ---------------------------------------------------------------------------
// The directory read
// ---------------------------------------------------------------------------

test('the directory gains archived_at and keeps every column it had', () => {
  for (const column of [
    'member_id uuid',
    'email text',
    'display_name text',
    'membership_status text',
    'created_at timestamptz',
    'total_xp integer',
    'archived_at timestamptz',
  ]) {
    assert.ok(BODY.includes(column), `the return shape must still declare ${column}`);
  }
});

test('the directory is dropped before it is recreated', () => {
  // PostgreSQL refuses to change a RETURNS TABLE shape in place, so a DROP is
  // required - which is also why the grants have to be re-issued.
  const dropAt = normalized.indexOf('drop function public.get_member_directory()');
  const createAt = normalized.indexOf('create function public.get_member_directory()');

  assert.notEqual(dropAt, -1, 'the old signature must be dropped');
  assert.ok(dropAt < createAt, 'DROP must precede CREATE');
});

test('the directory still reads only members and the ledger', () => {
  assert.match(BODY, /from public\.members m/);
  assert.match(BODY, /left join public\.xp_ledger x/);
  assert.match(BODY, /group by /);
  assert.match(BODY, /order by m\.display_name asc, m\.id asc/);
});

test('the directory keeps its Phase 1C hardening', () => {
  assert.match(BODY, /language sql stable security definer set search_path = ''/);
});

test('the directory is STILL server-only after being recreated', () => {
  // Dropping a function drops its grants, so a missing re-grant would leave the
  // default PUBLIC EXECUTE in place - and the directory exposes every member's
  // email address.
  const grant = normalized.match(
    /grant execute on function public\.get_member_directory\(\) to ([^;]+);/
  );

  assert.ok(grant, 'the directory must be granted explicitly');
  assert.deepStrictEqual(grant[1].split(',').map((r) => r.trim()), ['service_role']);

  const revoke = normalized.match(
    /revoke all on function public\.get_member_directory\(\) from ([^;]+);/
  );

  assert.ok(revoke, 'the default PUBLIC grant must be revoked');

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(revoke[1].includes(role), `revoke must name ${role}`);
  }

  assert.ok(
    normalized.indexOf('revoke all on function public.get_member_directory()') <
      normalized.indexOf('grant execute on function public.get_member_directory()'),
    'REVOKE must precede GRANT'
  );
});

// ---------------------------------------------------------------------------
// Data preservation
// ---------------------------------------------------------------------------

test('the migration writes no data at all', () => {
  const outsideFunction = normalized.replace(BODY, ' ');

  assert.doesNotMatch(outsideFunction, /insert into/);
  assert.doesNotMatch(outsideFunction, /update public\./);
  assert.doesNotMatch(outsideFunction, /delete from/);
});

test('the migration does not archive anybody', () => {
  // Everyone stays active until a manager says otherwise. A migration that
  // archived anyone would be a data change nobody asked for.
  assert.doesNotMatch(normalized, /set archived_at\s*=/);
  assert.doesNotMatch(normalized, /set archived_by\s*=/);
});

test('the migration alters only the members table', () => {
  const altered = [...normalized.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual([...new Set(altered)], ['members']);
});

test('the migration touches no XP, attendance, event or level table', () => {
  for (const table of ['xp_ledger', 'attendance', 'events', 'levels']) {
    assert.ok(
      !normalized.includes(`alter table public.${table}`),
      `the migration must not alter ${table}`
    );
  }
});

test('the migration adds no index, table, type or policy', () => {
  assert.doesNotMatch(normalized, /create index/);
  assert.doesNotMatch(normalized, /create table/);
  assert.doesNotMatch(normalized, /create type/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
  assert.doesNotMatch(normalized, /disable row level security/);
});
