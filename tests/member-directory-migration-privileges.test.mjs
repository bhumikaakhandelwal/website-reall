// Phase 5A migration privilege tests.
//
// The directory function returns EVERY member's email and XP. If `anon` or
// `authenticated` could execute it, anyone holding the publishable key could
// dump the whole roster straight from the Supabase RPC endpoint, bypassing the
// API route that requires a signed session AND a manager email. These
// assertions read the migration SQL and fail if that grant ever comes back.
//
// They also pin the parts of the migration that must not drift: the function
// keeps the Phase 1C hardening (SECURITY DEFINER + empty search_path), RLS is
// never disabled, and no new policy or member write path is added.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260917000001_member_directory.sql',
  import.meta.url
);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Line comments out, whitespace collapsed, lowercased: statement-level
// assertions below then work on plain text.
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

test('the migration creates the directory function with no parameters', () => {
  assert.match(normalized, /create function public\.get_member_directory\(\)/);
});

test('it returns exactly the directory columns', () => {
  for (const column of [
    'member_id uuid',
    'email text',
    'display_name text',
    'membership_status text',
    'created_at timestamptz',
    'total_xp integer',
  ]) {
    assert.ok(
      normalized.includes(column),
      `the function must return ${column}`
    );
  }
});

test('get_member_directory is NOT executable by anon or authenticated', () => {
  const grantees = granteesOf('get_member_directory');

  assert.notEqual(grantees.length, 0, 'the function should have an explicit grant');
  assert.ok(
    !grantees.includes('anon') && !grantees.includes('authenticated'),
    `anon/authenticated must not execute get_member_directory, found: ${grantees.join(', ')}`
  );
  assert.deepEqual(grantees, ['service_role']);
});

test('get_member_directory is revoked from PUBLIC, anon, and authenticated', () => {
  const revoke = revokes.find(
    (entry) => entry.fn === 'public.get_member_directory'
  );

  assert.ok(revoke, 'the function must be revoked from the default PUBLIC grant');

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(
      revoke.grantees.includes(role),
      `revoke must name ${role}, found: ${revoke.grantees.join(', ')}`
    );
  }
});

test('the REVOKE runs before the GRANT for get_member_directory', () => {
  // Functions grant EXECUTE to PUBLIC by default. If the order were reversed,
  // the default PUBLIC grant would still be in force and every role would keep
  // access regardless of the targeted grant.
  const revoke = revokes.find(
    (entry) => entry.fn === 'public.get_member_directory'
  );
  const grant = grants.find(
    (entry) => entry.fn === 'public.get_member_directory'
  );

  assert.ok(revoke.index < grant.index, 'REVOKE must precede GRANT');
});

test('the function keeps the Phase 1C hardening', () => {
  const definition = normalized.match(
    /create function public\.get_member_directory\(\)[^$]*?language \w+ stable security definer set search_path = ''/
  );

  assert.ok(definition, 'the function must be hardened SECURITY DEFINER');
});

test('the total is summed from the ledger and coalesced, never stored', () => {
  // No cached column: the total comes from SUM over xp_ledger every call.
  assert.match(normalized, /coalesce\(sum\(x\.xp_amount\), 0\)/);

  // A LEFT JOIN, so a member with no entries still appears - an inner join
  // would drop most of a young roster.
  assert.match(normalized, /left join public\.xp_ledger/);

  // And nothing adds a stored total column.
  assert.doesNotMatch(normalized, /add column\s+\w*total/);
  assert.doesNotMatch(normalized, /alter table/);
});

test('the migration never disables RLS or adds a policy', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
  assert.doesNotMatch(normalized, /grant (insert|update|delete|all) on/);
});

test('the migration adds no role column and no permission table', () => {
  // Authorization stays in lib/xp/managers.ts; the database gains no way to
  // express a role.
  assert.doesNotMatch(normalized, /add column\s+\w*(role|is_admin|admin)/);
  assert.doesNotMatch(normalized, /create table/);
});
