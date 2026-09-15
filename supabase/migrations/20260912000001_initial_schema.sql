-- Initial database schema for DBCE Coders Club
-- Foundation phase: identity + member + annual membership + levels + XP ledger audit trail
--
-- Governing source: DBCE Coders Club Handbook (AY 2026-27)
--
-- This migration establishes ONLY the secure foundation.
-- Deliberately NOT included:
--   - generic admin / council / faculty_coordinator role columns
--   - XP earning, verification, or approval workflow
--   - payment workflows or gateway integration
--   - real member data (manually maintained; seeded separately by project owner)
--   - annual XP reset behavior (business decision unresolved)

--------------------------------------------------------------------------------
-- 1. MEMBERS TABLE
-- Core member profile data. The application owns member identity; this table
-- does not depend on Supabase Auth (see the Phase 1C removed-auth-dependency
-- migration, 20260914000002_members_standalone_identity.sql, which drops the
-- original auth.users foreign key).
-- Membership is manually maintained by the project owner / council.
-- Annual membership validity is July-June (Handbook).
--------------------------------------------------------------------------------

CREATE TABLE members (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    -- membership_status reflects the manually-maintained paid/registered state.
    membership_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (membership_status IN ('pending', 'active', 'inactive')),
    -- Academic-year membership: July-June validity.
    -- These dates are set manually when a member pays/registers.
    membership_start DATE,
    membership_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_members_email ON members(email);
CREATE INDEX idx_members_membership_status ON members(membership_status);
CREATE INDEX idx_members_membership_window ON members(membership_start, membership_end);

--------------------------------------------------------------------------------
-- 2. LEVELS TABLE
-- Authoritative XP level definitions (single source of truth).
-- Seeded with the seven Handbook levels only.
--
-- Level 1 semantics: "<500" is a range description, not a threshold.
--   Any member with 0 <= XP < 500 is Level 1 (Rookie).
--   xp_required is the minimum XP needed to reach that level.
--------------------------------------------------------------------------------

CREATE TABLE levels (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 7),
    title TEXT NOT NULL,
    xp_required INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE INDEX idx_levels_xp_required ON levels(xp_required);

-- Seed the seven authoritative Handbook levels.
-- Level 1: <500  -> xp_required = 0 (everyone starts at Level 1)
-- Level 2: 500   -> Novice Coder
-- Level 3: 1000  -> Code Explorer
-- Level 4: 2000  -> Code Warrior
-- Level 5: 3000  -> Coding Champion
-- Level 6: 4000  -> Code Master
-- Level 7: 5000  -> Coding Legend
INSERT INTO levels (id, title, xp_required, sort_order) VALUES
    (1, 'Rookie', 0, 1),
    (2, 'Novice Coder', 500, 2),
    (3, 'Code Explorer', 1000, 3),
    (4, 'Code Warrior', 2000, 4),
    (5, 'Coding Champion', 3000, 5),
    (6, 'Code Master', 4000, 6),
    (7, 'Coding Legend', 5000, 7)
ON CONFLICT (id) DO NOTHING;

--------------------------------------------------------------------------------
-- 3. XP_LEDGER TABLE
-- Audit trail of all XP changes.
-- SECURITY: normal members have NO INSERT/UPDATE/DELETE access via RLS.
-- All XP writes must go through server-side operations in a later phase.
--------------------------------------------------------------------------------

CREATE TABLE xp_ledger (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    xp_amount INTEGER NOT NULL CHECK (xp_amount != 0),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_xp_ledger_user_id ON xp_ledger(user_id);

--------------------------------------------------------------------------------
-- 4. RLS (ROW LEVEL SECURITY) POLICIES
-- Conservative foundation policies.
-- NOTE: Governance roles (faculty coordinators, student core committee,
-- Internal Affairs) are Handbook-defined and are NOT modeled here.
-- They will be introduced in a later phase with explicit permission boundaries.
--------------------------------------------------------------------------------

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- RLS Policies for members table
--------------------------------------------------------------------------------

-- Members can read their own profile.
CREATE POLICY "members can read own profile"
    ON members
    FOR SELECT
    USING (auth.uid() = id);

-- NO self-update policy on members.
-- membership_status, membership_start, membership_end, and any future
-- governance/role fields are security-sensitive and must NOT be
-- modifiable by normal members. Updates are performed server-side
-- by authorized personnel in a later phase.

--------------------------------------------------------------------------------
-- RLS Policies for levels table
--------------------------------------------------------------------------------

-- Authenticated users can read level definitions (reference data).
CREATE POLICY "authenticated users can read levels"
    ON levels
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- No INSERT/UPDATE/DELETE policies. Level definitions are managed
-- via migration or server-side admin operations only.

--------------------------------------------------------------------------------
-- RLS Policies for xp_ledger table
--------------------------------------------------------------------------------

-- Members can read their own XP ledger entries.
CREATE POLICY "members can read own XP ledger"
    ON xp_ledger
    FOR SELECT
    USING (auth.uid() = user_id);

-- NO INSERT/UPDATE/DELETE policies for members.
-- Normal members must NEVER be able to write arbitrary XP.
-- All XP ledger writes go through server-side operations in a later phase.

--------------------------------------------------------------------------------
-- 5. COMMENTS
--------------------------------------------------------------------------------

COMMENT ON TABLE members IS 'Approved Coders Club members. Identity is owned by this table (no Supabase Auth dependency); membership is manually maintained and annual validity is July-June.';
COMMENT ON TABLE levels IS 'Authoritative XP level definitions (single source of truth). Seeded with the seven Handbook levels.';
COMMENT ON TABLE xp_ledger IS 'Audit trail for XP changes. No member write access via RLS - XP earning/verification workflow is a later phase.';