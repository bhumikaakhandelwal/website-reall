// Phase 6: roster validation and onboarding SQL generation.
//
// This module is the GATE between a supplied roster and the generated
// onboarding migration. It is deliberately pure - no database, no filesystem,
// no clock - so the whole of "is this roster safe to turn into SQL?" can be
// asserted on in tests, which is the only way it can be asserted on at all in
// this project (no DOM environment, no integration database).
//
// WHY VALIDATION IS SEPARATE FROM GENERATION
// The generated migration is executed by hand, once, against a live roster of
// real people. A duplicate email in the source would be silently absorbed by
// `ON CONFLICT DO NOTHING` (leaving a member un-awarded), and a malformed one
// would insert a member nobody can log in as. Neither failure is visible after
// the fact, so the roster is checked BEFORE any SQL exists, and generation is
// refused outright if anything is wrong. `validateRoster` returns every problem
// it found rather than the first, so a bad source can be fixed in one pass.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
//   * it does not talk to the database, and so cannot know which members
//     already exist. "Insert missing members only" is expressed in the SQL
//     itself (`ON CONFLICT (email) DO NOTHING`), where it is enforced by the
//     UNIQUE constraint on `members.email` rather than by application code
//     holding a stale copy of the roster.
//   * it does not decide who should receive Membership XP. The SQL does that,
//     set-based, in one place (see renderOnboardingSql).

import { z } from 'zod';

/**
 * The Handbook activity awarded on joining.
 *
 * Must match lib/xp/activities.ts, which is the server's single source of truth
 * for XP amounts. A test pins the two together so this cannot drift.
 */
export const MEMBERSHIP_ACTIVITY_CODE = 'membership';
export const MEMBERSHIP_XP = 50;
export const MEMBERSHIP_REASON = 'Membership';

/**
 * `members.email` is TEXT UNIQUE and the application lowercases before lookup
 * (see POST /api/auth/login), so every roster email is normalized the same way
 * before it is compared or written.
 */
export const MAX_EMAIL_LENGTH = 320;
export const MAX_NAME_LENGTH = 200;

export type RosterEntry = {
  /** Normalized: trimmed and lowercased. */
  email: string;
  /** Normalized: trimmed, internal runs of whitespace collapsed. */
  displayName: string;
};

export type RosterProblemCode =
  | 'not-an-object'
  | 'missing-email'
  | 'malformed-email'
  | 'email-too-long'
  | 'missing-name'
  | 'name-too-long'
  | 'duplicate-email';

export type RosterProblem = {
  code: RosterProblemCode;
  /** 1-based row number, so the operator can find it in the source. */
  row: number;
  message: string;
};

export type RosterValidation =
  | { ok: true; entries: RosterEntry[] }
  | { ok: false; problems: RosterProblem[] };

/** Trim and lowercase. The one normalization applied to every roster email. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Trim, and collapse internal runs of whitespace to a single space.
 *
 * The source is a form export, so names arrive with stray tabs and double
 * spaces ("Akhil  R Nair"). Collapsing here rather than in SQL keeps the
 * generated file readable and makes the normalization testable.
 */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Uses the same rule as the rest of the application (`z.string().email()` in
 * lib/db/schema.ts and the login route), so a roster email this accepts is one
 * the login flow will also accept.
 *
 * Exported since Phase 8D: the manager's Add Member form validates a
 * hand-typed email, and it must accept exactly the same strings the roster
 * importer would. A second copy of this rule is a second answer to "is this a
 * valid DBCE email".
 */
export function isWellFormedEmail(email: string): boolean {
  return z.string().email().safeParse(email).success;
}

/**
 * Validates a roster and returns every problem found.
 *
 * Rows are numbered from 1 and reported in source order. A row that yields two
 * problems yields two entries - the caller prints all of them and fixes the
 * source once, rather than playing whack-a-mole.
 *
 * Duplicates are detected on the NORMALIZED email, because `members.email` is
 * compared lowercased. `A@x.com` and `a@x.com ` are the same member and the
 * second would otherwise be silently swallowed by `ON CONFLICT DO NOTHING`.
 */
export function validateRoster(rows: readonly unknown[]): RosterValidation {
  const problems: RosterProblem[] = [];
  const entries: RosterEntry[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const at = index + 1;

    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      problems.push({
        code: 'not-an-object',
        row: at,
        message: 'row is not an object with email and displayName',
      });
      return;
    }

    const raw = row as Record<string, unknown>;
    const rawEmail = raw.email;
    const rawName = raw.displayName;

    if (typeof rawEmail !== 'string' || rawEmail.trim() === '') {
      problems.push({
        code: 'missing-email',
        row: at,
        message: 'email is missing or not a non-empty string',
      });
    }

    if (typeof rawName !== 'string' || rawName.trim() === '') {
      problems.push({
        code: 'missing-name',
        row: at,
        message: 'displayName is missing or not a non-empty string',
      });
    }

    // Without both strings there is nothing further to check on this row.
    if (typeof rawEmail !== 'string' || typeof rawName !== 'string') return;

    const email = normalizeEmail(rawEmail);
    const displayName = normalizeName(rawName);

    if (email.length > 0 && !isWellFormedEmail(email)) {
      problems.push({
        code: 'malformed-email',
        row: at,
        message: `"${rawEmail}" is not a valid email address`,
      });
    }

    if (email.length > MAX_EMAIL_LENGTH) {
      problems.push({
        code: 'email-too-long',
        row: at,
        message: `email is ${email.length} characters (max ${MAX_EMAIL_LENGTH})`,
      });
    }

    if (displayName.length > MAX_NAME_LENGTH) {
      problems.push({
        code: 'name-too-long',
        row: at,
        message: `displayName is ${displayName.length} characters (max ${MAX_NAME_LENGTH})`,
      });
    }

    if (email !== '') {
      const firstSeenAt = seen.get(email);

      if (firstSeenAt !== undefined) {
        problems.push({
          code: 'duplicate-email',
          row: at,
          message: `"${email}" already appears at row ${firstSeenAt}`,
        });
      } else {
        seen.set(email, at);
      }
    }

    if (displayName !== '') {
      entries.push({ email, displayName });
    }
  });

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  return { ok: true, entries };
}

/**
 * Renders a value as a SQL string literal.
 *
 * Single quotes are DOUBLED, which is the only escaping PostgreSQL string
 * literals need. This matters here: the roster contains both "D'Souza" and
 * "Dsouza", and an unescaped apostrophe would end the literal early and turn
 * the rest of the name into a syntax error.
 *
 * A NUL character is rejected rather than escaped: PostgreSQL cannot store one
 * in a text column at all, so silently emitting it would produce a migration
 * that fails at run time instead of at generation time.
 */
export function quoteSqlLiteral(value: string): string {
  if (value.includes('\u0000')) {
    throw new Error('value contains a NUL character, which PostgreSQL cannot store');
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function renderRosterValues(entries: readonly RosterEntry[]): string {
  return entries
    .map((entry) => `        (${quoteSqlLiteral(entry.email)}, ${quoteSqlLiteral(entry.displayName)})`)
    .join(',\n');
}

/**
 * Renders the Phase 6 onboarding migration.
 *
 * TWO STATEMENTS, NOT ONE, and the reason matters: a data-modifying CTE would
 * NOT work here. PostgreSQL runs the sub-statements of a WITH concurrently and
 * they cannot see each other's effects on the target tables, so a CTE that
 * inserted the members and then awarded XP by joining `members` would award XP
 * to nobody on a fresh database. Separate statements are executed in order and
 * each sees the previous one's writes, which is exactly the guarantee needed.
 *
 * IDEMPOTENCY, both halves:
 *
 *   members    `ON CONFLICT (email) DO NOTHING`, backed by the UNIQUE index
 *              `members_email_key`. A second run inserts nothing. Existing
 *              members are never touched - there is no UPDATE anywhere in this
 *              file - so display names, membership_status and membership dates
 *              that a manager has since corrected all survive.
 *
 *   xp_ledger  guarded by NOT EXISTS on (user_id, activity_code = 'membership'),
 *              so a member who already holds a Membership entry gets nothing
 *              more. This is deliberately "has no Membership entry" rather than
 *              "has no entry of 50 XP": the check has to survive a member whose
 *              entry was later corrected, and it has to be correct even though
 *              the live ledger ALREADY contains a member with two Membership
 *              entries (a pre-existing duplicate this migration must not make
 *              worse, and must not silently delete either).
 *
 * Nothing here writes to `members` beyond inserting absent rows, and nothing
 * touches authorization: the manager allowlist lives in lib/xp/managers.ts and
 * is not represented in the database at all, so no manager assignment can be
 * affected by this file.
 */
export function renderOnboardingSql(entries: readonly RosterEntry[]): string {
  const values = renderRosterValues(entries);
  const count = entries.length;

  return `-- Phase 6: real member onboarding
--
-- GENERATED FILE - do not edit by hand.
-- Regenerate with:
--   node scripts/generate-onboarding-migration.mjs <roster.json> \\
--     supabase/migrations/20260918000001_member_onboarding.sql
--
-- Source of truth: the ${count}-member approved roster, validated before
-- generation (no duplicates, no malformed emails, no empty names).
--
-- IDEMPOTENT. Safe to run any number of times; the second run is a no-op. It
-- never updates and never deletes, so nothing that already exists - members,
-- their status, their membership dates, their XP, or the two-email manager
-- allowlist - can be changed by running it.
--
-- WHAT IT DOES
--   1. inserts members that are not already present, keyed on the UNIQUE
--      members.email index (ON CONFLICT DO NOTHING)
--   2. awards exactly one ${MEMBERSHIP_XP} XP "${MEMBERSHIP_REASON}" entry to each
--      roster member who does not already hold one
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * no UPDATE of any kind. A member already present keeps their display_name,
--     membership_status, membership_start and membership_end exactly as they
--     are; the roster supplies those only for members it inserts.
--   * no DELETE of any kind. In particular it does NOT remove the pre-existing
--     duplicate Membership entry on 2414011@dbcegoa.ac.in (ledger ids 1 and 8):
--     the ledger is an append-only audit trail, and reversing an entry is a
--     correction - a new negative row - not a deletion.
--   * no schema change: no table, column, index, policy or grant. It does not
--     disable RLS and adds no RLS policy.
--   * no XP amount other than ${MEMBERSHIP_XP}, and no activity code other than
--     '${MEMBERSHIP_ACTIVITY_CODE}'. The amount is written here rather than read from
--     lib/xp/activities.ts because SQL cannot import TypeScript; a test pins the
--     two together.
--
-- Runs as the database owner (Supabase SQL Editor or \`supabase db push\`), which
-- bypasses RLS. The application's anon key cannot perform either insert.

--------------------------------------------------------------------------------
-- 1. Insert missing members only
--
-- The roster is a VALUES list, not a temp table or a helper table: it is a
-- one-time list of real people and does not belong in the schema.
--
-- Emails are written already normalized (trimmed, lowercased) because the
-- generator normalized them and the login flow lowercases before lookup. The
-- conflict target is the UNIQUE index on members.email, so a member that
-- already exists is left completely untouched.
--------------------------------------------------------------------------------

INSERT INTO public.members (email, display_name, membership_status)
SELECT v.email, v.display_name, 'active'
FROM (VALUES
${values}
) AS v (email, display_name)
ON CONFLICT (email) DO NOTHING;

--------------------------------------------------------------------------------
-- 2. Award exactly one Membership entry per roster member
--
-- The NOT EXISTS guard is the whole of the duplicate protection. It is
-- evaluated against the ledger as it stands AFTER statement 1, so a member
-- inserted a moment ago is included and a member who already holds a Membership
-- entry is skipped.
--
-- activity_code is set to '${MEMBERSHIP_ACTIVITY_CODE}' - the same code the Award XP
-- panel sends for this activity - so these entries count toward the leaderboards
-- exactly like a manually recorded Membership award, and so the guard above can
-- recognise them on a later run.
--------------------------------------------------------------------------------

INSERT INTO public.xp_ledger (user_id, xp_amount, activity_code, reason)
SELECT m.id, ${MEMBERSHIP_XP}, ${quoteSqlLiteral(MEMBERSHIP_ACTIVITY_CODE)}, ${quoteSqlLiteral(MEMBERSHIP_REASON)}
FROM (VALUES
${values}
) AS v (email, display_name)
JOIN public.members m
  ON m.email = v.email
WHERE NOT EXISTS (
    SELECT 1
    FROM public.xp_ledger x
    WHERE x.user_id = m.id
      AND x.activity_code = ${quoteSqlLiteral(MEMBERSHIP_ACTIVITY_CODE)}
);

--------------------------------------------------------------------------------
-- 3. VERIFY (run by hand after applying; this migration writes nothing else)
--------------------------------------------------------------------------------
-- Expected after a first run on the live database: 42 members, 42 members
-- holding exactly one Membership entry each EXCEPT 2414011@dbcegoa.ac.in, who
-- already held two before this migration ran and still holds two.
--
-- SELECT count(*) AS members FROM public.members;
--
-- SELECT m.email, count(x.id) AS membership_entries
-- FROM public.members m
-- LEFT JOIN public.xp_ledger x
--   ON x.user_id = m.id AND x.activity_code = '${MEMBERSHIP_ACTIVITY_CODE}'
-- GROUP BY m.email
-- HAVING count(x.id) <> 1
-- ORDER BY m.email;
`;
}
