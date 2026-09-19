// Phase 8B migration tests.
//
// This migration adds ONE read-only function and nothing else. The assertions
// that matter are:
//
//   * it is genuinely read-only - LANGUAGE sql, STABLE, no INSERT/UPDATE/DELETE
//     anywhere in the body. "Keep analytics read-only" is a requirement, and a
//     STABLE function cannot write, so the requirement is structural rather
//     than a convention somebody has to remember.
//   * it is granted to `service_role` alone. It exposes how many members
//     attended each event and what that was worth; if a browser-facing role
//     could execute it, anyone holding the publishable key could read the club's
//     attendance figures straight from the RPC endpoint.
//   * it covers the club's whole history. No archive filter, because an archived
//     event is still history and excluding it would quietly shrink every figure
//     on the page.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260919000003_event_analytics.sql',
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

const TOTALS = 'get_event_attendance_totals';

/** The function body, from its CREATE to the closing `$$;`. */
function definitionOf(fn) {
  const start = normalized.indexOf(`create function public.${fn}(`);

  assert.notEqual(start, -1, `${fn} must be created by this migration`);

  const end = normalized.indexOf('$$;', start);

  assert.notEqual(end, -1, `${fn} must have a body terminator`);

  return normalized.slice(start, end);
}

const BODY = definitionOf(TOTALS);

// ---------------------------------------------------------------------------
// What the migration creates
// ---------------------------------------------------------------------------

test('the migration creates exactly one function', () => {
  const created = [...normalized.matchAll(/create function public\.(\w+)\(/g)].map(
    (match) => match[1]
  );

  assert.deepStrictEqual(created, [TOTALS]);
});

test('the function takes no arguments and returns the three declared columns', () => {
  // No parameters: there is nothing to filter by, because the page wants the
  // whole club's history.
  assert.match(
    normalized,
    /create function public\.get_event_attendance_totals\(\)/
  );

  assert.match(
    normalized,
    /returns table \( event_id uuid, attendance_count integer, xp_awarded integer \)/
  );
});

// ---------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------

test('the function is STABLE, so it cannot write', () => {
  // STABLE is a promise the planner relies on: a function that wrote would have
  // to be VOLATILE. This is what makes "analytics are read-only" structural.
  assert.match(
    BODY,
    /language sql stable security definer set search_path = ''/,
    'the function must be STABLE, SECURITY DEFINER and hardened'
  );
});

test('the function body writes nothing', () => {
  assert.doesNotMatch(BODY, /insert into/);
  assert.doesNotMatch(BODY, /\bupdate\b/);
  assert.doesNotMatch(BODY, /\bdelete\b/);
  assert.doesNotMatch(BODY, /\btruncate\b/);
  assert.doesNotMatch(BODY, /\bcall\b/);
});

test('the migration writes nothing outside the function', () => {
  const outsideFunction = normalized.replace(BODY, ' ');

  assert.doesNotMatch(outsideFunction, /insert into/);
  assert.doesNotMatch(outsideFunction, /update public\./);
  assert.doesNotMatch(outsideFunction, /delete from/);
});

test('the function is LANGUAGE sql rather than plpgsql', () => {
  // A set-returning query needs no procedural code, and saying so keeps the
  // body a single SELECT that is easy to read.
  assert.match(BODY, /language sql/);
  assert.doesNotMatch(BODY, /language plpgsql/);
});

// ---------------------------------------------------------------------------
// What it counts
// ---------------------------------------------------------------------------

test('it aggregates from attendance and joins the ledger through the link', () => {
  assert.match(BODY, /from public\.attendance a/);
  assert.match(BODY, /left join public\.xp_ledger x on x\.id = a\.xp_ledger_id/);
});

test('it returns one row per event', () => {
  assert.match(BODY, /group by a\.event_id/);
});

test('attendance that has not been awarded yet is zero, not null', () => {
  // COALESCEd, because an event whose attendance is entirely unawarded must
  // report 0 - a real and temporary state, not an error.
  assert.match(BODY, /coalesce\(sum\(x\.xp_amount\), 0\)::integer/);
});

test('the count and the sum are cast to integer', () => {
  // count(*) and sum() return bigint; the declared columns are integer, so an
  // uncast value would be a return-type mismatch rather than a wrong number.
  assert.match(BODY, /count\(\*\)::integer/);
  assert.match(BODY, /sum\(x\.xp_amount\), 0\)::integer/);
});

test('it does not filter by archive state', () => {
  // An archived event is still history. Filtering here would silently shrink
  // every figure on the page.
  assert.doesNotMatch(BODY, /archived_at/);
  assert.doesNotMatch(BODY, /membership_status/);
});

test('it counts attendance, not members', () => {
  // One row per member per event, so counting rows is counting attendances.
  // A DISTINCT would be a different (and wrong) figure.
  assert.doesNotMatch(BODY, /count\(distinct/);
});

test('the result is ordered deterministically', () => {
  assert.match(BODY, /order by a\.event_id asc/);
});

// ---------------------------------------------------------------------------
// The grant model
// ---------------------------------------------------------------------------

test('the function is NOT executable by anon or authenticated', () => {
  const grantees = granteesOf(TOTALS);

  assert.notEqual(grantees.length, 0, 'the function should have an explicit grant');
  assert.ok(
    !grantees.includes('anon') && !grantees.includes('authenticated'),
    `anon/authenticated must not execute ${TOTALS}, found: ${grantees.join(', ')}`
  );
  assert.deepStrictEqual(grantees, ['service_role']);
});

test('the function is revoked from PUBLIC, anon, and authenticated', () => {
  const revoke = revokes.find((entry) => entry.fn === `public.${TOTALS}`);

  assert.ok(revoke, 'the function must be revoked from the default PUBLIC grant');

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(
      revoke.grantees.includes(role),
      `revoke must name ${role}, found: ${revoke.grantees.join(', ')}`
    );
  }
});

test('the REVOKE runs before the GRANT', () => {
  const revoke = revokes.find((entry) => entry.fn === `public.${TOTALS}`);
  const grant = grants.find((entry) => entry.fn === `public.${TOTALS}`);

  assert.ok(revoke.index < grant.index, 'REVOKE must precede GRANT');
});

// ---------------------------------------------------------------------------
// Scope: nothing else changes
// ---------------------------------------------------------------------------

test('the migration changes no schema', () => {
  assert.doesNotMatch(normalized, /create table/);
  assert.doesNotMatch(normalized, /alter table/);
  assert.doesNotMatch(normalized, /add column/);
  assert.doesNotMatch(normalized, /create index/);
  assert.doesNotMatch(normalized, /create type/);
});

test('the migration never disables RLS or adds a policy', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
});

test('the migration does not touch the other tables', () => {
  const outsideFunction = normalized.replace(BODY, ' ');

  assert.doesNotMatch(outsideFunction, /alter table public\.events/);
  assert.doesNotMatch(outsideFunction, /alter table public\.attendance/);
  assert.doesNotMatch(outsideFunction, /alter table public\.xp_ledger/);
  assert.doesNotMatch(outsideFunction, /alter table public\.members/);
});
