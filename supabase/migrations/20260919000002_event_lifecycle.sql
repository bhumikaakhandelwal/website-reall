-- Phase 8A: event lifecycle
--
-- Adds the state an event needs to have a lifecycle rather than just an
-- existence:
--
--   1. events.archived_at / events.archived_by  - archive state and who set it
--   2. delete_event(event_id)                   - delete, but only when nobody
--                                                 was recorded on the event
--
-- WHY A MIGRATION IS GENUINELY REQUIRED
--
-- The two columns are a schema change; there is no way to express "this event is
-- finished" without storing it.
--
-- `delete_event` is a function for a reason that is not stylistic. Deleting an
-- event is safe ONLY when it has no attendance, because `attendance.event_id` is
-- ON DELETE CASCADE (Phase 7A): the database will happily delete the attendance
-- rows along with the event. A check-then-delete in application code -
-- `count(*)` then `DELETE` - has a window in between in which a manager could
-- record attendance, and the delete would then silently destroy those rows and
-- the only record of which members attended. The function takes a row lock
-- first, which closes that window, because the foreign key from `attendance`
-- takes a KEY SHARE lock on the parent row and KEY SHARE conflicts with FOR
-- UPDATE: a concurrent attendance insert blocks until the decision is made.
--
-- WHAT IS DELIBERATELY NOT ADDED
--   * no `status` column. `archived_at IS NULL` already means "active", and a
--     separate status column would be a second source of truth that can
--     disagree with it.
--   * no `updated_at`. Editing an event's metadata does not need auditing -
--     the audit trail this phase is told to preserve is the ATTENDANCE and XP
--     one, and neither is touched by an edit.
--   * no unarchive. The brief asks for an Archive action and for archived
--     events to be read-only; reversing an archive is a separate decision.
--   * no change to `attendance`, `xp_ledger`, `members` or `levels`, and no new
--     RLS policy anywhere.

--------------------------------------------------------------------------------
-- 1. Archive state
--
-- `archived_at` is nullable and NULL means active. That is the whole state
-- machine, and it is deliberately the only place the answer lives.
--
-- `archived_by` mirrors `created_by`: archiving is a deliberate act by a named
-- manager, and ON DELETE SET NULL keeps the event's history intact if that
-- member's row is ever removed.
--
-- No index. The register reads every event in one query and splits the list in
-- the browser, so there is nothing for an index on a few dozen rows to speed up.
--------------------------------------------------------------------------------

ALTER TABLE public.events
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archived_by UUID REFERENCES public.members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.archived_at IS
    'Phase 8A: when the event was archived, or NULL while it is active. An archived event is read-only - it cannot be edited, taken attendance against, or awarded.';

COMMENT ON COLUMN public.events.archived_by IS
    'Phase 8A: the manager who archived the event. ON DELETE SET NULL - removing a member must never delete club history.';

--------------------------------------------------------------------------------
-- 2. delete_event(event_id)
--
-- Deletes an event ONLY when no attendance has been recorded against it, and
-- reports which of the three outcomes happened:
--
--   'deleted'        the event was removed
--   'has_attendance' refused - attendance exists, so the event is kept
--   'not_found'      no such event
--
-- Returns the attendance count as well, so the caller can say how many people
-- are recorded rather than just that some are.
--
-- THE LOCK IS THE POINT. `PERFORM 1 ... FOR UPDATE` takes an exclusive row lock
-- on the event before the count is taken. The foreign key from `attendance`
-- takes a KEY SHARE lock on this same row when a member is recorded, and the two
-- lock modes conflict, so:
--
--   * an attendance insert that is already in flight blocks until this function
--     commits or rolls back, and then fails its foreign key check if the event
--     was deleted - it cannot slip in between the count and the delete;
--   * a second concurrent delete blocks and then reports 'not_found'.
--
-- Without the lock, the count and the delete are two independent snapshots and
-- the cascade would destroy attendance rows recorded in between - losing the
-- only record of who attended, which is exactly what this phase is told to
-- preserve.
--
-- Deleting an event with no attendance destroys nothing else: `xp_ledger` does
-- not reference `events`, and `attendance` (which does) is empty by definition
-- here.
--------------------------------------------------------------------------------

CREATE FUNCTION public.delete_event(p_event_id UUID)
RETURNS TABLE (
    outcome TEXT,
    attendance_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_attendance INTEGER := 0;
BEGIN
    -- Lock the event row, or find out it is not there.
    PERFORM 1 FROM public.events e WHERE e.id = p_event_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::TEXT, 0;
        RETURN;
    END IF;

    SELECT count(*)::INTEGER INTO v_attendance
      FROM public.attendance a
     WHERE a.event_id = p_event_id;

    IF v_attendance > 0 THEN
        RETURN QUERY SELECT 'has_attendance'::TEXT, v_attendance;
        RETURN;
    END IF;

    DELETE FROM public.events e WHERE e.id = p_event_id;

    RETURN QUERY SELECT 'deleted'::TEXT, 0;
END;
$$;

--------------------------------------------------------------------------------
-- 3. Grant model
--
-- `delete_event` destroys a row, so it follows the Phase 7B rule: granted to
-- `service_role` ALONE. If `anon` or `authenticated` could execute it, anyone
-- holding the publishable key could delete any event through the Supabase RPC
-- endpoint, and the function cannot check who is calling - the manager allowlist
-- lives in lib/xp/managers.ts and is not represented in the database. The
-- session- and manager-checked DELETE /api/events/[id] route is the only caller.
--
-- The REVOKE comes first: functions grant EXECUTE to PUBLIC by default.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.delete_event(UUID)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_event(UUID)
    TO service_role;

COMMENT ON FUNCTION public.delete_event(UUID) IS
    'Phase 8A: deletes an event only when it has no attendance, returning (outcome, attendance_count) where outcome is deleted / has_attendance / not_found. Locks the event row first so a concurrent attendance insert cannot slip between the count and the delete and be destroyed by the cascade. service_role only.';

--------------------------------------------------------------------------------
-- 4. NOTE ON RLS (intentionally unchanged)
--------------------------------------------------------------------------------
-- This migration adds no policy, drops no policy, and never disables RLS.
-- `events` and `attendance` keep the Phase 7A state: RLS enabled with no policy
-- at all, so no browser-facing role can reach either table. The new column
-- inherits that automatically - a column cannot be more or less reachable than
-- its table.
