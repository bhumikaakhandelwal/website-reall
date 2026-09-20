-- Phase 7B: attendance and bulk XP awards
--
-- Adds TWO functions that make the two Phase 7B operations atomic:
--
--   1. set_event_attendance(event_id, member_ids)  - save who was present
--   2. award_event_attendance(event_id, xp_amount) - award every unawarded
--                                                    attendee, once each
--
-- WHY A MIGRATION IS GENUINELY NEEDED
--
-- Phase 7A added the tables; Phase 7B could in principle be written entirely in
-- application code against them. It cannot be written CORRECTLY that way:
--
--   * The award inserts one ledger row per attendee and then links it back
--     through attendance.xp_ledger_id. Doing that as separate statements means
--     a failure between the two leaves an XP entry in the audit trail that no
--     attendance row points at - and, worse, a second attempt would award it
--     AGAIN, because the row is still "unawarded". The two halves must commit
--     together or not at all, and supabase-js has no multi-statement
--     transaction; an RPC is the only way to get one.
--
--   * "Award only rows where xp_ledger_id IS NULL" is a read-then-write, and
--     two managers clicking the button at the same moment would both read the
--     same unawarded rows and both award them. The function takes a row lock
--     (FOR UPDATE) so the second call blocks, re-reads the row, sees it is no
--     longer NULL and skips it. There is no application-level equivalent.
--
--   * Saving attendance is an insert of the newly-checked members plus a delete
--     of the unchecked ones. Split across two round trips, a failure between
--     them leaves the event half-saved.
--
-- WHAT IS DELIBERATELY NOT ADDED
--   * no XP amount anywhere in the schema. The amount is still resolved from
--     lib/xp/activities.ts, which remains the single source of truth for the
--     Handbook. The function takes it as a parameter, and the route is the only
--     caller - see the trust note below.
--   * no new table, column, index or RLS policy. Phase 7A's UNIQUE (event_id,
--     member_id) constraint and its partial index on the unawarded rows are
--     exactly what these functions use.
--   * no change to `members`, `levels` or `xp_ledger`'s shape.

--------------------------------------------------------------------------------
-- 1. set_event_attendance(event_id, member_ids)
--
-- Replaces the saved attendance for one event with the supplied set, and
-- reports what changed.
--
-- ADD: every supplied member who is not already recorded. The conflict target
-- is Phase 7A's UNIQUE (event_id, member_id), so recording the same member
-- twice is impossible however many times this runs - which is the duplicate
-- protection the phase brief asks for, enforced by the database rather than by
-- application code holding a stale copy of the roster.
--
-- REMOVE: members no longer supplied, but ONLY where nothing has been awarded
-- yet (xp_ledger_id IS NULL). An awarded row is never deleted: the XP has been
-- given, the ledger points at that row, and un-recording attendance must not
-- orphan an audit-trail entry. Unchecking an already-awarded member therefore
-- leaves the row in place and is reported back in `kept_awarded`, so the page
-- can say so rather than silently ignoring the click.
--
-- Member ids that are not real members are ignored rather than raising: the
-- join to `members` filters them, which is the right answer for a page whose
-- roster went stale while it was open. A NULL array is a caller bug, not
-- "nobody attended", so it raises rather than clearing the event.
--------------------------------------------------------------------------------

CREATE FUNCTION public.set_event_attendance(
    p_event_id UUID,
    p_member_ids UUID[]
)
RETURNS TABLE (
    added INTEGER,
    removed INTEGER,
    kept_awarded INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_added INTEGER := 0;
    v_removed INTEGER := 0;
    v_kept INTEGER := 0;
BEGIN
    IF p_member_ids IS NULL THEN
        RAISE EXCEPTION 'member ids must be an array, not NULL'
            USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
        RAISE EXCEPTION 'event % does not exist', p_event_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- 1. Add the members who are present now.
    WITH inserted AS (
        INSERT INTO public.attendance (event_id, member_id)
        SELECT p_event_id, m.id
          FROM public.members m
         WHERE m.id = ANY (p_member_ids)
        ON CONFLICT (event_id, member_id) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM inserted;

    -- 2. Remove the members who are no longer present, unless already awarded.
    WITH deleted AS (
        DELETE FROM public.attendance a
         WHERE a.event_id = p_event_id
           AND a.xp_ledger_id IS NULL
           AND a.member_id <> ALL (p_member_ids)
        RETURNING 1
    )
    SELECT count(*) INTO v_removed FROM deleted;

    -- 3. Report the awarded rows that were unchecked and therefore kept.
    SELECT count(*) INTO v_kept
      FROM public.attendance a
     WHERE a.event_id = p_event_id
       AND a.xp_ledger_id IS NOT NULL
       AND a.member_id <> ALL (p_member_ids);

    RETURN QUERY SELECT v_added, v_removed, v_kept;
END;
$$;

--------------------------------------------------------------------------------
-- 2. award_event_attendance(event_id, xp_amount)
--
-- Awards every attendee of one event who has not already been awarded, and
-- links each new ledger entry back to its attendance row. Returns the members
-- it awarded, so the page can report a count.
--
-- IDEMPOTENT BY CONSTRUCTION. The loop selects only rows with
-- xp_ledger_id IS NULL and sets that column in the same transaction, so a
-- second run finds nothing to do and awards nobody. This is the phase brief's
-- "award only rows where xp_ledger_id IS NULL", and it is why Phase 7A added
-- that column rather than leaving the link to be inferred.
--
-- CONCURRENCY. FOR UPDATE takes a row lock before the ledger entry is written.
-- A second call that started at the same moment blocks on the first row, and
-- when the lock is released PostgreSQL re-evaluates the qualification against
-- the committed row: xp_ledger_id is no longer NULL, so the row is skipped.
-- Without the lock both calls would read the same unawarded rows and award
-- every attendee twice.
--
-- THE ACTIVITY CODE AND THE REASON COME FROM THE EVENT ROW, never from the
-- caller, so a client cannot invent either. Only the XP AMOUNT is passed in,
-- because the Handbook's activity -> amount table lives in lib/xp/activities.ts
-- and SQL cannot import TypeScript. The route resolves it from the event's own
-- activity code, which is what keeps "no custom XP amounts" true end to end: a
-- manager's action carries no number at all.
--
-- The amount is range-checked (1..1000). That is not a Handbook rule - it is a
-- guard so that a bug upstream cannot write a wild value into an audit trail
-- that is meant to be the permanent record.
--
-- `reason` is the EVENT TITLE rather than the activity label. The ledger's
-- activity_code column already carries the activity; for an attendance award
-- the useful answer to "why did this member get XP" is which event they were at.
--------------------------------------------------------------------------------

CREATE FUNCTION public.award_event_attendance(
    p_event_id UUID,
    p_xp_amount INTEGER
)
RETURNS TABLE (
    member_id UUID,
    ledger_id INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_activity_code TEXT;
    v_title TEXT;
    v_row RECORD;
    v_ledger_id INTEGER;
BEGIN
    SELECT e.activity_code, e.title
      INTO v_activity_code, v_title
      FROM public.events e
     WHERE e.id = p_event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'event % does not exist', p_event_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF p_xp_amount IS NULL OR p_xp_amount < 1 OR p_xp_amount > 1000 THEN
        RAISE EXCEPTION 'refusing to award % XP', p_xp_amount
            USING ERRCODE = 'check_violation';
    END IF;

    -- Aliases are deliberately short and non-colliding: this function's OUT
    -- parameters are named member_id and ledger_id, and a bare `member_id` in
    -- the body would be ambiguous between the column and the variable.
    FOR v_row IN
        SELECT a.id AS attendance_row, a.member_id AS attendee
          FROM public.attendance a
         WHERE a.event_id = p_event_id
           AND a.xp_ledger_id IS NULL
         ORDER BY a.recorded_at, a.id
         FOR UPDATE
    LOOP
        INSERT INTO public.xp_ledger (user_id, xp_amount, activity_code, reason)
        VALUES (v_row.attendee, p_xp_amount, v_activity_code, v_title)
        RETURNING id INTO v_ledger_id;

        UPDATE public.attendance
           SET xp_ledger_id = v_ledger_id
         WHERE id = v_row.attendance_row;

        member_id := v_row.attendee;
        ledger_id := v_ledger_id;
        RETURN NEXT;
    END LOOP;
END;
$$;

--------------------------------------------------------------------------------
-- 3. Grant model
--
-- BOTH functions are granted to `service_role` ALONE, and this matters more here
-- than anywhere else in the project: these are the first functions that WRITE.
--
-- `award_event_attendance` inserts into xp_ledger - the audit trail - and
-- `set_event_attendance` deletes from attendance. If `anon` or `authenticated`
-- could execute either, anyone holding the publishable key could hand out XP to
-- an entire event, or wipe an event's attendance, straight through the Supabase
-- RPC endpoint. Neither takes a manager's identity as an argument and neither
-- can check one, because the allowlist lives in lib/xp/managers.ts and is not
-- represented in the database at all. The ONLY thing standing between these
-- functions and the internet is the grant below plus the session- and
-- manager-checked API route that calls them.
--
-- The REVOKE comes first: functions grant EXECUTE to PUBLIC by default, so
-- granting before revoking would leave that default in force.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.set_event_attendance(UUID, UUID[])
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.award_event_attendance(UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_event_attendance(UUID, UUID[])
    TO service_role;

GRANT EXECUTE ON FUNCTION public.award_event_attendance(UUID, INTEGER)
    TO service_role;

--------------------------------------------------------------------------------
-- 4. COMMENTS
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.set_event_attendance(UUID, UUID[]) IS
    'Phase 7B: replaces one event''s saved attendance with the supplied member set. Adds via ON CONFLICT DO NOTHING (the UNIQUE (event_id, member_id) guard) and removes only rows where xp_ledger_id IS NULL, so an awarded attendance is never deleted. Returns (added, removed, kept_awarded). WRITES - service_role only.';

COMMENT ON FUNCTION public.award_event_attendance(UUID, INTEGER) IS
    'Phase 7B: awards one ledger entry per attendee whose attendance.xp_ledger_id IS NULL, then links it. Idempotent by construction and row-locked (FOR UPDATE) so concurrent calls cannot double-award. The activity code and reason come from the event row; only the XP amount is passed in, resolved from lib/xp/activities.ts by the route. WRITES to xp_ledger - service_role only.';

--------------------------------------------------------------------------------
-- 5. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `events` and `attendance` keep the Phase 7A state: RLS enabled with no policy
-- at all, so no browser-facing role can reach either table. These functions are
-- SECURITY DEFINER and owned by the migration role, which is what lets the
-- service-role client perform the writes through them.
