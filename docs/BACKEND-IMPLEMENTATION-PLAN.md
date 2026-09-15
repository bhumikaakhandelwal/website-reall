# DBCE Coders Club — Backend Implementation Plan

> Status: Phase 2 — approved-email login with a signed HTTP-only session, plus real member profile integration
> Phase: Foundation (identity + annual membership + levels + XP ledger audit trail)
> Next: real member seeding/import, treated as a separate future step (§5)

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
- Real member names/emails will be supplied later by the project owner. Seeding that real list is a **separate future step**, not part of profile integration (§5).

### 2.2 Authentication

- The existing frontend login UI is kept as-is; only its placeholder demo check was replaced by the real API call.
- Authentication behavior follows the existing frontend login design.
- The authentication mechanism is **approved-email allowlist login with a simple server-side session**.
- No password, OTP, magic link, OAuth, or email verification is used.
- No public registration is implemented.
- A Supabase Auth identity is **not** created or used; the application maintains its own session separate from Supabase Auth.
- The `members` table serves as the allowlist for approved emails.

> **Intentional security tradeoff:** Possession or knowledge of an approved email address is treated as sufficient to log in. This weak identity model is explicitly accepted for simplicity. The application does **not** use client-side localStorage as the authoritative authentication mechanism; it validates the session server-side via an HTTP-only cookie and does not expose service-role credentials or create Supabase Auth users automatically.

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
- **Authentication provider:** none for members — approved-email allowlist plus this application's own signed session cookie (Phase 1C, §2.2). Supabase Auth is **not** used.
- **Row Level Security:** enabled on all tables
- **Backend API:** Next.js Route Handlers (`app/api/*`)
- **Validation:** Zod where useful
- **Client library:** `@supabase/ssr` for server-side PostgreSQL access in the Next.js App Router
- **Environment:** public Supabase URL, anon/publishable key, and `SESSION_SECRET` (session cookie signing)

### 3.2 Entity Model

The foundation supports the future concept:

```text
club member (members)  ← application owns member identity (no Supabase Auth)
        │
        ├── annual membership (July–June)
        │
        └── future: XP ledger + leaderboards
```

### 3.3 Phase 1B Tables

**`members`** — approved Coders Club member profiles (application-owned identity)

- `id` UUID PK, `DEFAULT gen_random_uuid()` — no Supabase Auth dependency (see §3.8)
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
- **Phase 1C addition:** because approved-email login has no Supabase Auth session, `auth.uid()` is NULL and the Phase 1B `members` policies cannot serve the login flow. Rather than weakening RLS (a permissive SELECT policy would expose every member's email) or introducing a service-role key, two narrow `SECURITY DEFINER` functions were added in `supabase/migrations/20260914000001_member_login_lookup.sql`:
  - `lookup_member_id_by_email(TEXT) → UUID` — used by login; reveals nothing but whether an email is approved
  - `get_member_profile(UUID) → safe profile fields` — used by `/api/auth/me` after the session is verified; requires the unguessable member id
  - Both set `search_path = ''`, are revoked from `PUBLIC`, and are granted only to `anon` / `authenticated`. RLS on `members` is not weakened to support login.

### 3.5 API Surface

**Phase 1B**

- `GET /api/auth/me` — return safe member fields, 401/404/500 as appropriate

**Phase 1C (approved-email login)**

- `POST /api/auth/login` — body `{ email }`; validates syntax, normalizes (trim + lowercase), checks the `members` allowlist, sets the signed HTTP-only session cookie, returns `{ ok: true }`; 400 invalid email, 401 not approved, 500 server error
- `POST /api/auth/logout` — clears the session cookie
- `GET /api/auth/me` — now reads the application session cookie (no Supabase Auth session is involved). Response shape and status codes unchanged.
- No registration or profile-update endpoints

### 3.6 Session Model (Phase 1C)

- The application session is **separate from Supabase Auth** and deliberately so.
- `lib/auth/session.ts` (small and isolated) creates, verifies, and clears it.
- Cookie `dbce_session`: `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`, 7-day expiry, signed with HMAC-SHA256 (`node:crypto` — **no new dependency**).
- The cookie payload holds only `{ memberId, expiresAt }` — never the member's database record. It is not readable by client-side JavaScript.
- Requires the `SESSION_SECRET` environment variable (declared in `lib/env.ts`). If it is unset, session operations throw rather than falling back to a predictable secret.
- Client-side `localStorage` key `dbce-logged-in` remains a **UI gate indicator only** — never the authoritative authentication state.

### 3.7 Frontend Integration Boundary

The frontend UI is frozen: no redesign, no visual changes. Phase 2 replaced the hardcoded member name in `GlobalNavigation` with the session's real member profile (§3.9). The remaining hardcoded data (XP totals, level progress) stays placeholder-only until the XP phase.

### 3.8 Member Identity (Phase 1C correction)

The initial schema declared `members.id` as a foreign key to `auth.users(id)` with no default. The finalized approved-email login (§2.2) does not create Supabase Auth users, so that declaration made manual member seeding impossible: an insert either failed the NOT NULL constraint on `id` (no default) or failed the foreign key (a matching `auth.users` row would have to exist first).

`supabase/migrations/20260914000002_members_standalone_identity.sql` corrects this with the smallest possible change:

- drops the `members_id_fkey` constraint on `auth.users`,
- sets `members.id DEFAULT gen_random_uuid()`,
- keeps `id` as the primary key, adds no column, and does not modify `xp_ledger`.

No real member rows existed, so there was no data to migrate. The Phase 1B RLS policies that reference `auth.uid()` are intentionally left in place: with no Supabase Auth session they never match, so `members` stays unreadable with the anon key and all application reads continue to go through the §3.4 functions.

### 3.9 Real Member Profile Integration (Phase 2)

Phase 2 connects the existing UI to the real member record. Scope was deliberately narrow:

- `GlobalNavigation` fetches `GET /api/auth/me` once per mount and renders the response's `display_name` in place of the old hardcoded placeholder name.
- The server session remains the only source of identity. The component trusts the API response, never a client-side value; `localStorage` (`dbce-logged-in`) stays a UI gate only.
- While the request is in flight a neutral skeleton is shown; no layout or styling was redesigned.
- If the session is missing or expired (`401` / `404`), the client gate is cleared and the visitor is sent to `/login`.
- Logout now also calls `POST /api/auth/logout` so the server session cookie is cleared, not just the client gate.

Still placeholder in the UI (not part of Phase 2): XP totals, level, and progress figures. Those wait for the XP phase.

**Not part of Phase 2:** seeding or importing the real member list. That is a separate future step (§5) and requires the project owner's real Name + email data.

---

## 4. Unresolved Decisions (Do Not Implement Yet)

These require project-owner input and must remain unresolved:

1. ~~**Exact authentication mechanism** — email/password, OAuth, magic link, OTP, or other~~ — **resolved in Phase 1C**: approved-email allowlist login with a simple server-side session
2. **Exact XP approval workflow** — how faculty coordinators, student core committee, Faculty Advisors, and Council approve
3. **Whether XP resets each academic year or remains cumulative**
4. **Challenge submission behavior** — how students submit, format, approval flow
5. **Student email-domain assumption** — do not invent a domain; the real member list comes later
6. **Public registration process** — how new members are added to the approved list
7. **Additional profile fields** — department, year, GitHub URL, bio, etc.
8. **Council / governance role modeling** — how Handbook roles map to database permissions
9. **Leaderboard page** — `/leaderboard` is referenced by navigation but does not exist
10. ~~**Password reset flow** — not present in current UI~~ — **not applicable**: login is passwordless (approved-email allowlist)
11. **Session timeout** — session lifetime is 7 days (`SESSION_TTL_SECONDS` in `lib/auth/session.ts`); a different duration or idle timeout remains undecided
12. ~~**OAuth providers** — GitHub/Discord login undefined~~ — **excluded** in Phase 1C; no OAuth is used
13. **Level icon storage** — static files work for now
14. **XP activity values / penalties** — belong to the later XP phase

---

## 5. Phase-by-Phase Implementation Order

### Phase 1A: Foundation Audit (Complete)

- Supabase dependencies added
- Supabase client helpers created
- Middleware session refresh implemented
- Initial schema review

### Phase 1B: Backend Foundation (Complete)

1. ✅ Fix Supabase client helpers (async server client, canonical middleware)
2. ✅ Remove speculative auth schemas and environment variables
3. ✅ Correct `members`, `levels`, `xp_ledger` schema with conservative RLS
4. ✅ Seed only the seven authoritative Handbook levels
5. ✅ Fix `/api/auth/me` to return safe fields with proper status codes
6. ✅ Update this implementation plan

### Phase 1C: Approved-Email Authentication (Complete)

1. ✅ Finalized the authentication model: approved-email allowlist, no password / OTP / magic link / OAuth / registration
2. ✅ Added `lookup_member_id_by_email` and `get_member_profile` as narrow `SECURITY DEFINER` functions (no weakened RLS, no service-role key)
3. ✅ Added the signed HTTP-only session (`lib/auth/session.ts`) — HMAC-SHA256 over `node:crypto`, independent of Supabase Auth
4. ✅ Implemented `POST /api/auth/login` and `POST /api/auth/logout`; reworked `GET /api/auth/me` to read the application session
5. ✅ Renamed `middleware.ts` to `proxy.ts` for Next.js 16
6. ✅ Removed the `members.id → auth.users(id)` dependency so members can be seeded without Supabase Auth

### Phase 2: Real Member Profile Integration (Complete)

1. ✅ `GlobalNavigation` reads the signed-in member from `GET /api/auth/me` (server session is the only identity source)
2. ✅ Replaced the hardcoded placeholder name with the member's real `display_name`
3. ✅ Session expiry (`401` / `404`) clears the client gate and returns the visitor to `/login`
4. ✅ Logout clears the server session cookie via `POST /api/auth/logout`
5. ✅ No UI redesign, no new dependencies

### Next Step (not yet started): Member Seeding / Real Member Import

This is a **separate future step**, deliberately kept out of Phase 2. Profile integration displays whatever member row the session resolves to; importing the real roster is independent of it.

- Project owner supplies the real Name + email list
- Seed real members manually (no fake data) — `members.id` is generated by the database, so no Supabase Auth user is required
- No public registration
- No Supabase Auth provider configuration is needed for member login

### Phase 3: XP System & Leaderboard (Later)

- Implement XP earning, verification, and approval workflow per Handbook
- Implement monthly leaderboards (database-derived)
- Model Handbook governance roles with explicit permissions

### Phase 4: Extended Features (Later)

- Challenges, events, payments (if required), council management

---

## 6. Do NOT Implement Yet

These items are explicitly out of scope for the foundation phases (1B–2) and must not be built until the associated decisions are resolved:

- Public registration system
- Password-based, OTP, magic-link, or OAuth login — Phase 1C fixed the mechanism as an approved-email allowlist (§2.2)
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
- Real member email/name seeding — this is the next step (§5), not part of Phase 2 profile integration
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
- ✅ Verified the login API only sets/clears a signed session cookie and never exposes secrets
- ✅ Verified no public registration exists
- ✅ Verified no role, XP, level, leaderboard, or seeding logic was implemented

### Current state

- Branch: `backend-foundation`
- Phase 1B / 1C backend foundation is committed; Phase 2 changes are in the working tree
- No push performed

---

## 8. Summary

The foundation phases (1B–2) establish a **secure, minimal foundation**:

- Member identity is owned by the application's `members` table — no Supabase Auth identity is created or required
- Annual July–June membership is represented without inventing payment workflows
- The seven authoritative Handbook levels are seeded as the single source of truth
- The XP ledger exists as a future audit trail with **no member write access**
- Governance roles are deliberately **not** modeled as generic role columns
- Login is an approved-email allowlist with an application-owned signed session, and the signed-in member's real profile name is displayed by the existing UI
- The XP approval workflow and XP reset behavior remain **unresolved**, and real member seeding is the next separate step
- The frontend UI was not redesigned
