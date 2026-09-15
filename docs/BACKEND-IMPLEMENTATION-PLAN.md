# DBCE Coders Club — Backend Implementation Plan

> Status: Phase 3 — XP engine (ledger-based) plus manual XP management by the two authorized XP managers
> Phase: Foundation (identity + annual membership + levels + XP ledger audit trail + XP management)
> Real member import: prepared as a one-time manual SQL script kept **outside the repository** (private member data — never committed; see §5)

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
- **Phase 3 decision (implemented):** XP is managed manually by **exactly two XP managers** — Basil Shaikh Mohammad and Bhumika Khandelwal (`lib/xp/managers.ts`). There is no member-facing XP submission, no self-reporting, no automatic awarding, and no approval queue: a manager records an activity against a member, and the ledger is the audit trail. This is the minimal correct mechanism, not a modeling of the full Handbook workflow.
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
- Server-side session verification is required for protected endpoints.
- **Phase 3 addition:** a server-only service-role client (`lib/supabase/admin.ts`, `SUPABASE_SERVICE_ROLE_KEY`) exists for exactly two operations, both of which RLS blocks for the anon key: writing `xp_ledger` rows, and summing one member's XP (`get_member_xp_total`). Both are reachable only from route handlers — writes only after the signed session is verified and the actor is confirmed to be one of the two XP managers. The key is never `NEXT_PUBLIC_`, never imported into a client component, and never reaches the browser. Everything else in the app still uses the anon key.
- **Phase 3 correction:** `get_member_xp_total(member_id)` takes an arbitrary member id, so it is granted to `service_role` **only** — never to `anon` or `authenticated`. Granting it to a client role would let anyone holding the publishable key read any member's XP total straight from the Supabase RPC endpoint, bypassing the API. The API enforces "own XP only" on top of that (§3.10).

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
- `activity_code` TEXT (Phase 3; NULL for corrective adjustments — see §3.10)
- `created_at` TIMESTAMPTZ

### 3.4 RLS Strategy

- **`members`:** members can read their own row only. **No self-update policy** — membership fields are security-sensitive.
- **`levels`:** authenticated users can read. No write policies.
- **`xp_ledger`:** members can read their own entries. **No INSERT/UPDATE/DELETE policies** for members.
- **Phase 1C addition:** because approved-email login has no Supabase Auth session, `auth.uid()` is NULL and the Phase 1B `members` policies cannot serve the login flow. Rather than weakening RLS (a permissive SELECT policy would expose every member's email) or introducing a service-role key, two narrow `SECURITY DEFINER` functions were added in `supabase/migrations/20260914000001_member_login_lookup.sql`:
  - `lookup_member_id_by_email(TEXT) → UUID` — used by login; reveals nothing but whether an email is approved
  - `get_member_profile(UUID) → safe profile fields` — used by `/api/auth/me` after the session is verified; requires the unguessable member id
  - Both set `search_path = ''`, are revoked from `PUBLIC`, and are granted only to `anon` / `authenticated`. RLS on `members` is not weakened to support login.
- **Phase 3 addition** (`supabase/migrations/20260915000001_xp_engine.sql`) — two more read-only `SECURITY DEFINER` functions, with **deliberately different grants**:
  - `get_all_levels()` → granted to `anon`, `authenticated`. Level definitions are public reference data, so the browser-facing read path may call it.
  - `get_member_xp_total(UUID)` → granted to **`service_role` only**, revoked from `PUBLIC`, `anon`, and `authenticated`. Member XP is private and the function accepts an arbitrary member id, so no client role may execute it; only the server-side service-role client does.
  - The `REVOKE`s come **before** the `GRANT`s, because functions grant `EXECUTE` to `PUBLIC` by default — reversing the order would leave the default grant in force and every role would keep access.
  - RLS on `xp_ledger` is still not weakened: no INSERT/UPDATE/DELETE policy is added for members.

### 3.5 API Surface

**Phase 1B**

- `GET /api/auth/me` — return safe member fields, 401/404/500 as appropriate

**Phase 1C (approved-email login)**

- `POST /api/auth/login` — body `{ email }`; validates syntax, normalizes (trim + lowercase), checks the `members` allowlist, sets the signed HTTP-only session cookie, returns `{ ok: true }`; 400 invalid email, 401 not approved, 500 server error
- `POST /api/auth/logout` — clears the session cookie
- `GET /api/auth/me` — now reads the application session cookie (no Supabase Auth session is involved). Response shape and status codes unchanged.
- No registration or profile-update endpoints

**Phase 3 (XP engine + manual XP management)**

- `GET /api/xp/me` — the authenticated member's own XP and level: `{ memberId, totalXp, level, levelName, nextLevelXp }`; 401 without a session, 404 unknown member, 500 if the ledger sum or level rows cannot be read. Identity comes from the session cookie only — there is no member-id parameter, and asking for another member returns your own data rather than theirs.
- `POST /api/xp/award` — the single protected XP management operation, 401 unauthenticated / 403 non-manager:
  - award: `{ memberId, activityCode }` → the XP amount is resolved server-side from `lib/xp/activities.ts`; the client never sends an amount
  - correction: `{ memberId, correctionXp, reason }` → appended as a new ledger row with `activity_code = NULL`; the original entry is never edited or deleted
  - 400 invalid body / unknown activity, 404 unknown target member, 500 write failure
- No endpoint exists for another member's XP, for listing members, or for editing/deleting ledger rows.

### 3.6 Session Model (Phase 1C)

- The application session is **separate from Supabase Auth** and deliberately so.
- `lib/auth/session.ts` (small and isolated) creates, verifies, and clears it.
- Cookie `dbce_session`: `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`, 7-day expiry, signed with HMAC-SHA256 (`node:crypto` — **no new dependency**).
- The cookie payload holds only `{ memberId, expiresAt }` — never the member's database record. It is not readable by client-side JavaScript.
- Requires the `SESSION_SECRET` environment variable (declared in `lib/env.ts`). If it is unset, session operations throw rather than falling back to a predictable secret.
- Client-side `localStorage` key `dbce-logged-in` remains a **UI gate indicator only** — never the authoritative authentication state.

### 3.7 Frontend Integration Boundary

The frontend UI is frozen: no redesign, no visual changes. Phase 2 replaced the hardcoded member name in `GlobalNavigation` with the session's real member profile (§3.9). Phase 3 replaced the remaining placeholder XP/level figures with the values returned by `GET /api/xp/me` (§3.10) — a data-source swap, not a visual change.

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

### 3.10 XP Engine and Manual XP Management (Phase 3)

XP is a **ledger**, not a number on a member row.

- **No stored total.** A member's XP is always `SUM(xp_amount)` over `xp_ledger`. There is no `total_xp` column and no denormalized cache, so a total can never drift from its history.
- **Activity values live in one place.** `lib/xp/activities.ts` holds the 15 Handbook activities and their XP values (50–250). An award request carries only an activity *code*; the server resolves the amount. A client cannot choose, inflate, or omit an amount.
- **Levels come from the database.** The seven level definitions stay in the `levels` table (seeded from the Handbook); `lib/xp/levels.ts` only derives which level a total falls into. No second hardcoded copy of the level table exists in application code — the previously hardcoded copy in `GlobalNavigation` (which had drifted to 3500/5000/7000/10000 and "Code Legend") was removed in favour of the API response.
- **Only two people may change XP.** `lib/xp/managers.ts` lists exactly two manager emails — Basil Shaikh Mohammad and Bhumika Khandelwal — and `isXpManager(email)` is evaluated server-side against the email resolved from the signed session. Everyone else, including other council members, gets 403. There is no role column, no `isAdmin` flag, and no general permission system.
- **Members cannot touch their own XP.** There is no submit, claim, approve, or self-report path. The only write is a manager action.
- **Corrections append, never rewrite.** A mistake is fixed with a new ledger row carrying a signed amount, a mandatory reason, and `activity_code = NULL`. The original entry stays in the audit trail.
- **The privileged client is used for two things only** (§2.7): writing ledger rows, and summing one member's XP through the `service_role`-only RPC.
- **Nothing is awarded automatically.** No login bonus, attendance capture, GitHub integration, hackathon hook, certificate flow, notification, or payment trigger exists.
- **Tests** (`npm test`, 41 assertions) cover the level boundaries 0/499/500/1000/2000/3000/4000/5000/5000+, the exact Handbook amounts, the manager allowlist, 401/403/404/400 handling, rejection of client-supplied amounts, the migration's grant model, and the absence of any member write policy on `xp_ledger`. They run against in-memory doubles, so no XP is written for real members.

---

## 4. Unresolved Decisions (Do Not Implement Yet)

These require project-owner input and must remain unresolved:

1. ~~**Exact authentication mechanism** — email/password, OAuth, magic link, OTP, or other~~ — **resolved in Phase 1C**: approved-email allowlist login with a simple server-side session
2. **Exact XP approval workflow** — how faculty coordinators, student core committee, Faculty Advisors, and Council approve. Phase 3 implements only the minimal manual mechanism (§2.4); the formal Handbook workflow remains unmodeled.
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
14. ~~**XP activity values**~~ — **resolved in Phase 3**: the 15 Handbook activity values live in `lib/xp/activities.ts` (§3.10). **Handbook penalties remain unresolved** as automated presets; Phase 3 only provides the generic corrective-entry mechanism.

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

### Phase 3: XP Engine & Manual XP Management (Implemented)

- ✅ Ledger-based XP: totals calculated from `xp_ledger`, no stored column
- ✅ Server-side truth: XP amounts come from `lib/xp/activities.ts` (handbook values), levels from DB `levels` table
- ✅ Only two XP managers may award XP: Basil Shaikh Mohammad and Bhumika Khandelwal (`lib/xp/managers.ts`)
- ✅ Members cannot submit or modify their own XP (401 unauthenticated, 403 for non-managers)
- ✅ Corrections via negative ledger entries with reason, preserving history
- ✅ `GET /api/xp/me` returns member's own total XP, level, and next level threshold
- ✅ `POST /api/xp/award` (protected) awards handbook activity XP or appends corrective entry
- ✅ Frontend minimal integration: `GlobalNavigation` now reads real XP/level from `/api/xp/me`
- ✅ RLS preserved: no member write access to `xp_ledger`; service-role key never exposed to browser
- ✅ Tests cover level boundaries, authorization (401/403), handbook amounts, arbitrary-amount rejection, the migration's grant model, and the absence of member write access
- ✅ Migration `supabase/migrations/20260915000001_xp_engine.sql` adds `activity_code` and two SECURITY DEFINER RPCs: `get_all_levels` (client-readable) and `get_member_xp_total` (`service_role` only)
- ⚠️ The migration is part of the Phase 3 commit and is applied through the normal Supabase migration workflow; the endpoints do not work until it has been applied

### Member Seeding (prepared, not part of any commit)

The real 42-member roster is imported by a **one-time SQL script kept outside the repository**, on the project owner's machine. Private member data is never committed to Git, never placed in source, migrations, `.env` files, or docs. The script is run manually once in the Supabase SQL Editor.

### Phase 4: Extended Features (Later)

- Monthly leaderboards (database-derived, not in-memory aggregation)
- Handbook governance roles with explicit, narrow permission boundaries
- Challenges, events, payments (if required), council management

---

## 6. Do NOT Implement Yet

These items are explicitly out of scope for the foundation phases (1B–3) and must not be built until the associated decisions are resolved:

- Public registration system
- Password-based, OTP, magic-link, or OAuth login — Phase 1C fixed the mechanism as an approved-email allowlist (§2.2)
- ~~XP award logic~~ — **Phase 3 added the minimal manual mechanism** (§3.10); member-facing claiming/verification/submission remains out of scope
- XP penalties as automated presets — only the generic corrective-entry mechanism exists
- XP approval workflow (the formal Handbook one)
- XP reset behavior across academic years
- Leaderboard aggregation
- Challenge enrollment/submission
- Event registration
- Payments
- Admin tooling
- Generic `admin` / `council` / `faculty_coordinator` role columns
- Real member email/name seeding — prepared outside the repository (§5); never committed
- Invented student email domains
- Broad member self-update of security-sensitive fields
- Any endpoint that returns another member's XP

---

## 7. Repository Checks

### Checks performed

- ✅ Read all backend foundation files
- ✅ Read all documentation sources
- ✅ Audited migration for premature assumptions
- ✅ Audited the Phase 3 migration's GRANT/REVOKE sequence and final privileges
- ✅ Verified no real member data is seeded
- ✅ Verified the service-role client is server-only and used for exactly two operations (XP write, one member's XP sum)
- ✅ Verified `get_member_xp_total` is not executable by `anon` or `authenticated`
- ✅ Verified the login API only sets/clears a signed session cookie and never exposes secrets
- ✅ Verified no public registration exists
- ✅ Verified no role column, leaderboard, or seeding logic was implemented

### Current state

- Branch: `backend-foundation`
- Phase 1B / 1C / 2 are committed; Phase 3 changes are in the working tree, pending review
- The Phase 3 migration is a normal, tracked migration file — it is **committed with Phase 3** and applied through the standard Supabase migration workflow, exactly like the Phase 1B/1C migrations. It is not a loose SQL file and is not applied automatically by the application.
- Applying it is a deliberate, separate step performed by the project owner (see §5)
- No push performed

---

## 8. Summary

The foundation phases (1B–3) establish a **secure, minimal foundation**:

- Member identity is owned by the application's `members` table — no Supabase Auth identity is created or required
- Annual July–June membership is represented without inventing payment workflows
- The seven authoritative Handbook levels are seeded as the single source of truth
- The XP ledger is the XP system: totals are summed from history, never stored, and **no member can write to it**
- XP changes are made manually by exactly two named managers, with the Handbook amounts resolved server-side and corrections appended rather than rewritten
- A member's XP is readable only by that member, through an endpoint whose identity comes from the signed session; the underlying RPC is not client-executable
- Governance roles are deliberately **not** modeled as generic role columns
- Login is an approved-email allowlist with an application-owned signed session, and the signed-in member's real profile name, XP, and level are displayed by the existing UI
- The formal XP approval workflow and XP reset behavior remain **unresolved**; the real member roster is seeded manually from a script kept outside the repository
- The frontend UI was not redesigned
