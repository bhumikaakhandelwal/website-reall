-- Phase 1C: approved-email login lookups
--
-- Phase 1B enabled RLS on `members` with a single SELECT policy:
--   auth.uid() = id
-- That policy assumes a Supabase Auth session exists. Phase 1C deliberately
-- does NOT use Supabase Auth (login is an approved-email allowlist check), so
-- auth.uid() is always NULL and the server cannot read `members` with the
-- anon key at all.
--
-- Rather than weakening RLS (a `USING (true)` SELECT policy would expose every
-- member's email to any anon-key caller) or introducing a service-role key,
-- this migration adds two narrow SECURITY DEFINER functions. Each one answers
-- exactly one question used by the login flow and returns only safe fields.
--
-- The `members` table itself is unchanged.

--------------------------------------------------------------------------------
-- 1. Email -> member id
-- Used by POST /api/auth/login to decide whether an email is approved.
-- Returns at most one id; callers learn nothing else about the member.
--------------------------------------------------------------------------------

CREATE FUNCTION public.lookup_member_id_by_email(candidate_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.id
    FROM public.members m
    WHERE lower(m.email) = lower(candidate_email)
    LIMIT 1;
$$;

--------------------------------------------------------------------------------
-- 2. Member id -> safe profile fields
-- Used by GET /api/auth/me after the signed session cookie has been verified
-- server-side. Returns only the fields already exposed by that endpoint
-- (see lib/db/schema.ts memberSchema) — no governance or security-sensitive
-- columns.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_member_profile(member_id UUID)
RETURNS TABLE (
    id UUID,
    email TEXT,
    display_name TEXT,
    membership_status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        m.id,
        m.email,
        m.display_name,
        m.membership_status,
        m.created_at,
        m.updated_at
    FROM public.members m
    WHERE m.id = member_id;
$$;

--------------------------------------------------------------------------------
-- 3. EXECUTE privileges
-- PUBLIC gets nothing; only the API roles the server-side Supabase client
-- uses may call these functions.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.lookup_member_id_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_member_profile(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lookup_member_id_by_email(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_profile(UUID) TO anon, authenticated;

--------------------------------------------------------------------------------
-- 4. COMMENTS
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.lookup_member_id_by_email(TEXT) IS
    'Phase 1C approved-email login: maps an approved email to its member id. Returns nothing for unapproved emails.';

COMMENT ON FUNCTION public.get_member_profile(UUID) IS
    'Phase 1C: returns the safe member profile fields for a verified member id. Requires the unguessable member id.';
