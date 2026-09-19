-- Phase 8D: Supabase Auth for members
--
-- Adds ONE nullable column:
--
--   members.auth_user_id  ->  the Supabase Auth account this member signs in with
--
-- WHY A MIGRATION IS GENUINELY REQUIRED
--
-- The phase replaces the custom email-only session with Supabase Auth, and the
-- flow it introduces - "you are a member but you have not activated yet" - turns
-- on one question: DOES THIS MEMBER ALREADY HAVE AN AUTH ACCOUNT?
--
-- Without this column that question can only be answered by calling the invite
-- API and inspecting the error string it returns ("already been registered"),
-- or by paging through auth.admin.listUsers(). The first puts the phase's most
-- important requirement on a message that Supabase is free to reword; the second
-- does not scale and is not a lookup. A column makes it a fact the application
-- owns, and makes the activation branch deterministic.
--
-- UNIQUE is the structural half of the same requirement: "no duplicate Auth
-- accounts". One member row cannot point at two auth users, and two member rows
-- cannot share one. (PostgreSQL allows many NULLs under a UNIQUE constraint, so
-- the 42 members who have not activated are unaffected.)
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * no data. No member is inserted, updated or deleted. All 42 existing
--     members keep their id, email, display_name, membership_status,
--     membership_start and membership_end exactly as they are, and every one of
--     them gets auth_user_id = NULL, which is precisely the "not activated yet"
--     state the new flow looks for.
--   * no XP. The ledger is untouched; no Membership entry is created here.
--   * no attendance, event, level or leaderboard change.
--   * no RLS policy added or dropped, and RLS is not disabled. See the note at
--     the bottom about the existing policy on this table.
--   * no backfill of auth accounts. Creating 42 auth users would send 42 emails;
--     members activate themselves, one at a time, from the login page.
--
-- ON DELETE SET NULL, not CASCADE. Deleting an auth account must never delete a
-- member: members are permanent club records that XP and attendance point at,
-- and the phase brief is explicit that members are never deleted. Losing the
-- link is recoverable; losing the member is not.

--------------------------------------------------------------------------------
-- 1. The link
--------------------------------------------------------------------------------

ALTER TABLE public.members
    ADD COLUMN auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.members.auth_user_id IS
    'Phase 8D: the Supabase Auth account this member signs in with. NULL means the member exists but has not activated yet - the login page offers them the first-time activation flow. Set once, at activation, from the id inviteUserByEmail returns. UNIQUE, so one member cannot hold two auth accounts. ON DELETE SET NULL: deleting an auth account must never delete a member.';

--------------------------------------------------------------------------------
-- 2. get_member_activation(email)
--
-- The one read the activation flow needs, and the only place `auth_user_id` is
-- ever exposed: given an email, is it a member, is their membership live, and
-- have they activated?
--
-- WHY THIS IS A FUNCTION RATHER THAN A QUERY THE APPLICATION RUNS. `members` is
-- RLS-protected and the service-role client can read any column of it, so the
-- application COULD have selected this directly. It is a function instead for
-- the same reason every other privileged read in this project is: the shape is
-- fixed and reviewable, it returns exactly three fields and never the member
-- row, and it is granted to `service_role` alone - so a future change cannot
-- accidentally widen what a browser-facing role can see of this table.
--
-- Returns at most one row. An email that is not a member returns none, which is
-- the "not a member" case the login page reports.
--
-- The email is normalized the same way `members.email` is stored (trimmed and
-- lowercased), so a member who types their address with different capitalization
-- still matches.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_member_activation(p_email TEXT)
RETURNS TABLE (
    member_id UUID,
    membership_status TEXT,
    has_auth_account BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        m.id AS member_id,
        m.membership_status AS membership_status,
        (m.auth_user_id IS NOT NULL) AS has_auth_account
    FROM public.members m
    WHERE m.email = lower(btrim(p_email))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_member_activation(TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_member_activation(TEXT)
    TO service_role;

COMMENT ON FUNCTION public.get_member_activation(TEXT) IS
    'Phase 8D: given an email, whether it is a member, that member''s membership_status, and whether they have activated (auth_user_id IS NOT NULL). Read-only and STABLE. SERVER-ONLY (service_role) - the only place auth_user_id is exposed.';

--------------------------------------------------------------------------------
-- 3. NOTE ON THE EXISTING RLS POLICY (deliberately unchanged)
--------------------------------------------------------------------------------
-- `members` has RLS enabled with one policy, "members can read own profile",
-- whose qual is `auth.uid() = id`. That was written for the Phase 1B model where
-- members.id WAS the Supabase Auth user id. It is not any more - members.id is
-- its own uuid - so the policy currently matches nothing.
--
-- This migration does NOT touch it, for two reasons:
--
--   * It is inert, and correcting it is not required by this phase. Until now
--     nothing ever held a Supabase Auth session, so auth.uid() was always NULL
--     and every policy on this table was dead code. Adopting Supabase Auth makes
--     auth.uid() real for the first time - but `auth.uid() = id` still matches
--     no row, because no member's id is an auth user id.
--
--   * Changing it would GRANT a capability rather than restore one. The
--     application reads members through the service-role client and the
--     SECURITY DEFINER functions in lib/db/queries.ts; nothing needs anon-key
--     access to this table. Rewriting the policy to `auth.uid() = auth_user_id`
--     would hand every signed-in member a direct PostgREST read of their own
--     row - a new capability that this phase does not ask for.
--
-- It is flagged rather than silently fixed. It is a latent trap: it reads as
-- though it grants self-read and does not. Whoever addresses it should decide
-- deliberately whether members should be able to read their own row directly.
