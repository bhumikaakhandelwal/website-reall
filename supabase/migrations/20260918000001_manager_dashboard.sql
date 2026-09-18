-- Phase 5C: the manager dashboard
--
-- Adds TWO narrow read-only functions so the manager-only /manager page has a
-- fixed number of queries behind it:
--
--   1. get_month_xp_total(period_start, period_end)
--        the net XP recorded in the ledger inside a half-open month window
--   2. get_recent_xp_entries(p_limit)
--        the most recent ledger entries, with the member's display name
--
-- Deliberately NOT added here:
--   * no dashboard table, no materialized view, no cached counter - every
--     figure on the dashboard is derived from xp_ledger and members on each
--     call, exactly like a member's XP total and the leaderboards, so no
--     dashboard number can drift from the audit trail
--   * no member count function - "Total Members" and "Active Members" are the
--     length and the status count of the SAME roster the directory page reads
--     (get_member_directory, Phase 5A), so the dashboard and the directory can
--     never disagree about how many members there are. Counting rows in
--     application code over a few dozen rows is cheaper than a second query.
--   * no month arithmetic in SQL - the window is passed in as an explicit
--     half-open [start, end) range computed by the caller in UTC, for the same
--     reason as Phase 4: `timestamptz + interval '1 month'` is evaluated in the
--     session timezone and can land on the wrong instant across a DST boundary
--   * no role column and no permission change - Phase 3's two-email allowlist
--     (lib/xp/managers.ts) remains the only authorization mechanism, and it is
--     evaluated in the API route, not in the database
--   * no new RLS policy and no change to any existing one - RLS is untouched
--
-- SECURITY. Both functions read `xp_ledger` (and the first also `members`),
-- which RLS denies to the anon key, so they are SECURITY DEFINER and follow the
-- Phase 1C hardening pattern (SET search_path = '', fully-qualified names,
-- revoked from PUBLIC). Both expose other members' XP, so both are granted to
-- `service_role` alone: no browser-facing role may execute them, which keeps the
-- session- and manager-checked API route the only way to read a dashboard. See
-- section 3.

--------------------------------------------------------------------------------
-- 1. get_month_xp_total(period_start, period_end)
--
-- The net XP recorded in the ledger during the half-open window
-- [p_period_start, p_period_end), across EVERY ledger entry.
--
-- WHY THIS IS NOT get_monthly_leaderboard. The Phase 4 aggregation answers
-- "who is winning this month", so it applies two RANKING rules that are wrong
-- for a total: it keeps only `membership_status = 'active'` members, and it
-- drops any member whose entries net to exactly zero (HAVING SUM(...) <> 0).
-- Summing its rows would therefore under-report a month in which a pending or
-- inactive member earned XP. This function answers "how much XP moved this
-- month", which is a ledger fact rather than a ranking fact, so it joins
-- nothing and filters nothing but the window. tests/manager-dashboard-core
-- .test.mjs pins that difference so the two cannot be conflated by accident.
--
-- "Net", not "gross": corrective entries carry a negative xp_amount and are
-- part of the ledger, so a month in which a mistake was corrected reports what
-- the members actually have, not what was originally handed out. That matches
-- the XP totals shown everywhere else in the application.
--
-- COALESCEd, so a month with no entries at all is a genuine 0 rather than NULL.
-- A caller that cannot tell "nothing happened" from "the read failed" would
-- render a confident zero over a broken query, so this function never returns
-- NULL for an empty window - a real failure surfaces as an error from the RPC
-- instead.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_month_xp_total(
    p_period_start TIMESTAMPTZ,
    p_period_end TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(SUM(x.xp_amount), 0)::INTEGER
    FROM public.xp_ledger x
    WHERE x.created_at >= p_period_start
      AND x.created_at < p_period_end;
$$;

--------------------------------------------------------------------------------
-- 2. get_recent_xp_entries(p_limit)
--
-- The most recent ledger entries, newest first, each with the display name of
-- the member it belongs to.
--
-- The limit is applied HERE rather than by fetching the ledger and slicing it
-- in the application: the ledger grows without bound, and "the last 10 rows" is
-- a question the database can answer with an index walk instead of a full read.
--
-- The limit is CLAMPED (1..100) so the function is safe to call with any
-- argument, including a negative or absurd one. A LIMIT of 0 or -1 would be a
-- silently empty dashboard; a caller asking for a million rows would be a
-- denial-of-service the database could not refuse. LEAST/GREATEST ignore NULL,
-- so a NULL limit becomes 1 rather than an unbounded read.
--
-- INNER JOIN, not LEFT: `xp_ledger.user_id` is NOT NULL and references
-- `members(id)` ON DELETE CASCADE, so every ledger row has a member and an
-- inner join cannot drop one. (This is the opposite of get_member_directory,
-- where the LEFT JOIN is what keeps a member with no entries in the roster.)
--
-- Ordering is fully deterministic - created_at DESC, then id DESC - so the
-- "last 10" list never reshuffles between two identical requests, including
-- when several entries share a timestamp. `id` is SERIAL, so it is a strictly
-- increasing insertion counter and therefore a correct tie-break.
--
-- `reason` and `activity_code` are returned as-is and may be NULL: the ledger
-- column is nullable, and an entry written before Phase 3 has no activity code.
-- The caller renders a fallback rather than this function inventing one.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_recent_xp_entries(p_limit INTEGER)
RETURNS TABLE (
    entry_id INTEGER,
    member_id UUID,
    display_name TEXT,
    xp_amount INTEGER,
    activity_code TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        x.id AS entry_id,
        m.id AS member_id,
        m.display_name AS display_name,
        x.xp_amount AS xp_amount,
        x.activity_code AS activity_code,
        x.reason AS reason,
        x.created_at AS created_at
    FROM public.xp_ledger x
    JOIN public.members m
      ON m.id = x.user_id
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

--------------------------------------------------------------------------------
-- 3. Grant model
--
-- Same asymmetry as Phase 3, 4 and 5A: both functions expose OTHER members' XP,
-- so no browser-facing role may execute them. If `anon` / `authenticated`
-- could, anyone holding the publishable key could read the club's recent ledger
-- straight from the Supabase RPC endpoint, bypassing the API route that
-- requires a signed session AND a manager email.
--
-- The REVOKE comes first: functions grant EXECUTE to PUBLIC by default, so
-- granting before revoking would leave that default in force and every role
-- would keep access.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_month_xp_total(TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_recent_xp_entries(INTEGER)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_month_xp_total(TIMESTAMPTZ, TIMESTAMPTZ)
    TO service_role;

GRANT EXECUTE ON FUNCTION public.get_recent_xp_entries(INTEGER)
    TO service_role;

--------------------------------------------------------------------------------
-- 4. COMMENTS
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.get_month_xp_total(TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Phase 5C: net XP recorded in xp_ledger during the half-open window [period_start, period_end), across every ledger entry regardless of membership status. Deliberately NOT the leaderboard aggregation, which filters to active members and drops zero rows. SERVER-ONLY (service_role).';

COMMENT ON FUNCTION public.get_recent_xp_entries(INTEGER) IS
    'Phase 5C: the most recent ledger entries with their member display name, newest first (created_at DESC, id DESC), limited to 1..100. SERVER-ONLY (service_role) - it exposes other members'' XP, so it is never granted to anon/authenticated.';

--------------------------------------------------------------------------------
-- 5. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `members` and `xp_ledger` keep exactly the Phase 1B policies; the two
-- functions above are the narrow, read-only exceptions that let the server
-- summarise them.
