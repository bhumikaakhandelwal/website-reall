// Phase 7B migration tests.
//
// These two functions are the FIRST in this project that WRITE: one inserts
// into xp_ledger (the audit trail), the other deletes from attendance. If
// `anon` or `authenticated` could execute either, anyone holding the publishable
// key could hand out XP to an entire event, or wipe an event's attendance,
// straight through the Supabase RPC endpoint - and neither function can check
// who is calling, because the manager allowlist lives in lib/xp/managers.ts and
// is not represented in the database at all. The grant model is therefore the
// most important thing here.
//
// The rest pins the properties that make the operations correct:
//
//   * the award takes a row lock, so concurrent clicks cannot double-award
//   * the award touches only rows where xp_ledger_id IS NULL - the idempotency
//     guard, and the reason Phase 7A added that column
//   * the save deletes only UNAWARDED rows, so an awarded attendance is never
//     removed and the ledger link is never orphaned
//   * the activity code and the reason come from the event row, not from a
//     parameter, so a client cannot invent either
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION_URL = new URL(
  '../supabase/migrations/20260919000001_attendance_awards.sql',
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

/** One function's body, from its CREATE to the closing `$$;`. */
function definitionOf(fn) {
  const start = normalized.indexOf(`create function public.${fn}(`);

  assert.notEqual(start, -1, `${fn} must be created by this migration`);

  const end = normalized.indexOf('$$;', start);

  assert.notEqual(end, -1, `${fn} must have a body terminator`);

  return normalized.slice(start, end);
}

const SET_ATTENDANCE = 'set_event_attendance';
const AWARD_ATTENDANCE = 'award_event_attendance';

const SET_BODY = definitionOf(SET_ATTENDANCE);
const AWARD_BODY = definitionOf(AWARD_ATTENDANCE);

// ---------------------------------------------------------------------------
// What the migration creates
// ---------------------------------------------------------------------------

test('the migration creates exactly the two functions', () => {
  const created = [...normalized.matchAll(/create function public\.(\w+)\(/g)].map(
    (match) => match[1]
  );

  assert.deepStrictEqual(created.sort(), [AWARD_ATTENDANCE, SET_ATTENDANCE].sort());
});

test('set_event_attendance takes an event and an array of member ids', () => {
  assert.match(
    normalized,
    /create function public\.set_event_attendance\( p_event_id uuid, p_member_ids uuid\[\] \)/
  );
});

test('award_event_attendance takes an event and an XP amount', () => {
  assert.match(
    normalized,
    /create function public\.award_event_attendance\( p_event_id uuid, p_xp_amount integer \)/
  );
});

test('set_event_attendance reports what changed', () => {
  assert.match(
    normalized,
    /returns table \( added integer, removed integer, kept_awarded integer \)/
  );
});

test('award_event_attendance reports who it paid', () => {
  assert.match(normalized, /returns table \( member_id uuid, ledger_id integer \)/);
});

// ---------------------------------------------------------------------------
// The grant model - the most important part
// ---------------------------------------------------------------------------

test('neither function is executable by anon or authenticated', () => {
  for (const fn of [SET_ATTENDANCE, AWARD_ATTENDANCE]) {
    const grantees = granteesOf(fn);

    assert.notEqual(grantees.length, 0, `${fn} should have an explicit grant`);
    assert.ok(
      !grantees.includes('anon') && !grantees.includes('authenticated'),
      `anon/authenticated must not execute ${fn}, found: ${grantees.join(', ')}`
    );
    assert.deepStrictEqual(grantees, ['service_role']);
  }
});

test('both functions are revoked from PUBLIC, anon, and authenticated', () => {
  for (const fn of [SET_ATTENDANCE, AWARD_ATTENDANCE]) {
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
  // the ability to hand out XP.
  for (const fn of [SET_ATTENDANCE, AWARD_ATTENDANCE]) {
    const revoke = revokes.find((entry) => entry.fn === `public.${fn}`);
    const grant = grants.find((entry) => entry.fn === `public.${fn}`);

    assert.ok(revoke.index < grant.index, `${fn}: REVOKE must precede GRANT`);
  }
});

test('both functions keep the Phase 1C hardening', () => {
  for (const fn of [SET_ATTENDANCE, AWARD_ATTENDANCE]) {
    assert.match(
      definitionOf(fn),
      /language plpgsql security definer set search_path = ''/,
      `${fn} must be a hardened SECURITY DEFINER`
    );
  }
});

// ---------------------------------------------------------------------------
// set_event_attendance
// ---------------------------------------------------------------------------

test('saving attendance relies on the UNIQUE constraint for duplicate protection', () => {
  // The constraint Phase 7A added is what makes recording the same member twice
  // impossible, however many times the save runs.
  assert.match(
    SET_BODY,
    /on conflict \(event_id, member_id\) do nothing/
  );
});

test('saving attendance never deletes an awarded row', () => {
  // The delete is scoped to rows with no ledger link. An awarded attendance
  // must survive: the XP has been given and the ledger points at that row.
  assert.match(SET_BODY, /delete from public\.attendance/);
  assert.match(SET_BODY, /a\.xp_ledger_id is null/);
});

test('saving attendance only adds members who really exist', () => {
  // Joining `members` filters out a stale id rather than raising a foreign key
  // violation - the right answer for a page whose roster went stale.
  assert.match(SET_BODY, /from public\.members m where m\.id = any \(p_member_ids\)/);
});

test('saving attendance refuses a NULL array rather than clearing the event', () => {
  // A NULL is a caller bug. Treating it as "nobody attended" would silently
  // wipe an event's attendance.
  assert.match(SET_BODY, /if p_member_ids is null then/);
  assert.match(SET_BODY, /raise exception/);
});

test('saving attendance refuses an unknown event', () => {
  assert.match(SET_BODY, /if not exists \(select 1 from public\.events e where e\.id = p_event_id\)/);
  assert.match(SET_BODY, /raise exception 'event % does not exist'/);
});

test('saving attendance writes no XP', () => {
  assert.doesNotMatch(SET_BODY, /insert into public\.xp_ledger/);
});

// ---------------------------------------------------------------------------
// award_event_attendance
// ---------------------------------------------------------------------------

test('the award touches only rows that have not been awarded', () => {
  // This IS the idempotency guard: a second run finds nothing to do.
  assert.match(AWARD_BODY, /a\.xp_ledger_id is null/);
});

test('the award locks the rows it is about to pay', () => {
  // Without FOR UPDATE, two managers clicking at the same moment would both
  // read the same unawarded rows and award every attendee twice. With it, the
  // second call blocks, re-reads the committed row, sees it is no longer NULL
  // and skips it.
  assert.match(AWARD_BODY, /for update/);
});

test('the award inserts a ledger entry and links it in the same function', () => {
  assert.match(
    AWARD_BODY,
    /insert into public\.xp_ledger \(user_id, xp_amount, activity_code, reason\)/
  );
  assert.match(AWARD_BODY, /returning id into v_ledger_id/);
  assert.match(AWARD_BODY, /update public\.attendance set xp_ledger_id = v_ledger_id/);
});

test('the award takes the activity code and the reason from the event, not a parameter', () => {
  // The caller supplies only the event id and the amount, so a client cannot
  // invent an activity or a reason.
  assert.match(AWARD_BODY, /select e\.activity_code, e\.title into v_activity_code, v_title/);

  const signature = normalized.match(
    /create function public\.award_event_attendance\(([^)]*)\)/
  )[1];

  assert.match(signature, /p_event_id uuid/);
  assert.match(signature, /p_xp_amount integer/);
  assert.doesNotMatch(signature, /activity_code/, 'the activity code must not be a parameter');
  assert.doesNotMatch(signature, /reason/, 'the reason must not be a parameter');
  assert.doesNotMatch(signature, /member/, 'the member must not be a parameter');
});

test('the award range-checks the amount before writing it', () => {
  // Not a Handbook rule - a guard so a bug upstream cannot write a wild value
  // into an audit trail that is meant to be permanent.
  assert.match(AWARD_BODY, /if p_xp_amount is null or p_xp_amount < 1 or p_xp_amount > 1000/);
  assert.match(AWARD_BODY, /raise exception 'refusing to award % xp'/);
});

test('the award refuses an unknown event', () => {
  assert.match(AWARD_BODY, /if not found then/);
  assert.match(AWARD_BODY, /raise exception 'event % does not exist'/);
});

test('the award does not store or infer an XP amount of its own', () => {
  // The amount is a parameter resolved from lib/xp/activities.ts. There is no
  // second copy of the Handbook in SQL.
  assert.doesNotMatch(AWARD_BODY, /case .* when/);
  assert.doesNotMatch(normalized, /'membership', 50/);
});

// ---------------------------------------------------------------------------
// Scope: nothing else changes
// ---------------------------------------------------------------------------

test('the migration adds no table, column, index or policy', () => {
  assert.doesNotMatch(normalized, /create table/);
  assert.doesNotMatch(normalized, /add column/);
  assert.doesNotMatch(normalized, /create index/);
  assert.doesNotMatch(normalized, /create policy/);
  assert.doesNotMatch(normalized, /drop policy/);
  assert.doesNotMatch(normalized, /alter table/);
});

test('the migration never disables RLS', () => {
  assert.doesNotMatch(normalized, /disable row level security/);
});

test('the migration does not touch the existing tables or their data', () => {
  // The only writes are the ones inside the two function bodies.
  const outsideFunctions = normalized
    .replace(SET_BODY, ' ')
    .replace(AWARD_BODY, ' ');

  assert.doesNotMatch(outsideFunctions, /insert into/);
  assert.doesNotMatch(outsideFunctions, /update public\./);
  assert.doesNotMatch(outsideFunctions, /delete from/);
});
