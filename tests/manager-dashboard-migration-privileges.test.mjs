// Phase 5C migration privilege tests.
//
// Both new functions expose OTHER members' XP: one returns the club's monthly
// ledger total, the other returns the most recent ledger entries with the
// member's name. If `anon` or `authenticated` could execute either, anyone
// holding the publishable key could read them straight from the Supabase RPC
// endpoint, bypassing the API route that requires a signed session AND a
// manager email. These assertions read the migration SQL and fail if either
// grant ever comes back.
//
// They also pin the parts of the migration that must not drift: both functions
// keep the Phase 1C hardening (SECURITY DEFINER + empty search_path), the month
// total deliberately does NOT reuse the leaderboard's membership filter, the
// recent-entries read is bounded and deterministically ordered, and RLS is never
// disabled nor a policy added.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260918000001_manager_dashboard.sql',
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

/**
 * The body of one function, from its CREATE to the closing `$$;`. Needed
 * because the two functions are in one file and a whole-file assertion cannot
 * tell them apart - `join` appears in one and must not appear in the other.
 */
function definitionOf(fn) {
  const start = normalized.indexOf(`create function public.${fn}(`);

  assert.notEqual(start, -1, `${fn} must be created by this migration`);

  const end = normalized.indexOf('$$;', start);

  assert.notEqual(end, -1, `${fn} must have a body terminator`);

  return normalized.slice(start, end);
}

const MONTH_TOTAL = 'get_month_xp_total';
const RECENT_ENTRIES = 'get_recent_xp_entries';

// ---------------------------------------------------------------------------
// What the migration creates
// ---------------------------------------------------------------------------

test('the migration creates exactly the two dashboard functions', () => {
  const created = [...normalized.matchAll(/create function public\.(\w+)\(/g)].map(
    (match) => match[1]
  );

  assert.deepStrictEqual(created.sort(), [MONTH_TOTAL, RECENT_ENTRIES].sort());
});

test('get_month_xp_total takes a half-open window and returns one integer', () => {
  assert.match(
    normalized,
    /create function public\.get_month_xp_total\( p_period_start timestamptz, p_period_end timestamptz \)/,
    'the window must be an explicit [start, end) pair, computed by the caller'
  );

  assert.match(
    normalized,
    /create function public\.get_month_xp_total\([^$]*?returns integer/,
    'the total is a scalar, like get_member_xp_total'
  );
});

test('get_recent_xp_entries takes a limit and returns exactly the listed columns', () => {
  assert.match(
    normalized,
    /create function public\.get_recent_xp_entries\(p_limit integer\)/
  );

  for (const column of [
    'entry_id integer',
    'member_id uuid',
    'display_name text',
    'xp_amount integer',
    'activity_code text',
    'reason text',
    'created_at timestamptz',
  ]) {
    assert.ok(
      normalized.includes(column),
      `the function must return ${column}`
    );
  }
});

// ---------------------------------------------------------------------------
// The grant model
// ---------------------------------------------------------------------------

test('neither function is executable by anon or authenticated', () => {
  for (const fn of [MONTH_TOTAL, RECENT_ENTRIES]) {
    const grantees = granteesOf(fn);

    assert.notEqual(
      grantees.length,
      0,
      `${fn} should have an explicit grant`
    );
    assert.ok(
      !grantees.includes('anon') && !grantees.includes('authenticated'),
      `anon/authenticated must not execute ${fn}, found: ${grantees.join(', ')}`
    );
    assert.deepStrictEqual(grantees, ['service_role']);
  }
});

test('both functions are revoked from PUBLIC, anon, and authenticated', () => {
  for (const fn of [MONTH_TOTAL, RECENT_ENTRIES]) {
    const revoke = revokes.find((entry) => entry.fn === `public.${fn}`);

    assert.ok(revoke, `${fn} must be revoked from the default PUBLIC grant`);

    for (const role of ['public', 'anon', 'authenticated']) {
      assert.ok(
        revoke.grantees.includes(role),
        `${fn}'s revoke must name ${role}, found: ${revoke.grantees.join(', ')}`
      );
    }
  }
});

test('the REVOKE runs before the GRANT for both functions', () => {
  // Functions grant EXECUTE to PUBLIC by default. If the order were reversed,
  // the default PUBLIC grant would still be in force and every role would keep
  // access regardless of the targeted grant.
  for (const fn of [MONTH_TOTAL, RECENT_ENTRIES]) {
    const revoke = revokes.find((entry) => entry.fn === `public.${fn}`);
    const grant = grants.find((entry) => entry.fn === `public.${fn}`);

    assert.ok(revoke.index < grant.index, `${fn}: REVOKE must precede GRANT`);
  }
});

test('both functions keep the Phase 1C hardening', () => {
  for (const fn of [MONTH_TOTAL, RECENT_ENTRIES]) {
    assert.match(
      definitionOf(fn),
      /language \w+ stable security definer set search_path = ''/,
      `${fn} must be a hardened SECURITY DEFINER`
    );
  }
});

// ---------------------------------------------------------------------------
// The month total
// ---------------------------------------------------------------------------

test('the month total sums the ledger and coalesces it', () => {
  const definition = definitionOf(MONTH_TOTAL);

  assert.match(definition, /coalesce\(sum\(x\.xp_amount\), 0\)::integer/);

  // A month with no entries must be a genuine 0, never NULL: the route treats
  // null as "the read failed", so a NULL here would turn an empty month into a
  // 500.
  assert.match(definition, /from public\.xp_ledger/);
});

test('the month total applies only the window, not the leaderboard ranking rules', () => {
  const definition = definitionOf(MONTH_TOTAL);

  // get_monthly_leaderboard keeps only active members and drops zero rows,
  // because it is ranking. Summing it would under-report a month in which a
  // pending or inactive member earned XP, so this function must join nothing
  // and filter nothing but the window.
  assert.doesNotMatch(
    definition,
    /join/,
    'the month total must not join members - it is a ledger fact, not a ranking'
  );
  assert.doesNotMatch(definition, /membership_status/);
  assert.doesNotMatch(definition, /having/);

  // The window bounds are exactly the two parameters, half-open.
  assert.match(definition, /x\.created_at >= p_period_start/);
  assert.match(definition, /x\.created_at < p_period_end/);
});

// ---------------------------------------------------------------------------
// The recent entries
// ---------------------------------------------------------------------------

test('the recent entries join members and are bounded by the limit', () => {
  const definition = definitionOf(RECENT_ENTRIES);

  // INNER JOIN is safe here: xp_ledger.user_id is NOT NULL and references
  // members(id) ON DELETE CASCADE, so no ledger row can lose its member.
  assert.match(definition, /join public\.members m on m\.id = x\.user_id/);

  // The limit is applied in the database, not by reading the ledger and
  // slicing it in the application.
  assert.match(definition, /limit /);
});

test('the limit is clamped so the function is safe for any argument', () => {
  const definition = definitionOf(RECENT_ENTRIES);

  // A LIMIT of 0 or -1 would be a silently empty dashboard; an unbounded one
  // would be a read the database could not refuse. LEAST/GREATEST ignore NULL,
  // so a NULL limit becomes 1 rather than "everything".
  assert.match(
    definition,
    /limit least\(greatest\(p_limit, 1\), 100\)/,
    'the limit must be clamped to 1..100'
  );
});

test('the recent entries are ordered deterministically, newest first', () => {
  const definition = definitionOf(RECENT_ENTRIES);

  // created_at alone is not enough: two entries can share a timestamp, and
  // `id` is SERIAL, so it breaks the tie in insertion order. Without it the
  // "last 10" list could reshuffle between two identical requests.
  assert.match(
    definition,
    /order by x\.created_at desc, x\.id desc/,
    'the order must be fully deterministic'
  );
});

// ---------------------------------------------------------------------------
// What the migration must NOT do
// ---------------------------------------------------------------------------

test('the migration never disables RLS or adds a policy', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
  assert.doesNotMatch(normalized, /grant (insert|update|delete|all) on/);
});

test('the migration adds no role column, no permission table, and no stored counter', () => {
  // Authorization stays in lib/xp/managers.ts; the database gains no way to
  // express a role, and no cached figure that could drift from the ledger.
  assert.doesNotMatch(normalized, /add column\s+\w*(role|is_admin|admin)/);
  assert.doesNotMatch(normalized, /create table/);
  assert.doesNotMatch(normalized, /materialized view/);
  assert.doesNotMatch(normalized, /alter table/);
});

test('the migration adds no function that writes', () => {
  // Both functions are read-only. A dashboard must never be able to change XP.
  assert.doesNotMatch(normalized, /insert into/);
  assert.doesNotMatch(normalized, /update public\./);
  assert.doesNotMatch(normalized, /delete from/);
});
