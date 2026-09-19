-- Phase 8B: event analytics
--
-- Adds ONE read-only function that summarises attendance and the XP it awarded,
-- per event:
--
--   get_event_attendance_totals() -> (event_id, attendance_count, xp_awarded)
--
-- WHY A MIGRATION IS GENUINELY REQUIRED
--
-- Every other figure on the analytics page can be derived in application code
-- from rows that are already read cheaply - the event list is a few dozen rows.
-- This one cannot. `xp_awarded` is a SUM across a join from `attendance` to
-- `xp_ledger`, and `attendance` grows without bound: one row per member per
-- event, forever. Doing it in the application means either reading every
-- attendance row into memory on every page load, or issuing a `.in()` over every
-- `xp_ledger_id` - a query that degrades as the club runs more events.
--
-- The function returns ONE ROW PER EVENT, so the result set is bounded by the
-- number of events rather than by the number of attendance records, and the
-- grouping and the join happen where the data is.
--
-- WHAT IS DELIBERATELY NOT ADDED
--   * no table, column or index. Nothing about this phase changes the schema.
--   * no second read of `events`. The event list - titles, types, dates, archive
--     state - is already served by getEvents(), and this function returns only
--     the two aggregates that cannot be derived from it. The page joins the two
--     in application code, which is also what keeps the analytics and the
--     register from disagreeing about which events exist.
--   * no archive filter. Analytics cover the club's whole history, and an
--     archived event is still history - excluding it would quietly shrink every
--     figure on the page.
--   * no write of any kind. The function is STABLE and reads only, which is what
--     "keep analytics read-only" means structurally rather than by convention.
--   * no RLS change and no policy anywhere.

--------------------------------------------------------------------------------
-- 1. get_event_attendance_totals()
--
-- One row per event that has at least one attendance record, carrying how many
-- members were recorded and how much XP that attendance has awarded.
--
-- INNER JOIN from attendance, so an event nobody attended simply does not
-- appear. That is the right shape: the caller already holds the full event list
-- from getEvents(), so an absent row means zero, and returning a row of zeroes
-- for every empty event would be redundant data the caller has to re-join
-- anyway.
--
-- `xp_awarded` is COALESCEd because an attendance row is unawarded until Phase
-- 7B's award runs, and an event whose attendance is entirely unawarded must
-- report 0 rather than NULL. That distinction matters on the page: 0 is "nothing
-- has been awarded yet", which is a real and temporary state.
--
-- The left join to xp_ledger is what makes the sum attributable to ATTENDANCE
-- rather than to the club as a whole. XP awarded through the Award XP panel, or
-- by the onboarding migration, is deliberately not counted here - the page says
-- "XP awarded through attendance" and it means exactly that.
--
-- Ordering is deterministic (event id) so two identical requests return the same
-- rows in the same order. The page re-groups them by event, month and type, so
-- this ordering is for stability rather than for display.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_event_attendance_totals()
RETURNS TABLE (
    event_id UUID,
    attendance_count INTEGER,
    xp_awarded INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        a.event_id AS event_id,
        count(*)::INTEGER AS attendance_count,
        COALESCE(sum(x.xp_amount), 0)::INTEGER AS xp_awarded
    FROM public.attendance a
    LEFT JOIN public.xp_ledger x
      ON x.id = a.xp_ledger_id
    GROUP BY a.event_id
    ORDER BY a.event_id ASC;
$$;

--------------------------------------------------------------------------------
-- 2. Grant model
--
-- Same asymmetry as every other read in this project. The function reports how
-- many members attended each event and how much XP that was worth; if `anon` or
-- `authenticated` could execute it, anyone holding the publishable key could
-- read the club's attendance figures straight from the Supabase RPC endpoint,
-- bypassing the API route that requires a signed session AND a manager email.
-- It is granted to `service_role` alone.
--
-- The REVOKE comes first: functions grant EXECUTE to PUBLIC by default, so
-- granting before revoking would leave that default in force.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_event_attendance_totals()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_attendance_totals()
    TO service_role;

--------------------------------------------------------------------------------
-- 3. COMMENT
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.get_event_attendance_totals() IS
    'Phase 8B: per event, how many attendance records it has and how much XP that attendance has awarded (0 while unawarded). Read-only and STABLE. SERVER-ONLY (service_role) - it exposes club attendance figures, so it is never granted to anon/authenticated.';

--------------------------------------------------------------------------------
-- 4. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `events` and `attendance` keep the Phase 7A state: RLS enabled with no policy
-- at all, so no browser-facing role can reach either table. The function is
-- SECURITY DEFINER and owned by the migration role, which is what lets the
-- service-role client read through it.
