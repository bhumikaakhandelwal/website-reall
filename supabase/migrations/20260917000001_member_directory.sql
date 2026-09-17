-- Phase 5A: the member directory
--
-- Adds ONE read-only function that lists every member with their ledger-derived
-- total XP, so the manager-only directory page has a single query behind it.
--
-- Deliberately NOT added here:
--   * no total_xp column, no cached total, no materialized view - the total is
--     summed from xp_ledger on every call, exactly like a member's own XP
--     total, so it can never drift from the audit trail
--   * no level column - which level a total falls into is derived in
--     lib/xp/levels.ts from the `levels` table, and duplicating that decision in
--     SQL would create a second, silently divergent copy of the Handbook
--   * no search/filter parameter - the directory is a few dozen rows and the
--     manager searches it in the browser; a server-side search would add
--     surface without changing what an authorised caller can read
--   * no role column and no permission change - Phase 3's two-email allowlist
--     (lib/xp/managers.ts) remains the only authorization mechanism, and it is
--     evaluated in the API route, not in the database
--   * no new RLS policy and no change to any existing one - RLS is untouched
--
-- SECURITY. The function reads `members`, which RLS denies to the anon key, so
-- it is SECURITY DEFINER and follows the Phase 1C hardening pattern
-- (SET search_path = '', fully-qualified names, revoked from PUBLIC). It returns
-- EVERY member's email and XP, so it is granted to `service_role` alone,
-- exactly like get_member_xp_total and get_monthly_leaderboard: no
-- browser-facing role may execute it, which keeps the session- and
-- manager-checked API route the only way to read the directory. See section 2.

--------------------------------------------------------------------------------
-- 1. get_member_directory()
--
-- Every member, with their total XP summed from the ledger.
--
-- "Total XP" here is the same quantity GET /api/xp/me reports for one member,
-- computed the same way (SUM over xp_ledger), so a member's own page and their
-- directory row can never disagree.
--
-- LEFT JOIN, not JOIN: a member with no ledger rows at all is still a member
-- and must appear, at zero. That is also why the sum is COALESCEd - an INNER
-- JOIN would silently drop every member who has not earned anything yet, which
-- on a young roster is most of them.
--
-- No membership_status filter. The directory is the one place the whole roster
-- is meant to be visible, including pending and inactive members, so that a
-- manager can see the status that explains a missing leaderboard entry rather
-- than having to guess at one. The status is returned as a column.
--
-- Ordering is fully deterministic - display_name, then member id - so the list
-- never reshuffles between two identical requests. It is deliberately not
-- XP-ordered: this is a roster, not a ranking, and the leaderboards already
-- rank.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_member_directory()
RETURNS TABLE (
    member_id UUID,
    email TEXT,
    display_name TEXT,
    membership_status TEXT,
    created_at TIMESTAMPTZ,
    total_xp INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        m.id AS member_id,
        m.email AS email,
        m.display_name AS display_name,
        m.membership_status AS membership_status,
        m.created_at AS created_at,
        COALESCE(SUM(x.xp_amount), 0)::INTEGER AS total_xp
    FROM public.members m
    LEFT JOIN public.xp_ledger x
      ON x.user_id = m.id
    GROUP BY m.id, m.email, m.display_name, m.membership_status, m.created_at
    ORDER BY m.display_name ASC, m.id ASC;
$$;

--------------------------------------------------------------------------------
-- 2. Grant model
--
-- Same asymmetry as Phase 3 and Phase 4: this function returns OTHER members'
-- email addresses and XP, so no browser-facing role may execute it. If `anon` /
-- `authenticated` could, anyone holding the publishable key could dump the
-- entire member roster straight from the Supabase RPC endpoint, bypassing the
-- API route that requires a signed session AND a manager email.
--
-- The REVOKE comes first: functions grant EXECUTE to PUBLIC by default, so
-- granting before revoking would leave that default in force and every role
-- would keep access.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_member_directory()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_member_directory()
    TO service_role;

--------------------------------------------------------------------------------
-- 3. COMMENT
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.get_member_directory() IS
    'Phase 5A: every member with their total XP summed from xp_ledger. SERVER-ONLY (service_role) - it exposes every member''s email and XP, so it is never granted to anon/authenticated.';

--------------------------------------------------------------------------------
-- 4. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `members` and `xp_ledger` keep exactly the Phase 1B policies; the function
-- above is the narrow, read-only exception that lets the server list them.
