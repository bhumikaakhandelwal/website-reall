# DBCE Coders Club — Backend Implementation Plan

> Status: Phase 1B correction — foundation audit and secure baseline
> Phase: Foundation (identity + annual membership + levels + XP ledger audit trail)

---

## 1. Governing Sources

The following documents and facts govern backend design, in this order of authority:

1. **DBCE Coders Club Handbook (AY 2026–27)** — the authoritative source of truth for organizational rules, membership, XP levels, and governance
2. **`docs/00-PROJECT-OVERVIEW.md`** — project identity, vision, and development principles
3. **`docs/architecture.md`** — technical architecture and engineering boundaries
4. **`docs/BACKEND-REQUIREMENTS.md`** — earlier analysis; validated against the Handbook, not blindly followed
5. This document — the corrected implementation plan

---

## 2. Confirmed Requirements (Handbook + Project Decisions)

### 2.1 Membership

- Membership is open to DBCE students.
- Membership is **annual** and valid **July–June**.
- The annual membership fee is **₹250**.
- Membership access is based on a **manually maintained list of students who have actually paid/registered** for Coders Club membership.
- **Only registered members are eligible for XP and rewards.**
- No automated payment system is required.
- No elaborate membership-management system is required right now.
- Real member names/emails will be supplied later by the project owner — **no real member data is seeded in this phase**.

### 2.2 Authentication

- The frontend login UI is frozen and remains unchanged.
- Authentication behavior must follow the existing frontend login design.
- The exact authentication mechanism is **intentionally undecided**. Do not assume email/password, OAuth, magic link, OTP, or any other mechanism until explicitly decided.
- No custom login/password API is implemented while the mechanism is undecided.
- No public registration is implemented.
- A Supabase Auth identity does **not** automatically imply Coders Club membership — the `members` table is the allowlist.

### 2.3 XP Levels

The Handbook establishes the authoritative XP levels:

| Level | Title | XP |
|---|---|---|
| 1 | Rookie | <500 |
| 2 | Novice Coder | 500 |
| 3 | Code Explorer | 1000 |
| 4 | Code Warrior | 2000 |
| 5 | Coding Champion | 3000 |
| 6 | Code Master | 4000 |
| 7 | Coding Legend | 5000 |

The database `levels` table is the authoritative source for these definitions. The frontend is frozen and will be integrated with the database in a later phase.

### 2.4 XP Governance

- XP is verified by **faculty coordinators** and the **student core committee**.
- **Internal Affairs** maintains the XP database and verifies XP claims / monthly leaderboard.
- Faculty Advisors and Council have final authority on administration and XP verification.
- The exact approval workflow is **not defined** and must not be invented.
- XP activity values and penalties from the Handbook belong to the **later XP phase**, not this foundation task.
- Whether XP resets each academic year or remains cumulative is **unresolved** — do not assume either.

### 2.5 Leaderboards

- Leaderboards are updated **monthly**.
- Three leaderboard categories exist:
  1. **Overall XP Leaderboard**
  2. **Hackathon Leaderboard**
  3. **Open-Source Contribution Leaderboard**
- Leaderboard aggregation is **not implemented** in this phase. A future leaderboard must be database-derived, not implemented by loading every XP ledger row into application memory.

### 2.6 Governance Roles

- The Handbook defines actual governance roles.
- Do **not** create a generic `admin` role or use `council` as a blanket permission boundary.
- Do **not** create `faculty_coordinator` or other generic role columns in the foundation schema.
- Actual Handbook governance roles (faculty coordinators, student core committee, Internal Affairs, Faculty Advisors, Council) will be modeled later with explicit, narrow permission boundaries.

### 2.7 Security

- Normal members must **never** be able to directly insert arbitrary XP into the XP ledger.
- Normal members must **not** be able to modify membership eligibility, roles, governance assignments, XP, verification state, or other security-sensitive fields.
- Supabase RLS is the primary database security layer.
- No service-role client is used in this foundation.
- Server-side session verification is required for protected endpoints.

---

## 3. Inferred / Architectural Decisions

These are technical choices made to implement the confirmed requirements safely:

### 3.1 Stack

- **Database:** Supabase PostgreSQL
- **Authentication provider:** Supabase Auth (mechanism undecided)
- **Row Level Security:** enabled on all tables
- **Backend API:** Next.js Route Handlers (`app/api/*`)
- **Validation:** Zod where useful
- **Client library:** `@supabase/ssr` for cookie-based auth in Next.js App Router
- **Environment:** public Supabase URL + anon/publishable key only

### 3.2 Entity Model

The foundation supports the future concept:

```text
Supabase Auth identity (auth.users)
        │
        └── 1:1 ──► club member (members)
                          │
                          ├── annual membership (July–June)
                          │
                          └── future: XP ledger + leaderboards
```

### 3.3 Phase 1B Tables

**`members`** — approved Coders Club member profiles extending `auth.users`

- `id` UUID PK → `auth.users(id)`
- `email` TEXT UNIQUE NOT NULL
- `display_name` TEXT NOT NULL
- `membership_status` TEXT CHECK (`pending`, `active`, `inactive`)
- `membership_start` DATE (manual, July–June annual window)
- `membership_end` DATE (manual, July–June annual window)
- `created_at` / `updated_at` TIMESTAMPTZ

**`levels`** — authoritative level definitions

- `id` INTEGER PK CHECK (1–7)
- `title` TEXT NOT NULL
- `xp_required` INTEGER NOT NULL
- `sort_order` INTEGER

**`xp_ledger`** — future audit trail for XP changes

- `id` SERIAL PK
- `user_id` UUID NOT NULL → `members(id)`
- `xp_amount` INTEGER NOT NULL CHECK (≠ 0)
- `reason` TEXT
- `created_at` TIMESTAMPTZ

### 3.4 RLS Strategy

- **`members`:** members can read their own row only. **No self-update policy** — membership fields are security-sensitive.
- **`levels`:** authenticated users can read. No write policies.
- **`xp_ledger`:** members can read their own entries. **No INSERT/UPDATE/DELETE policies** for members.

### 3.5 API Surface (Phase 1B)

- `GET /api/auth/me` — verify Supabase session, return safe member fields, return 401/404/500 as appropriate
- No login, logout, registration, or profile-update endpoints yet

### 3.6 Frontend Integration Boundary

The frontend is frozen. Backend integration (replacing hardcoded profile/XP data in `GlobalNavigation`) is a later phase and must not redesign or rewrite the frontend UI.

---

## 4. Unresolved Decisions (Do Not Implement Yet)

These require project-owner input and must remain unresolved:

1. **Exact authentication mechanism** — email/password, OAuth, magic link, OTP, or other
2. **Exact XP approval workflow** — how faculty coordinators, student core committee, Faculty Advisors, and Council approve
3. **Whether XP resets each academic year or remains cumulative**
4. **Challenge submission behavior** — how students submit, format, approval flow
5. **Student email-domain assumption** — do not invent a domain; the real member list comes later
6. **Public registration process** — how new members are added to the approved list
7. **Additional profile fields** — department, year, GitHub URL, bio, etc.
8. **Council / governance role modeling** — how Handbook roles map to database permissions
9. **Leaderboard page** — `/leaderboard` is referenced by navigation but does not exist
10. **Password reset flow** — not present in current UI
11. **Session timeout** — duration undefined
12. **OAuth providers** — GitHub/Discord login undefined
13. **Level icon storage** — static files work for now
14. **XP activity values / penalties** — belong to the later XP phase

---

## 5. Phase-by-Phase Implementation Order

### Phase 1A: Foundation Audit (Complete)

- Supabase dependencies added
- Supabase client helpers created
- Middleware session refresh implemented
- Initial schema review

### Phase 1B: Secure Foundation Correction (This Phase)

1. ✅ Fix Supabase client helpers (async server client, canonical middleware)
2. ✅ Remove speculative auth schemas and environment variables
3. ✅ Correct `members`, `levels`, `xp_ledger` schema with conservative RLS
4. ✅ Seed only the seven authoritative Handbook levels
5. ✅ Fix `/api/auth/me` to return safe fields with proper status codes
6. ✅ Update this implementation plan

### Phase 2: Member Seeding & Auth (Later)

- Project owner supplies real Name + Gmail list
- Seed real members manually (no fake data)
- Configure Supabase Auth provider per decided mechanism
- No public registration

### Phase 3: XP System & Leaderboard (Later)

- Implement XP earning, verification, and approval workflow per Handbook
- Implement monthly leaderboards (database-derived)
- Model Handbook governance roles with explicit permissions

### Phase 4: Extended Features (Later)

- Challenges, events, payments (if required), council management

---

## 6. Do NOT Implement Yet

These items are explicitly out of scope for Phase 1B and must not be built until the associated decisions are resolved:

- Public registration system
- Custom login/password API
- OAuth / magic link / OTP / any specific auth mechanism
- XP earning, claiming, verification, or award logic
- XP penalties
- XP approval workflow
- XP reset behavior across academic years
- Leaderboard aggregation
- Challenge enrollment/submission
- Event registration
- Payments
- Admin tooling
- Generic `admin` / `council` / `faculty_coordinator` role columns
- Real member email/name seeding
- Invented student email domains
- Broad member self-update of security-sensitive fields

---

## 7. Repository Checks

### Checks performed

- ✅ Read all backend foundation files
- ✅ Read all documentation sources
- ✅ Audited migration for premature assumptions
- ✅ Verified no real member data is seeded
- ✅ Verified no service-role client is used
- ✅ Verified no custom login API exists
- ✅ Verified no public registration exists
- ✅ Verified frontend is untouched

### Current state

- Branch: `backend-foundation`
- No commits created
- No push performed

---

## 8. Summary

Phase 1B establishes a **secure, minimal foundation**:

- Supabase Auth identity is linked to a manually-maintained `members` table
- Annual July–June membership is represented without inventing payment workflows
- The seven authoritative Handbook levels are seeded as the single source of truth
- The XP ledger exists as a future audit trail with **no member write access**
- Governance roles are deliberately **not** modeled as generic role columns
- Authentication mechanism, XP approval workflow, and XP reset behavior remain **unresolved**
- The frontend remains frozen and unchanged
