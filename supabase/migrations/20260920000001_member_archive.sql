-- Phase 8E: member lifecycle (archive / restore)
--
-- Mirrors Phase 8A's event lifecycle exactly: two nullable columns, a guarded
-- UPDATE to archive, and no new state machine. There is deliberately NO
-- `deleted` state and no DELETE anywhere - a member is a permanent club record
-- that XP, attendance and event authorship all point at.
--
-- WHAT THIS ADDS
--
--   members.archived_at  - when the member was archived, or NULL while active
--   members.archived_by  - which auth user archived them
--
-- plus one column on get_member_directory, so the application can split the
-- roster into its active and archived halves from the ONE directory read it
-- already makes, rather than introducing a second definition of "the roster".
--
-- WHY A MIGRATION IS GENUINELY REQUIRED
--
-- Two new facts have to be stored, and there is nowhere else to put them.
-- `membership_status` cannot carry this: it already means something else
-- (deactivated, which refuses sign-in at the door), whereas an ARCHIVED member
-- must still be able to sign in and read their own XP and history. They are
-- different states with different consequences, and collapsing them into one
-- column would lose the distinction the phase brief depends on.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * no data. No member is inserted, updated or deleted. All 42 existing
--     members keep every column exactly as it is and get archived_at = NULL,
--     which is precisely the "active" state the new reads look for.
--   * no XP, attendance, event, level or leaderboard change. The ledger is
--     append-only and is not touched by archiving anything.
--   * no cascade. `archived_by` is ON DELETE SET NULL: deleting an auth account
--     must never delete or blank a member.
--   * no `deleted_at`, no `is_deleted`, and no DELETE path. Archiving is
--     reversible by design; deletion is not, and this phase does not add it.
--   * no RLS policy added or dropped, and RLS is not disabled.
--   * no index. The roster is a few dozen rows and is read whole; the active /
--     archived split happens in application code, so an index would have
--     nothing to do.

--------------------------------------------------------------------------------
-- 1. The archive columns
--------------------------------------------------------------------------------

ALTER TABLE public.members
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.members.archived_at IS
    'Phase 8E: when the member was archived, or NULL while active. An archived member keeps their XP, attendance and history, still signs in, and is hidden from the roster, the attendance picker and the Add Member duplicate check. Reversible via restore.';

COMMENT ON COLUMN public.members.archived_by IS
    'Phase 8E: the auth user who archived this member. NULL while active. ON DELETE SET NULL - deleting an auth account must never delete a member.';

--------------------------------------------------------------------------------
-- 2. get_member_directory gains archived_at
--
-- The directory is the ONE definition of "the roster" (Phase 5A), and both the
-- active and archived lists have to come from it - otherwise /manager/members
-- and /members could disagree about who is on the roster. So the split is added
-- to the read that already exists rather than to a second one.
--
-- DROP then CREATE, not CREATE OR REPLACE: PostgreSQL refuses to change a
-- function's RETURNS TABLE shape in place. The grants are therefore re-issued
-- below, because dropping a function drops them with it.
--
-- The body is otherwise identical to Phase 5A's - same join, same sum, same
-- ordering - so every existing caller sees exactly the same rows in the same
-- order, with one extra column.
--------------------------------------------------------------------------------

DROP FUNCTION public.get_member_directory();

CREATE FUNCTION public.get_member_directory()
RETURNS TABLE (
    member_id UUID,
    email TEXT,
    display_name TEXT,
    membership_status TEXT,
    created_at TIMESTAMPTZ,
    total_xp INTEGER,
    archived_at TIMESTAMPTZ
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
        COALESCE(SUM(x.xp_amount), 0)::INTEGER AS total_xp,
        m.archived_at AS archived_at
    FROM public.members m
    LEFT JOIN public.xp_ledger x
      ON x.user_id = m.id
    GROUP BY m.id, m.email, m.display_name, m.membership_status, m.created_at, m.archived_at
    ORDER BY m.display_name ASC, m.id ASC;
$$;

COMMENT ON FUNCTION public.get_member_directory() IS
    'Phase 5A, extended in 8E: the whole roster with each member''s total XP and archive state, ordered by display name. Read-only and STABLE. SERVER-ONLY (service_role) - it exposes every member''s email address.';

--------------------------------------------------------------------------------
-- 3. Grants
--
-- Same asymmetry as every other read in this project. The directory exposes
-- every member's email address, so `anon` and `authenticated` must not be able
-- to execute it; it is granted to `service_role` alone. The REVOKE comes first,
-- because functions grant EXECUTE to PUBLIC by default.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_member_directory() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_member_directory() TO service_role;

--------------------------------------------------------------------------------
-- 4. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `members` keeps the Phase 1B-era policy documented in
-- 20260919000004_member_auth.sql - still inert, still flagged there rather than
-- silently changed here.
