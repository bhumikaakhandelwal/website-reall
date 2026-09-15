// Phase 3 migration privilege tests.
//
// The XP total RPC takes an arbitrary member id. If `anon` or `authenticated`
// could execute it, anyone holding the publishable key could read another
// member's XP straight from the Supabase RPC endpoint, bypassing the API route
// that scopes the read to the signed session. These assertions read the
// migration SQL and fail if that grant ever comes back.
//
// They also pin the parts of the migration that must not drift: both functions
// keep the Phase 1C hardening (SECURITY DEFINER + empty search_path), RLS is
// never disabled, and no member-facing write policy is added to xp_ledger.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260915000001_xp_engine.sql',
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

test('the migration creates the two expected functions', () => {
  assert.match(normalized, /create function public\.get_all_levels\(\)/);
  assert.match(
    normalized,
    /create function public\.get_member_xp_total\(member_id uuid\)/
  );
});

test('get_member_xp_total is NOT executable by anon or authenticated', () => {
  const grantees = granteesOf('get_member_xp_total');

  assert.notEqual(grantees.length, 0, 'the function should have an explicit grant');
  assert.ok(
    !grantees.includes('anon') && !grantees.includes('authenticated'),
    `anon/authenticated must not execute get_member_xp_total, found: ${grantees.join(', ')}`
  );
  assert.deepEqual(grantees, ['service_role']);
});

test('get_member_xp_total is revoked from PUBLIC, anon, and authenticated', () => {
  const revoke = revokes.find((entry) => entry.fn === 'public.get_member_xp_total');

  assert.ok(revoke, 'the function must be revoked from the default PUBLIC grant');

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(
      revoke.grantees.includes(role),
      `revoke must name ${role}, found: ${revoke.grantees.join(', ')}`
    );
  }
});

test('the REVOKE runs before the GRANT for get_member_xp_total', () => {
  // Functions grant EXECUTE to PUBLIC by default. If the order were reversed,
  // the default PUBLIC grant would still be in force and every role would keep
  // access regardless of the targeted grant.
  const revoke = revokes.find((entry) => entry.fn === 'public.get_member_xp_total');
  const grant = grants.find((entry) => entry.fn === 'public.get_member_xp_total');

  assert.ok(revoke.index < grant.index, 'REVOKE must precede GRANT');
});

test('get_all_levels stays readable by the browser-facing roles', () => {
  // Level definitions are public reference data, not member-private.
  const grantees = granteesOf('get_all_levels');

  assert.ok(grantees.includes('anon'));
  assert.ok(grantees.includes('authenticated'));

  const revoke = revokes.find((entry) => entry.fn === 'public.get_all_levels');

  assert.ok(revoke.grantees.includes('public'));
});

test('both functions keep the Phase 1C hardening', () => {
  const definitions = normalized.match(
    /create function public\.\w+\([^)]*\)[^$]*?language \w+ stable security definer set search_path = ''/g
  );

  assert.equal(definitions?.length, 2, 'both functions must be hardened SECURITY DEFINER');
});

test('the migration never disables RLS or adds a member write policy', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /grant (insert|update|delete|all) on .*xp_ledger/);
});
