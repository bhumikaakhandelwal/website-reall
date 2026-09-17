-- Phase 4: monthly leaderboards
--
-- Adds ONE read-only function that aggregates xp_ledger into a monthly ranking.
--
-- Deliberately NOT added here:
--   * no leaderboard table, no materialized view, no cached XP total - the
--     ranking is always derived from xp_ledger, exactly like a member's XP
--     total, so it can never drift from the audit trail
--   * no leaderboard-category table - the Handbook's activity -> leaderboard
--     mapping lives in lib/xp/leaderboards.ts, next to the activity list
--     (lib/xp/activities.ts). It is not duplicated in the database, the same
--     way the activity list itself is not
--   * no new RLS policy and no change to any existing one - RLS is untouched
--   * no period arithmetic in SQL - the month window is passed in as an
--     explicit half-open [start, end) range computed by the caller, because
--     `timestamptz + interval '1 month'` is evaluated in the session timezone
--     and can land on the wrong instant across a DST boundary
--
-- SECURITY. The function reads `members` and `xp_ledger`, both of which RLS
-- denies to the anon key, so it is SECURITY DEFINER and follows the Phase 1C
-- hardening pattern (SET search_path = '', fully-qualified names, revoked from
-- PUBLIC). It exposes other members' XP, so it is granted to `service_role`
-- alone, exactly like get_member_xp_total: no browser-facing role may execute
-- it, which keeps the API route (session-verified) the only way to read a
-- leaderboard. See section 3.

--------------------------------------------------------------------------------
-- 1. get_monthly_leaderboard(period_start, period_end, activity_codes)
--
-- Ranks ACTIVE members by the XP they earned inside the half-open window
-- [period_start, period_end).
--
--   activity_codes IS NULL   -> every ledger entry counts, including corrective
--                               adjustments (activity_code IS NULL), which are
--                               part of the member's XP either way.
--   activity_codes IS NOT NULL -> only entries whose activity_code is one of
--                               the supplied Handbook codes count. This is how
--                               the restricted leaderboards (hackathon,
--                               open-source) are expressed without a second
--                               SQL copy of the Handbook's activity list.
--
-- Members with no qualifying entry in the window are NOT returned at all (they
-- have no row to join). A member whose entries net to exactly zero is also
-- excluded - a zero row is not a ranking position. The caller shows its empty
-- state instead.
--
-- Ordering is fully deterministic: XP descending, then display_name, then
-- member id, so two members with the same XP always come back in the same
-- order. The rank number itself is assigned by the caller
-- (assignRanks in lib/xp/leaderboards.ts) so the tie semantics live in one
-- testable place.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_monthly_leaderboard(
    p_period_start TIMESTAMPTZ,
    p_period_end TIMESTAMPTZ,
    p_activity_codes TEXT[]
)
RETURNS TABLE (
    member_id UUID,
    display_name TEXT,
    xp INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ranked.member_id, ranked.display_name, ranked.xp
    FROM (
        SELECT m.id AS member_id,
               m.display_name AS display_name,
               SUM(x.xp_amount)::INTEGER AS xp
        FROM public.members m
        JOIN public.xp_ledger x
          ON x.user_id = m.id
         AND x.created_at >= p_period_start
         AND x.created_at < p_period_end
         AND (p_activity_codes IS NULL
              OR x.activity_code = ANY (p_activity_codes))
        WHERE m.membership_status = 'active'
        GROUP BY m.id, m.display_name
        HAVING SUM(x.xp_amount) <> 0
    ) AS ranked
    ORDER BY ranked.xp DESC, ranked.display_name ASC, ranked.member_id ASC;
$$;

--------------------------------------------------------------------------------
-- 2. Grant model
--
-- Same asymmetry as Phase 3: this function returns OTHER members' XP, so no
-- browser-facing role may execute it. If `anon` / `authenticated` could, anyone
-- holding the publishable key could read the whole leaderboard straight from
-- the Supabase RPC endpoint, bypassing the API route that requires a signed
-- session.
--
-- The REVOKE comes first: functions grant EXECUTE to PUBLIC by default, so
-- granting before revoking would leave that default in force and every role
-- would keep access.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_monthly_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ, TEXT[])
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_monthly_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ, TEXT[])
    TO service_role;

--------------------------------------------------------------------------------
-- 3. COMMENT
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.get_monthly_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) IS
    'Phase 4: active members ranked by XP earned in the half-open window [period_start, period_end), summed from xp_ledger. activity_codes NULL counts every entry; otherwise only the supplied Handbook activity codes. SERVER-ONLY (service_role) - it exposes other members'' XP, so it is never granted to anon/authenticated.';

--------------------------------------------------------------------------------
-- 4. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `members` and `xp_ledger` keep exactly the Phase 1B policies; the function
-- above is the narrow, read-only exception that lets the server aggregate them.
