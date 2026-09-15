-- Phase 3: XP engine
--
-- Adds the minimum needed to record handbook XP activities in the ledger and to
-- read XP totals / levels through the appropriate server-side clients under
-- the existing RLS model.
--
-- Deliberately NOT added here:
--   * no xp_activities table - the handbook activity list and its XP values are
--     defined once in lib/xp/activities.ts (single source of truth)
--   * no role / is_admin columns on members - Phase 3 has exactly two authorised
--     XP managers, resolved by email in lib/xp/managers.ts
--   * no XP rows for any member - real members start at whatever they have now
--
-- RLS IS UNCHANGED. `members` still cannot write to xp_ledger. The two
-- SECURITY DEFINER functions below are read-only and follow the Phase 1C
-- hardening pattern (SET search_path = '', fully-qualified names, revoked from
-- PUBLIC). Their EXECUTE grants differ on purpose: level definitions are public
-- reference data, a member's XP total is private and is readable only by the
-- server-side service-role client. See section 4.

--------------------------------------------------------------------------------
-- 1. xp_ledger.activity_code
-- Records WHICH handbook activity produced a ledger entry.
--
-- NULL for corrective adjustments, which are not handbook activities - those
-- are identified by their `reason` instead. This lets an award be told apart
-- from a correction without a second table, and keeps the amount traceable to
-- an activity.
--------------------------------------------------------------------------------

ALTER TABLE public.xp_ledger ADD COLUMN activity_code TEXT;

COMMENT ON COLUMN public.xp_ledger.activity_code IS
    'Handbook activity code (lib/xp/activities.ts) that produced this entry. NULL for corrective adjustments. Validated server-side; no CHECK constraint so the activity list is not duplicated in the database.';

--------------------------------------------------------------------------------
-- 2. get_all_levels()
-- The `levels` table is public reference data, but the Phase 1B RLS policy is
-- `USING (auth.uid() IS NOT NULL)`, which is never true for the approved-email
-- session (no Supabase Auth identity). This exposes the seven rows read-only.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_all_levels()
RETURNS TABLE (
    id INTEGER,
    title TEXT,
    xp_required INTEGER,
    sort_order INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.id, l.title, l.xp_required, l.sort_order
    FROM public.levels l
    ORDER BY l.sort_order;
$$;

--------------------------------------------------------------------------------
-- 3. get_member_xp_total(member_id)
-- Members may read their own XP ledger rows via RLS, but that policy is also
-- `auth.uid() = user_id` and therefore never matches for this login model.
-- Returns the ledger sum for one member id.
--
-- SERVER-ONLY. This function takes an arbitrary member id, so exposing it to
-- `anon` / `authenticated` would let any holder of the publishable key ask for
-- any member's XP total directly through the Supabase RPC endpoint, bypassing
-- the API route that scopes the read to the signed session. It is therefore
-- granted to `service_role` alone (see section 4), and only the server-side
-- service-role client calls it - which is not a widening of privilege, since
-- that client can already read the whole ledger with RLS bypassed.
--------------------------------------------------------------------------------

CREATE FUNCTION public.get_member_xp_total(member_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(SUM(x.xp_amount), 0)::INTEGER
    FROM public.xp_ledger x
    WHERE x.user_id = member_id;
$$;

--------------------------------------------------------------------------------
-- 4. EXECUTE privileges
--
-- Deliberately asymmetric:
--
--   get_all_levels         -> anon, authenticated
--       Level definitions are public reference data (the Handbook publishes
--       them), so the browser-facing read path may call it.
--
--   get_member_xp_total    -> service_role ONLY
--       Member XP is private. No client role may execute this function, so the
--       RPC cannot be used to read another member's total. The API enforces
--       "own XP only" on top of that.
--
-- Note the ordering. Functions grant EXECUTE to PUBLIC by default, so the
-- REVOKE must come first, otherwise the default grant would still be in place
-- when the targeted GRANT runs and every role would keep access. After the
-- REVOKE, the only roles that can execute each function are the ones named in
-- its GRANT (plus the owner), which is what makes the asymmetry above real.
--------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_all_levels() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_member_xp_total(UUID)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_all_levels() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_xp_total(UUID) TO service_role;

--------------------------------------------------------------------------------
-- 5. COMMENTS
--------------------------------------------------------------------------------

COMMENT ON FUNCTION public.get_all_levels() IS
    'Phase 3: read-only access to the seven authoritative level definitions.';

COMMENT ON FUNCTION public.get_member_xp_total(UUID) IS
    'Phase 3: total XP for one member, summed from the ledger. SERVER-ONLY (service_role) - never granted to anon/authenticated, because it accepts an arbitrary member id.';

--------------------------------------------------------------------------------
-- 6. NOTE ON XP WRITES (intentionally unchanged)
--------------------------------------------------------------------------------
-- There is still NO INSERT/UPDATE/DELETE policy on xp_ledger for members, and
-- this migration does not add one. Awarding XP is a server-side operation that
-- runs only after the app has verified the signed session cookie and confirmed
-- the actor is one of the two authorised XP managers. No database function
-- grants XP to an anon caller.
