-- Phase 7A: event foundation
--
-- Adds TWO tables that let a manager record a club event and, later, who
-- attended it:
--
--   1. events      - one row per club event (title, type, date, XP activity)
--   2. attendance  - one row per member per event
--
-- Deliberately NOT added here:
--   * no bulk XP award. This phase is the FOUNDATION only: the attendance table
--     exists and is shaped so that Phase 7B's award can be made idempotent, but
--     nothing in this migration writes to xp_ledger. The attendance -> ledger
--     link (`attendance.xp_ledger_id`) is the column that will make it so, and
--     it is deliberately created empty.
--   * no XP amount on either table. An event names a HANDBOOK ACTIVITY CODE and
--     nothing else; the amount is resolved from lib/xp/activities.ts at award
--     time, exactly as POST /api/xp/award already does. Storing an amount here
--     would create a second, silently divergent copy of the Handbook.
--   * no event -> leaderboard mapping. Which activity belongs to which
--     leaderboard lives in lib/xp/leaderboards.ts and is not duplicated in SQL.
--   * no SECURITY DEFINER function. Neither table is read by a browser-facing
--     role (see the RLS note in section 3), so there is nothing for a narrow
--     function to expose.
--   * no change to `members`, `levels` or `xp_ledger`, and no new RLS policy on
--     any existing table.

--------------------------------------------------------------------------------
-- 1. events
--
-- One row per club event.
--
-- `activity_code` names the Handbook activity that ATTENDING this event will
-- award, and is intentionally not constrained by a CHECK against a hardcoded
-- list: the Handbook activity list lives in lib/xp/activities.ts and is the
-- single source of truth, so a CHECK here would be a second copy that drifts
-- the first time the Handbook changes. The API validates the code against that
-- list before inserting, which is the same place POST /api/xp/award validates
-- it. (The length bound is a sanity guard against a runaway value, not a
-- vocabulary.)
--
-- `event_type` IS constrained, because it is a small closed vocabulary that
-- belongs to the product rather than to the Handbook. The list is mirrored in
-- lib/events/events.ts and a test pins the two together.
--
-- `event_date` is DATE, not TIMESTAMPTZ: an event happens on a day, and the
-- club does not schedule to the minute. Storing a timestamp would invite the
-- timezone bug that lib/manager/dashboard.ts documents - a date that renders as
-- the previous day for anyone west of UTC.
--
-- `created_by` records which manager created the event. ON DELETE SET NULL
-- rather than CASCADE: removing a member must never delete club history.
--------------------------------------------------------------------------------

CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'workshop',
            'technical-session',
            'coding-contest',
            'hackathon',
            'meeting',
            'other'
        )),
    event_date DATE NOT NULL,
    activity_code TEXT NOT NULL CHECK (length(btrim(activity_code)) BETWEEN 1 AND 64),
    created_by UUID REFERENCES public.members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The /events list is ordered by date, newest first, then by creation order so
-- two events on the same day never reshuffle between two identical requests.
CREATE INDEX idx_events_event_date ON public.events (event_date DESC, created_at DESC);

--------------------------------------------------------------------------------
-- 2. attendance
--
-- One row per member per event. No XP is written by this migration; the row is
-- the record that a member was present.
--
-- UNIQUE (event_id, member_id) is the important part, and it is why this phase
-- comes before the award: it makes "this member attended this event" a fact the
-- database enforces rather than something application code has to remember. A
-- bulk award built on top of it cannot double-award a member for the same
-- event, however many times it is run.
--
-- `xp_ledger_id` is the link to the ledger entry that awarded this attendance,
-- and NULL means "not yet awarded". Phase 7B awards `WHERE xp_ledger_id IS
-- NULL`, which makes the award idempotent by construction rather than by a
-- NOT EXISTS heuristic. ON DELETE SET NULL: if a ledger row were ever removed,
-- the attendance record must survive as a record that the member was there.
--
-- `recorded_at` is when the attendance was taken, which is not necessarily the
-- event date - attendance may be entered the next day.
--------------------------------------------------------------------------------

CREATE TABLE public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    xp_ledger_id INTEGER REFERENCES public.xp_ledger(id) ON DELETE SET NULL,
    CONSTRAINT attendance_event_member_key UNIQUE (event_id, member_id)
);

CREATE INDEX idx_attendance_event_id ON public.attendance (event_id);
CREATE INDEX idx_attendance_member_id ON public.attendance (member_id);
-- Partial: the only query Phase 7B needs is "what is still unawarded".
CREATE INDEX idx_attendance_unawarded
    ON public.attendance (event_id)
    WHERE xp_ledger_id IS NULL;

--------------------------------------------------------------------------------
-- 3. RLS
--
-- Both tables get RLS ENABLED and NO POLICY AT ALL. That is deliberate, and it
-- is the strictest of the options available:
--
--   * With RLS on and no policy, no browser-facing role - `anon` or
--     `authenticated` - can read or write either table, even holding the
--     publishable key. The Supabase RPC and REST endpoints cannot reach them.
--   * The application reaches them only through the SERVER-ONLY service-role
--     client (lib/supabase/admin.ts), which bypasses RLS, behind the session-
--     and manager-checked /api/events route. That is the same arrangement as
--     xp_ledger, whose only policy is a self-read that never matches under this
--     project's session model.
--
-- A public events calendar would need a SELECT policy here. That is a product
-- decision and is deliberately not taken now: it is one statement to add later,
-- and adding it early would expose an attendance roster nobody has asked to
-- publish.
--
-- Note there is deliberately no INSERT/UPDATE/DELETE policy for any role. Every
-- write goes through the API, which is where the manager allowlist is enforced.
--------------------------------------------------------------------------------

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 4. COMMENTS
--------------------------------------------------------------------------------

COMMENT ON TABLE public.events IS
    'Phase 7A: club events. activity_code names the Handbook activity that attending will award; the XP amount is resolved from lib/xp/activities.ts at award time and is deliberately not stored here.';

COMMENT ON COLUMN public.events.created_by IS
    'The XP manager who created the event. ON DELETE SET NULL - removing a member must never delete club history.';

COMMENT ON TABLE public.attendance IS
    'Phase 7A: one row per member per event. No XP is written by this phase; xp_ledger_id is NULL until Phase 7B awards the attendance.';

COMMENT ON COLUMN public.attendance.xp_ledger_id IS
    'The ledger entry that awarded this attendance, or NULL if not yet awarded. Phase 7B awards WHERE xp_ledger_id IS NULL, which makes the award idempotent by construction.';

COMMENT ON CONSTRAINT attendance_event_member_key ON public.attendance IS
    'One attendance row per member per event. This is what stops a bulk award from double-awarding a member for the same event.';
