// Phase 8D migration tests.
//
// The migration replaces the authentication model, so the things worth pinning
// are the ones that make it safe to run against 42 real members:
//
//   * it adds a column and a function and NOTHING ELSE - no data is touched, so
//     no member, XP entry, attendance row or event can be affected
//   * the column is nullable, so all 42 existing members land on "not activated
//     yet" rather than being given a value nobody chose
//   * it is UNIQUE, which is the structural half of "no duplicate Auth accounts"
//   * the function is service_role only - it is the one place auth_user_id is
//     exposed
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260919000004_member_auth.sql',
  import.meta.url
);

const sql = readFileSync(MIGRATION_URL, 'utf8');

// Line comments out, whitespace collapsed, lowercased.
const normalized = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const FN = 'get_member_activation';

/** The function body, from its CREATE to the closing `$$;`. */
function definitionOf(fn) {
  const start = normalized.indexOf(`create function public.${fn}(`);

  assert.notEqual(start, -1, `${fn} must be created by this migration`);

  const end = normalized.indexOf('$$;', start);

  assert.notEqual(end, -1, `${fn} must have a body terminator`);

  return normalized.slice(start, end);
}

const BODY = definitionOf(FN);

const grants = [
  ...normalized.matchAll(/grant execute on function (public\.\w+)\(([^)]*)\) to ([^;]+);/g),
].map((match) => ({
  fn: match[1],
  grantees: match[3].split(',').map((role) => role.trim()),
  index: match.index,
}));

const revokes = [
  ...normalized.matchAll(/revoke all on function (public\.\w+)\(([^)]*)\) from ([^;]+);/g),
].map((match) => ({
  fn: match[1],
  grantees: match[3].split(',').map((role) => role.trim()),
  index: match.index,
}));

// ---------------------------------------------------------------------------
// The column
// ---------------------------------------------------------------------------

test('the migration adds exactly one column, on members', () => {
  const added = [...normalized.matchAll(/add column (\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual(added, ['auth_user_id']);
  assert.match(normalized, /alter table public\.members add column auth_user_id uuid/);
});

test('the column is nullable, so the 42 existing members are untouched', () => {
  // NULL is exactly the "not activated yet" state the new flow looks for. A
  // NOT NULL column would need a value nobody chose.
  assert.doesNotMatch(normalized, /auth_user_id uuid not null/);
  assert.doesNotMatch(normalized, /auth_user_id uuid default/);
});

test('the column is UNIQUE, which is half of "no duplicate Auth accounts"', () => {
  assert.match(normalized, /add column auth_user_id uuid unique/);
});

test('the column points at auth.users and survives a deleted account', () => {
  // ON DELETE SET NULL, not CASCADE: deleting an auth account must never delete
  // a member. XP, attendance and event authorship all point at members.id.
  assert.match(
    normalized,
    /references auth\.users\(id\) on delete set null/
  );
  assert.doesNotMatch(normalized, /on delete cascade/);
});

// ---------------------------------------------------------------------------
// The function
// ---------------------------------------------------------------------------

test('the activation lookup takes an email and returns three fields', () => {
  assert.match(normalized, /create function public\.get_member_activation\(p_email text\)/);
  assert.match(
    normalized,
    /returns table \( member_id uuid, membership_status text, has_auth_account boolean \)/
  );
});

test('it returns at most one row and reads nothing else', () => {
  assert.match(BODY, /where m\.email = lower\(btrim\(p_email\)\)/);
  assert.match(BODY, /limit 1/);
});

test('it is STABLE, SECURITY DEFINER and hardened', () => {
  assert.match(BODY, /language sql stable security definer set search_path = ''/);
});

test('it writes nothing', () => {
  assert.doesNotMatch(BODY, /insert into/);
  assert.doesNotMatch(BODY, /\bupdate\b/);
  assert.doesNotMatch(BODY, /\bdelete\b/);
});

// ---------------------------------------------------------------------------
// The grant model
// ---------------------------------------------------------------------------

test('the activation lookup is NOT executable by anon or authenticated', () => {
  const grant = grants.find((entry) => entry.fn === `public.${FN}`);

  assert.ok(grant, 'the function must have an explicit grant');
  assert.ok(
    !grant.grantees.includes('anon') && !grant.grantees.includes('authenticated'),
    `anon/authenticated must not execute ${FN}, found: ${grant.grantees.join(', ')}`
  );
  assert.deepStrictEqual(grant.grantees, ['service_role']);
});

test('the function is revoked from PUBLIC, anon, and authenticated first', () => {
  const revoke = revokes.find((entry) => entry.fn === `public.${FN}`);
  const grant = grants.find((entry) => entry.fn === `public.${FN}`);

  assert.ok(revoke, 'the default PUBLIC grant must be revoked');

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(revoke.grantees.includes(role), `revoke must name ${role}`);
  }

  assert.ok(revoke.index < grant.index, 'REVOKE must precede GRANT');
});

// ---------------------------------------------------------------------------
// Data preservation
// ---------------------------------------------------------------------------

test('the migration writes no data at all', () => {
  // The whole point: 42 members, their XP, their attendance and their events
  // must be exactly as they were.
  const outsideFunction = normalized.replace(BODY, ' ');

  assert.doesNotMatch(outsideFunction, /insert into/);
  assert.doesNotMatch(outsideFunction, /update public\./);
  assert.doesNotMatch(outsideFunction, /delete from/);
});

test('the migration does not backfill auth accounts', () => {
  // Creating 42 auth users would send 42 emails. Members activate themselves.
  //
  // Checked on the STATEMENT, not on the whole file: the column's COMMENT
  // explains that the value comes from inviteUserByEmail, and a whole-file
  // search would match that prose rather than any call.
  assert.doesNotMatch(normalized, /update public\.members set auth_user_id/);
  assert.doesNotMatch(normalized, /insert into auth\./);
});

test('the migration alters only the members table', () => {
  const altered = [...normalized.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);

  assert.deepStrictEqual([...new Set(altered)], ['members']);
});

test('the migration changes no other table and no policy', () => {
  assert.doesNotMatch(normalized, /alter table public\.(xp_ledger|attendance|events|levels)/);
  assert.doesNotMatch(normalized, /create table/);
  assert.doesNotMatch(normalized, /create index/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
  assert.doesNotMatch(normalized, /disable row level security/);
});
