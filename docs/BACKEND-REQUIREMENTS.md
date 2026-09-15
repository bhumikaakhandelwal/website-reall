# DBCE Coders Club — Backend Requirements Analysis

> Analysis date: 2026-09-10
> Status: Read-only analysis. No implementation performed.
> Superseded on authentication: this analysis predates the finalized Phase 1C model and its
> `auth.users`-based schema sketches are historical. The approved-email allowlist login and the
> application-owned `members.id` are authoritative in `docs/BACKEND-IMPLEMENTATION-PLAN.md` §2.2 and §3.8.

---

## 1. Current Frontend Architecture

**Project:** DBCE Coders Club website
**Organization:** Coders Club, Don Bosco College of Engineering (DBCE, Goa, India)

### Framework & Stack
- **Framework:** Next.js 16.3.2 (App Router)
- **Language:** React 19 / TypeScript
- **Styling:** Tailwind CSS 4
- **3D:** @react-three/fiber, @react-three/drei, three.js
- **Animation:** motion (Framer Motion)
- **Deployment target:** Vercel (implied)

### File Structure (Frontend)

```
app/
├── layout.tsx                 # Root layout — LoginGate wrapper, Geist fonts
├── page.tsx                   # Home page
├── globals.css                # Design tokens, Tailwind, custom CSS
├── login/
│   └── page.tsx               # Login page (client component)
├── about/
│   └── page.tsx               # About page
├── activities/
│   └── page.tsx               # Activities page
├── hackathon/
│   └── page.tsx               # Hackathon details page
├── xp-system/
│   └── page.tsx               # XP System page
├── components/
│   ├── login-gate.tsx         # Auth gate (redirects based on localStorage)
│   ├── global-navigation.tsx  # Navbar + profile dropdown
│   ├── open-challanges.tsx    # Challenge cards
│   ├── activity-explorer.tsx  # Filterable activity list
│   ├── xp-visual.tsx          # Interactive 3D XP visual
│   ├── orbit-badge-lazy.tsx   # Dynamic import for 3D orbit badge
│   ├── three/
│   │   └── orbit-badge.tsx    # Three.js canvas component
│   ├── container.tsx          # Layout container
│   ├── pillar-list.tsx        # Three pillars (Explore/Build/Compete)
│   └── reveal.tsx             # Scroll-reveal animation
├── content/
│   ├── activities.ts          # Activity category data
│   └── xp-content.ts          # XP rules, levels, penalties, rewards
├── about/
│   └── page.tsx               # About page
└── not-found.tsx              # 404 page
```

### Pages & Routes
| Route | Page | Auth Required |
|-------|------|---------------|
| `/` | Home | Yes |
| `/login` | Login | No |
| `/about` | About | Yes |
| `/activities` | Activities | Yes |
| `/hackathon` | Hackathon | Yes |
| `/xp-system` | XP System | Yes |
| `/leaderboard` | Leaderboard (referenced, not yet created) | Yes |

### Content Files
All data is currently hardcoded in `/app/content/` files — static content that clearly should be persisted in a database.

### Authentication (Current)
- **Mechanism:** `localStorage.getItem("dbce-logged-in")`
- **Validation:** Client-side only, hardcoded email `abc@gmail.com` accepted
- **No server-side auth**
- **No session management**
- **No token-based auth**

---

## 2. Frontend-to-Backend Dependency Map

### What the Frontend Already Has (Static/Client-side)
- ✅ Complete visual design system
- ✅ All page layouts and components
- ✅ Static content definitions
- ✅ Interactive animations
- ✅ Client-side routing
- ✅ Login gate logic (redirecting based on localStorage)
- ✅ Profile dropdown UI
- ✅ XP system visual layout

### What the Frontend Needs the Backend For

| Frontend Element | Backend Required | Current Status |
|---|---|---|
| Login page | User authentication | ❌ Client-side only |
| Global nav profile | User data fetch | ❌ Hardcoded ("Bhumika Khandelwal") |
| XP display | User XP balance | ❌ Hardcoded (350 XP) |
| Level display | User current level | ❌ Hardcoded (Level 1) |
| Level icons | Level assets mapping | ⚠️ Static images exist |
| Leaderboard | User rankings | ❌ Hardcoded data |
| Open challenges | Challenge data + enrollment | ❌ Hardcoded data |
| Activities list | Activity categories | ❌ Hardcoded data |
| XP activities | XP rules + earning | ❌ Hardcoded data |
| XP levels | Level definitions | ❌ Hardcoded data |
| XP penalties | Penalty rules | ❌ Hardcoded data |
| Leaderboard types | Leaderboard definitions | ❌ Hardcoded data |
| Rewards | Reward definitions | ❌ Hardcoded data |
| Hackathon registration | Registration system | ❌ Not implemented |
| Take challenge button | Challenge enrollment | ❌ Not implemented |
| XP earning | XP award mechanism | ❌ Not implemented |
| XP verification | Approval workflow | ❌ Not implemented |
| Discord/WhatsApp integration | Member status | ❌ Not implemented |
| Council page | Council member data | ❌ Hardcoded in docs |

---

## 3. Required Backend Capabilities

### 3.1 Authentication & Authorization

#### Explicit Requirements (from frontend):
- [x] **Student login** — email + password (currently only email validated)
- [x] **Session management** — login state persists across pages
- [x] **Logout** — clears session, redirects to login
- [x] **Access control** — unauthenticated users redirected to `/login`
- [x] **Login page exemption** — login page has no nav/footer

#### Documented Requirements (from architecture.md):
- [ ] **Authentication provider** — Supabase Auth
- [ ] **Role-based access** — members, council, faculty coordinators, admin
- [ ] **Row Level Security (RLS)** — database-level access control
- [ ] **Server-side access checks** — not client-side only

#### Inferred but Not Yet Implemented:
- [ ] **Student registration** — new members can join (referenced in home page CTA)
- [ ] **Email verification** — registered student email validation
- [ ] **Password reset** — not present in UI
- [ ] **Session persistence** — server-side sessions (not just localStorage)

#### Completely Undefined:
- [ ] What roles exist beyond "student" (faculty coordinators? external judges?)
- [ ] How student membership is verified (institutional email domain?)
- [ ] Whether OAuth (GitHub/Discord) is required
- [ ] Whether council members have special privileges
- [ ] How faculty coordinators verify XP

### 3.2 User/Member Account Management

#### Explicit Requirements:
- [ ] **Profile display** — name, level, XP in navbar
- [ ] **Profile images** — level icon images (7 images exist in `public/level-icons/`)
- [ ] **Profile dropdown** — avatar, level number, level name, XP progress
- [ ] **Logout button** — in profile dropdown and mobile menu

#### Documented Requirements:
- [ ] **Single source of truth for membership data** — database

#### Currently Hardcoded in Frontend:
- `currentLevel = 1`
- `currentXP = 350`
- User name = "Bhumika Khandelwal" (who is also listed as "Internal Affairs" in docs)
- Level icons use `levelIcons[currentLevel]` (1-7)

#### Inferred Requirements:
- [ ] **User profiles** with display name, email, level, XP, avatar URL
- [ ] **Profile update capability**
- [ ] **Member status** (active, inactive, graduated?)
- [ ] **Registration form** (referenced by "Become a member" link and join CTA)

#### Completely Undefined:
- [ ] Full profile fields (department, year, GitHub URL, bio, etc.)
- [ ] Profile picture storage (currently using level icons as avatars)
- [ ] Whether members can update their own profiles
- [ ] Council member profiles and their display

### 3.3 Navigation/Profile State

#### Explicit Requirements:
- [ ] **Global navigation** — persistent on all non-login pages
- [ ] **Profile dropdown** — shows avatar, level, XP, name
- [ ] **Navigation links** — Home, About, Activities, Hackathon, Challenges, Leaderboard, XP System, GitHub
- [ ] **Mobile responsive** — hamburger menu with profile section
- [ ] **Active state** — highlights current page
- [ ] **Profile state sync** — dropdown updates on profile change

#### Currently Hardcoded:
- Navigation items array
- Profile data (name, level, XP)
- Level icons mapping
- Level names mapping
- XP requirements per level

#### Backend Requirements:
- [ ] Fetch user profile data for navbar
- [ ] Fetch navigation config (maybe)
- [ ] Sync profile state across sessions

---

## 4. Required Database Entities and Relationships

### 4.1 Entities Required

#### User (Member)
```
- id (UUID or integer)
- email (unique, student email)
- password_hash
- display_name
- avatar_url (optional)
- level_id (FK to Levels)
- xp_current (integer, default 0)
- membership_status (active/pending/inactive)
- is_council_member (boolean)
- role (student/council/faculty_coordinator/admin)
- created_at
- updated_at
- last_login_at
```

#### Level
```
- id (integer, 1-7)
- title (string, e.g., "Rookie", "Novice Coder")
- xp_required (integer)
- description (optional)
- sort_order (integer)
```

**Note:** `xp_required` is inconsistent between `global-navigation.tsx` (500, 1000, 2000, 3500, 5000, 7000, 10000) and `xp-content.ts` (<500, 500, 1000, 2000, 3000, 4000, 5000). One of these must be the source of truth.

#### XP Activity (Earning Category)
```
- id (serial)
- name (string, e.g., "Membership", "Attend technical session")
- xp_value (integer)
- is_starred (boolean, highlights special activities)
- description (optional)
- requires_approval (boolean)
- sort_order (integer)
```

#### XP Penalty
```
- id (serial)
- violation_description (string)
- penalty_xp (integer, negative)
- requires_approval (boolean)
```

#### Leaderboard
```
- id (serial)
- user_id (FK to User)
- xp_total (integer)
- hackathon_rank (integer, nullable)
- contribution_rank (integer, nullable)
- last_updated (timestamp)
```

#### Challenge
```
- id (serial)
- title (string)
- description (text)
- difficulty_level (BEGINNER/INTERMEDIATE/ADVANCED)
- xp_reward (integer)
- is_active (boolean)
- created_at
- updated_at
```

#### Challenge Enrollment/Submission
```
- id (serial)
- user_id (FK to User)
- challenge_id (FK to Challenge)
- status (pending/in_progress/submitted/approved/rejected)
- submitted_at (timestamp)
- approved_at (timestamp, nullable)
- approved_by (FK to User, nullable)
- notes (text, nullable)
```

#### Activity Category (from content/activities.ts)
```
- id (serial)
- title (string, e.g., "Hackathons", "Workshops and Technical Learning Activities")
- description (text)
```

#### Event/Hackathon
```
- id (serial)
- title (string)
- description (text)
- phase (in_campus/offshore)
- start_date (timestamp)
- end_date (timestamp)
- location (text)
- max_teams (integer)
- is_active (boolean)
- requires_registration (boolean)
- registration_deadline (timestamp)
```

#### Event Registration
```
- id (serial)
- user_id (FK to User)
- event_id (FK to Event)
- status (pending/confirmed/waitlisted/rejected)
- registered_at (timestamp)
- team_name (string, nullable)
- team_members (text[], nullable)
```

#### Council Member (from docs)
```
- id (FK to User)
- position (President, Vice President, Secretary, etc.)
- department (text)
- term_start (date)
- term_end (date)
- is_active (boolean)
```

### 4.2 Entity Relationships

```
User (1) ──→ (0..N) ChallengeSubmission
User (1) ──→ (0..N) EventRegistration
User (1) ──→ (0..1) UserProfile
User (1) ──→ (0..N) LeaderboardEntry
User (1) ──→ (0..1) CouncilMember
User (1) ──→ (0..1) FacultyCoordinator

Level (1) ──→ (N) User  (many-to-one: many users at one level)
Challenge (1) ──→ (N) ChallengeSubmission
Event (1) ──→ (N) EventRegistration
ActivityCategory (1) ──→ (N) XPActivity
```

---

## 5. Authentication Requirements

### 5.1 Explicit Requirements (from frontend code)

**Login (`/login` page):**
- Email input field
- Form submission with validation
- Client-side loading state ("SCANNING OPERATOR ID...")
- Success state ("ACCESS GRANTED")
- Error state ("ACCESS DENIED" with "EMAIL NOT FOUND IN DATABASE")
- localStorage persistence via `dbce-logged-in` key
- Auto-redirect to home on success
- Auto-redirect to login on logout

**LoginGate (`components/login-gate.tsx`):**
- Redirects unauthenticated users to `/login`
- Allows login page access without auth
- Redirects authenticated users away from `/login`
- Shows loading state while checking auth
- Wraps all pages except login

**GlobalNavigation (`components/global-navigation.tsx`):**
- Shows logged-in user profile
- Has logout button (clears localStorage, redirects to login)
- Profile dropdown with user info
- Mobile menu with profile actions

**Logout:**
- `localStorage.removeItem("dbce-logged-in")`
- Redirect to `/login`

### 5.2 Documented Requirements (from architecture.md)
- Supabase Auth
- Row Level Security (RLS)
- Server-side authentication
- Single source of truth

### 5.3 Authorization Requirements

#### Roles (inferred from UI and docs):
1. **Student/Member** — Can login, view challenges, earn XP, view leaderboard
2. **Council Member** — Same as member + profile visibility, possibly management
3. **Faculty Coordinator** — Can verify/approve XP submissions (mentioned in xp-content.ts)
4. **Admin** — Full system management

#### Authorization Checks Needed:
- [ ] Only logged-in users can access protected pages
- [ ] Council members can see/edit council information
- [ ] Faculty coordinators can approve XP submissions
- [ ] Students can only edit their own profile
- [ ] RLS policies to prevent data leakage

### 5.4 Security Requirements

#### From architecture.md:
- Authentication provider (Supabase)
- RLS + server-side checks
- Single source of truth for membership data
- Security by design

#### From frontend code:
- Session management
- Protected routes
- Logout functionality
- Client-side validation (needs server-side complement)

#### Inferred Security Needs:
- [ ] Password hashing (bcrypt/Argon2)
- [ ] JWT or session tokens
- [ ] CSRF protection
- [ ] Rate limiting on login
- [ ] Email validation (student email domain)
- [ ] Input sanitization
- [ ] XSS protection
- [ ] Secure headers

### 5.5 Completely Undefined
- Registration form fields and flow
- Email verification process
- Password reset flow
- Session timeout duration
- Whether OAuth (GitHub/Discord) login is needed
- Whether 2FA is required
- How student email domain is validated

---

## 6. Authorization Requirements

### 6.1 Role Matrix

| Action | Student | Council | Faculty | Admin |
|--------|---------|---------|---------|-------|
| Login | ✅ | ✅ | ✅ | ✅ |
| View challenges | ✅ | ✅ | ✅ | ✅ |
| Take challenge | ✅ | ✅ | ✅ | ✅ |
| Submit challenge | ✅ | ✅ | ✅ | ✅ |
| View XP activities | ✅ | ✅ | ✅ | ✅ |
| Earn XP | ✅ | ✅ | ✅ | ✅ |
| View own XP | ✅ | ✅ | ✅ | ✅ |
| View leaderboard | ✅ | ✅ | ✅ | ✅ |
| Approve XP | ❌ | ❌ | ✅ | ✅ |
| Manage events | ❌ | ❌ | ✅ | ✅ |
| Manage users | ❌ | ❌ | ❌ | ✅ |
| View council | ✅ | ✅ | ✅ | ✅ |
| Edit council | ❌ | ✅ | ❌ | ✅ |
| Access admin panel | ❌ | ❌ | ❌ | ✅ |

### 6.2 RLS Policies (for Supabase)
- Users can read their own profile
- Users can update their own profile
- Council members can read all users' profiles
- Faculty coordinators can create/approve XP records
- Admin can manage all data
- Everyone can read active challenges

### 6.3 Completely Undefined
- Specific permissions per role
- Whether there's a moderation role
- Data visibility rules (who sees what leaderboard data)
- Whether XP verification is multi-step or single-step
- Approval workflows (sequential vs parallel)

---

## 7. XP/Level/Challenge Backend Requirements

### 7.1 XP System

#### From `content/xp-content.ts`:
**Activities that earn XP:**
- Membership: 50 XP
- Attend technical session: 50 XP
- Solving club coding problem: 50 XP
- Publish GitHub project: 50 XP ⭐
- Create technical tutorial: 50 XP
- Open-source contribution: 100 XP ⭐
- Support in organizing club events: 100 XP
- Participate in internal coding contest: 100 XP
- Top 10 — Internal contest: 150 XP
- Participate in external coding contest/hackathon: 150 XP
- Top 3 — Internal contest: 200 XP
- Conduct workshop/sessions/events: 200 XP
- Reach hackathon finals: 200 XP
- Win hackathon: 250 XP
- 30-day coding streak: 250 XP ⭐

**Notes from xp-content.ts:**
- "GitHub projects submitted and open-source contributions should be meaningful to claim XP"
- "The 30-day coding streak should be on LeetCode or HackerRank"
- "XP points are subject to Committee and/or Advisor approval"
- "Leaderboards are updated monthly and displayed on the club's Discord and WhatsApp"

**Verification:**
- XP is verified by faculty coordinators and student core committee
- Starred activities (`⭐`) require approval
- `starred` field in `xpActivities` indicates activities requiring approval

**XP Levels (from `xp-content.ts`):**
| Level | Title | XP Required |
|-------|-------|-------------|
| 1 | Rookie | < 500 |
| 2 | Novice Coder | 500 |
| 3 | Code Explorer | 1,000 |
| 4 | Code Warrior | 2,000 |
| 5 | Coding Champion | 3,000 |
| 6 | Code Master | 4,000 |
| 7 | Coding Legend | 5,000 |

**⚠️ Inconsistency:** `global-navigation.tsx` has different XP requirements (500, 1000, 2000, 3500, 5000, 7000, 10000) vs `xp-content.ts` (<500, 500, 1000, 2000, 3000, 4000, 5000). This must be resolved before backend implementation.

**XP Penalties:**
| Violation | Penalty |
|-----------|---------|
| Fake certificate submission | -500 |
| Plagiarism in internal/external competitions | -200 |
| Unsportsmanlike conduct | -100 |
| Verified non-contribution in team event | -50 |
| Absence from club meetings/sessions without valid reason | -50 |

**Rewards:**
- Certificates
- Best Hackathon Team Award

**Leaderboard Types:**
1. Overall XP Leaderboard — every member ranked by total XP
2. Hackathon Leaderboard — ranked by hackathon performance
3. Contribution Leaderboard — ranked by open-source project contributions

**Leaderboard Updates:** "Updated monthly and displayed on the club's Discord and WhatsApp"

#### From `global-navigation.tsx`:
- `currentLevel = 1`, `currentXP = 350` (hardcoded test data)
- `levelRequirements`: {1: 500, 2: 1000, 3: 2000, 4: 3500, 5: 5000, 6: 7000, 7: 10000}
- `levelNames`: {1: "Rookie", 2: "Novice Coder", ..., 7: "Code Legend"}
- `levelIcons`: {1: "/level-icons/level-1.png", ..., 7: "/level-icons/level-7.png"}

### 7.2 Level Calculation

The frontend calculates level based on `currentXP` and `levelRequirements`. Backend must:
1. Calculate user's current level from `xp_current`
2. Return next level requirement and progress percentage
3. Return XP to go for next level
4. Handle max level (level 7) state

### 7.3 Challenge System

#### From `open-challanges.tsx`:
**Challenges:**
1. BEGINNER — "Ship your first CLI" — 150 XP — "A weekend-sized task..."
2. INTERMEDIATE — "Rebuild an API" — 400 XP — "Take a public API..."
3. ADVANCED — "Open-source patch" — 900 XP — "Land a merged pull request..."

**UI Elements:**
- "Take the challenge ↗" button (currently no handler)
- Each card shows level badge, XP reward, title, description

**Backend Requirements:**
- Fetch active challenges
- Challenge enrollment/submission
- Approval workflow
- XP award on approval
- Track submission status
- "Take challenge" action endpoint

### 7.4 Activity Tracking

#### From `activities.ts`:
Categories:
1. Hackathons
2. Workshops and Technical Learning Activities
3. Panel Discussions
4. Industry Field Visits
5. Conference Participation

The Activities page shows these as static filterable items. Backend may need:
- Activity category management
- Event scheduling
- Attendance tracking

### 7.5 Completely Undefined
- How XP is recorded (manual approval, auto-approve, peer verification?)
- Whether XP is tracked per-activity or just a total balance
- Whether the system tracks activity history or just current totals
- How XP is verified and approved (workflow UI?)
- Whether there's an XP history/audit log
- How penalties are applied and tracked
- Whether penalties can be appealed
- Whether XP resets periodically (monthly?)
- How leaderboard rankings are calculated

---

## 8. API/Service Requirements

### 8.1 Authentication API

| Endpoint | Method | Description | Request Body | Response |
|----------|--------|-------------|-------------|----------|
| `/api/auth/login` | POST | Student login | `{email, password}` | `{token, user}` |
| `/api/auth/logout` | POST | Student logout | - | `{success}` |
| `/api/auth/me` | GET | Get current user | - | `{user}` |
| `/api/auth/register` | POST | New student registration | `{email, password, name, ...}` | `{user}` |
| `/api/auth/refresh` | POST | Refresh session token | `{token}` | `{token}` |

### 8.2 User API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/me` | GET | Get current user profile |
| `/api/users/me` | PUT | Update current user profile |
| `/api/users/:id` | GET | Get user profile (public) |
| `/api/users` | GET | List all users (admin/council) |
| `/api/users/:id/level` | GET | Get user level and XP progress |

### 8.3 XP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/xp/balance` | GET | Get user's current XP balance |
| `/api/xp/history` | GET | Get user's XP activity history |
| `/api/xp/leaderboard` | GET | Get leaderboard (type param) |
| `/api/xp/activities` | GET | Get all XP-earning activities |
| `/api/xp/levels` | GET | Get all level definitions |
| `/api/xp/penalties` | GET | Get all XP penalties |
| `/api/xp/rewards` | GET | Get all rewards |
| `/api/xp/award` | POST | Award XP to user (faculty only) |
| `/api/xp/deduct` | POST | Deduct XP from user (faculty only) |
| `/api/xp/approve/:id` | POST | Approve pending XP (faculty) |
| `/api/xp/reject/:id` | POST | Reject pending XP (faculty) |

### 8.4 Challenge API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/challenges` | GET | Get active challenges |
| `/api/challenges/:id` | GET | Get challenge details |
| `/api/challenges/:id/enroll` | POST | Enroll in challenge |
| `/api/challenges/:id/submit` | POST | Submit challenge solution |
| `/api/challenges/my` | GET | Get user's challenge submissions |
| `/api/challenges/:id/status` | GET | Get submission status |
| `/api/challenges/:id/approve` | POST | Approve submission (faculty) |

### 8.5 Event API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | Get all events |
| `/api/events/:id` | GET | Get event details |
| `/api/events/:id/register` | POST | Register for event |
| `/api/events/:id/unregister` | POST | Unregister from event |
| `/api/events/my` | GET | Get user's registrations |
| `/api/events/:id/team` | POST | Create/join team |

### 8.6 Activity API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/activities` | GET | Get all activity categories |
| `/api/activities/:id` | GET | Get activities in category |

### 8.7 Council API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/council` | GET | Get council members |
| `/api/council/:id` | GET | Get council member profile |

### 8.8 Data Requirements

All content from `/app/content/` must be served by the backend:
- Activity categories → `/api/activities`
- XP activities → `/api/xp/activities`
- XP levels → `/api/xp/levels`
- XP penalties → `/api/xp/penalties`
- XP rewards → `/api/xp/rewards`
- Leaderboard types → `/api/leaderboard/types`
- Challenges → `/api/challenges`
- Leaderboard data → `/api/leaderboard`

---

## 9. Security Requirements

### 9.1 Authentication Security
- [ ] Secure password hashing (bcrypt/Argon2)
- [ ] JWT or session-based auth with secure tokens
- [ ] HTTPS enforced in production
- [ ] Secure cookie settings (HttpOnly, SameSite, Secure)
- [ ] CSRF protection
- [ ] Rate limiting on authentication endpoints
- [ ] Account lockout after failed attempts
- [ ] Email verification for student domain

### 9.2 Authorization Security
- [ ] Role-based access control (RBAC)
- [ ] Row Level Security (RLS) on Supabase
- [ ] Server-side authorization checks (not just client-side)
- [ ] Principle of least privilege
- [ ] Data isolation (users can only access their own data)

### 9.3 Data Security
- [ ] Input validation and sanitization
- [ ] SQL injection prevention
- [ ] XSS protection
- [ ] Sensitive data encryption at rest
- [ ] Audit logging for sensitive operations
- [ ] Data backup and recovery plan

### 9.4 API Security
- [ ] API rate limiting
- [ ] Input validation (Zod)
- [ ] Output sanitization
- [ ] Error handling without information leakage
- [ ] CORS configuration
- [ ] Content-Type validation

### 9.5 Infrastructure Security
- [ ] Environment variable management
- [ ] Secret rotation
- [ ] Dependency vulnerability scanning
- [ ] Security headers (HSTS, CSP, X-Frame-Options)
- [ ] DDoS protection

### 9.6 Completely Undefined
- Whether email domain validation is required (student emails only?)
- Whether OAuth providers are needed (GitHub/Discord?)
- Data retention policy
- Data deletion policy (GDPR compliance)
- Whether IP logging is required
- Whether there are audit requirements

---

## 10. Recommended Backend Architecture

### 10.1 Technology Stack Recommendation

Based on the existing architecture document (`docs/architecture.md`) explicitly specifying Supabase:

**Primary Stack:**
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **Storage:** Supabase Storage (for avatars, level icons)
- **Backend:** Next.js API Routes or standalone Next.js backend
- **Language:** TypeScript
- **Validation:** Zod
- **ORM:** Drizzle ORM or Prisma (or direct Supabase client)
- **Testing:** Jest + React Testing Library
- **Deployment:** Vercel (same as frontend)

**Why Supabase:**
- Explicitly specified in `docs/architecture.md`
- Provides Auth, PostgreSQL, RLS, Storage out of the box
- Native Next.js integration
- Real-time capabilities for future features
- Single vendor for database + auth + storage

### 10.2 Architecture Pattern

```
┌─────────────────────────────────────────────┐
│                  Frontend                    │
│         Next.js 16 (App Router)              │
│    React 19, TypeScript, Tailwind CSS 4      │
└──────────────────┬──────────────────────────┘
                   │ HTTP/REST
                   │ (Next.js API Routes or separate)
┌──────────────────▼──────────────────────────┐
│              Backend Layer                   │
│   Next.js API Routes (Route Handlers)        │
│   - /api/auth/*                              │
│   - /api/users/*                             │
│   - /api/xp/*                                │
│   - /api/challenges/*                        │
│   - /api/events/*                            │
│   - /api/council/*                           │
│   - /api/activities/*                        │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Supabase Layer                  │
│   - PostgreSQL Database                      │
│   - Row Level Security (RLS)                 │
│   - Authentication                           │
│   - Storage                                  │
│   - Edge Functions (optional)                │
└─────────────────────────────────────────────┘
```

### 10.3 Component Structure

```
app/
├── api/                          # API Routes
│   ├── auth/
│   │   ├── login/route.ts
│   │   ├── logout/route.ts
│   │   ├── me/route.ts
│   │   └── register/route.ts
│   ├── users/
│   │   └── [id]/route.ts
│   ├── xp/
│   │   ├── balance/route.ts
│   │   ├── history/route.ts
│   │   ├── leaderboard/route.ts
│   │   ├── activities/route.ts
│   │   ├── levels/route.ts
│   │   └── ...
│   ├── challenges/
│   │   ├── route.ts
│   │   ├── [id]/route.ts
│   │   └── ...
│   ├── events/
│   │   └── ...
│   └── ...
├── lib/                          # Library code
│   ├── supabase/                 # Supabase client
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── db/                       # Database utilities
│   │   ├── queries.ts
│   │   ├── schemas.ts
│   │   └── migrations/
│   ├── auth/                     # Auth utilities
│   │   ├── guards.ts
│   │   ├── roles.ts
│   │   └── session.ts
│   ├── validation/               # Zod schemas
│   │   ├── auth.ts
│   │   ├── user.ts
│   │   ├── xp.ts
│   │   ├── challenge.ts
│   │   └── event.ts
│   └── constants/                # App constants
├── components/                   # Existing frontend components (unchanged)
├── content/                      # Existing content (can be replaced by API)
├── login/                        # Existing login page (unchanged)
├── about/                        # Existing about page (unchanged)
├── activities/                   # Existing activities page (unchanged)
├── hackathon/                    # Existing hackathon page (unchanged)
├── xp-system/                    # Existing XP system page (unchanged)
└── leaderboard/                  # NEW: Leaderboard page (referenced but not created)
```

### 10.4 API Design Principles

- **RESTful** resource-based endpoints
- **JSON** request/response bodies
- **Zod** for request/response validation
- **TypeScript** types for all API contracts
- **Server-side** authentication checks for all protected routes
- **Supabase RLS** as additional security layer
- **Pagination** for list endpoints
- **Filtering** and **sorting** for queryable endpoints

### 10.5 Data Model Design

```sql
-- Users table (via Supabase Auth)
-- Extends auth.users with additional fields

-- Levels table
CREATE TABLE levels (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 7),
    title TEXT NOT NULL,
    xp_required INTEGER NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT id,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- XP Activities table
CREATE TABLE xp_activities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    xp_value INTEGER NOT NULL CHECK (xp_value > 0),
    is_starred BOOLEAN DEFAULT FALSE,
    requires_approval BOOLEAN DEFAULT FALSE,
    description TEXT,
    sort_order INTEGER DEFAULT id,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- XP Penalties table
CREATE TABLE xp_penalties (
    id SERIAL PRIMARY KEY,
    violation TEXT NOT NULL,
    penalty_xp INTEGER NOT NULL CHECK (penalty_xp < 0),
    requires_approval BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenges table
CREATE TABLE challenges (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    difficulty_level TEXT CHECK (difficulty_level IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
    xp_reward INTEGER NOT NULL CHECK (xp_reward > 0),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenge Submissions table
CREATE TABLE challenge_submissions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    challenge_id INTEGER REFERENCES challenges(id),
    status TEXT CHECK (status IN ('pending', 'in_progress', 'submitted', 'approved', 'rejected')),
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- XP Ledger table (audit trail)
CREATE TABLE xp_ledger (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    activity_id INTEGER REFERENCES xp_activities(id),
    xp_amount INTEGER NOT NULL,
    reason TEXT,
    approved_by UUID REFERENCES auth.users(id),
    is_approved BOOLEAN DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Profile table (extends auth.users)
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    display_name TEXT,
    avatar_url TEXT,
    level_id INTEGER REFERENCES levels(id),
    xp_current INTEGER DEFAULT 0,
    membership_status TEXT CHECK (membership_status IN ('pending', 'active', 'inactive')),
    is_council_member BOOLEAN DEFAULT FALSE,
    role TEXT CHECK (role IN ('student', 'council', 'faculty_coordinator', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events table
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    phase TEXT CHECK (phase IN ('in_campus', 'offshore')),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    location TEXT,
    max_teams INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    registration_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event Registrations table
CREATE TABLE event_registrations (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    event_id INTEGER REFERENCES events(id),
    status TEXT CHECK (status IN ('pending', 'confirmed', 'waitlisted', 'rejected')),
    team_name TEXT,
    registered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Council Members table
CREATE TABLE council_members (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    position TEXT NOT NULL,
    department TEXT,
    term_start DATE,
    term_end DATE,
    is_active BOOLEAN DEFAULT TRUE
);

-- Leaderboard View
CREATE VIEW leaderboard_view AS
SELECT 
    up.id as user_id,
    up.display_name,
    up.xp_current,
    l.title as level_title,
    l.id as level_id
FROM user_profiles up
JOIN levels l ON up.level_id = l.id
WHERE up.membership_status = 'active'
ORDER BY up.xp_current DESC;
```

### 10.6 Migration Path

```
Phase 1: Foundation
├── Supabase project setup
├── Database schema creation
├── RLS policies
├── Auth configuration
└── Basic API routes (auth, user profile)

Phase 2: Core Features
├── XP system (ledger, activities, levels)
├── Challenge system
├── Leaderboard endpoints
└── Frontend integration

Phase 3: Extended Features
├── Event/hackathon system
├── Council management
├── Activity tracking
└── Advanced features
```

---

## 11. Backend Implementation Roadmap

### Phase 1: Foundation (Highest Priority)
**Duration:** 1-2 weeks
**Goal:** Establish authentication and basic user management

1. **Supabase Project Setup**
   - Create Supabase project
   - Configure database
   - Set up RLS policies
   - Configure authentication providers

2. **Database Schema**
   - Create all tables (see Section 10.5)
   - Set up RLS policies
   - Create indexes for performance
   - Set up initial data (levels, XP activities, penalties)

3. **Authentication API**
   - `/api/auth/login`
   - `/api/auth/logout`
   - `/api/auth/me`
   - `/api/auth/register`

4. **User Profile API**
   - `/api/users/me` (GET/PUT)
   - Profile management

5. **Frontend Integration**
   - Replace localStorage auth with Supabase Auth
   - Replace hardcoded user data with API calls
   - Update LoginGate component
   - Update GlobalNavigation component

6. **Level Icons**
   - Upload level icon images to Supabase Storage (already exist in public/)
   - Update levelIcons references to use Supabase Storage URLs

### Phase 2: Core Features
**Duration:** 2-3 weeks
**Goal:** XP system, challenges, and leaderboard

1. **XP System**
   - `/api/xp/balance`
   - `/api/xp/history`
   - `/api/xp/leaderboard`
   - `/api/xp/activities`
   - `/api/xp/levels`
   - `/api/xp/award`
   - `/api/xp/deduct`
   - `/api/xp/approve/:id`

2. **Challenge System**
   - `/api/challenges`
   - `/api/challenges/:id/enroll`
   - `/api/challenges/:id/submit`
   - `/api/challenges/my`
   - `/api/challenges/:id/approve`

3. **Frontend Integration**
   - Replace hardcoded XP data with API calls
   - Replace hardcoded challenges with API calls
   - Replace hardcoded leaderboard with API calls
   - Add challenge enrollment functionality
   - Update profile dropdown with real data
   - Add "Take challenge" button handler

4. **Leaderboard Page**
   - Create `/leaderboard` page (referenced in nav but doesn't exist)
   - Display overall, hackathon, and contribution leaderboards

### Phase 3: Extended Features
**Duration:** 2-3 weeks
**Goal:** Events, council, and polish

1. **Event System**
   - `/api/events`
   - `/api/events/:id/register`
   - `/api/events/my`

2. **Council Management**
   - `/api/council`
   - Council page
   - Council member data

3. **Activity Tracking**
   - Activity category endpoints
   - Activity tracking

4. **Additional Features**
   - XP verification workflow UI
   - Notification system
   - Discord/WhatsApp integration (webhooks)

### Phase 4: Polish & Optimization
**Duration:** Ongoing
- Performance optimization
- Caching strategies
- Advanced features
- Testing

---

## 12. Unknowns and Blockers

### 12.1 Critical Unknowns

1. **XP Level Requirements Inconsistency**
   - `global-navigation.tsx`: 500, 1000, 2000, 3500, 5000, 7000, 10000
   - `xp-content.ts`: <500, 500, 1000, 2000, 3000, 4000, 5000
   - **Impact:** Backend cannot calculate levels without knowing correct requirements
   - **Action Required:** Project owner must decide which set is authoritative

2. **Login Validation Logic**
   - Currently hardcoded email `abc@gmail.com` is accepted
   - No actual validation against a database
   - **Unknown:** What is the registration process? How do students get credentials?
   - **Impact:** Backend auth design depends on this

3. **XP Verification Workflow**
   - `xp-content.ts` says "XP points are subject to Committee and/or Advisor approval"
   - Starred activities have `*` footnote indicating approval needed
   - **Unknown:** What does the approval UI look like? Who can approve?
   - **Impact:** Backend must support approval workflow

4. **Challenge Submission Process**
   - "Take the challenge ↗" button has no handler in frontend
   - **Unknown:** How do students submit challenges? What format?
   - **Impact:** Backend API design depends on this

5. **Student Email Domain**
   - Frontend says "Use your registered student email"
   - **Unknown:** What is the valid domain? How is it verified?
   - **Impact:** Registration and authentication security

6. **Leaderboard Page**
   - Navigation links to `/leaderboard` but page doesn't exist
   - **Unknown:** What data should be displayed? How many entries?
   - **Impact:** Backend must support leaderboard endpoints

### 12.2 Potential Blockers

1. **Supabase Configuration** — Need Supabase project credentials (project ID, URL, service role key, anon key)
2. **Database Migrations** — Need to decide on migration strategy
3. **Content Migration** — Static content in `/app/content/` must be migrated to database
4. **Frontend Data Consistency** — Many hardcoded values need to be replaced with API calls
5. **Inconsistency Resolution** — XP level requirements and possibly other data conflicts must be resolved

### 12.3 Assumptions (to validate with project owner)

- Supabase is the chosen backend (per architecture.md)
- Student email domain validation is required
- XP approval workflow uses faculty coordinators
- Council members are a subset of users with elevated privileges
- Level icons are static images stored in Supabase Storage
- No real-time requirements (leaderboards updated monthly)
- Event/hackathon system may or may not be needed immediately

---

## Appendix: Complete Content Audit

### A.1 All Hardcoded Content (must become database-backed)

| Location | Content | Source File |
|----------|---------|-------------|
| `/` page | Leaderboard (3 entries) | `page.tsx` |
| `/` page | FAQs (3 entries) | `page.tsx` |
| `open-challanges.tsx` | 3 challenges | `components/open-challanges.tsx` |
| `global-navigation.tsx` | Navigation items, levels, icons, level names | `components/global-navigation.tsx` |
| `global-navigation.tsx` | User name, level, XP | `components/global-navigation.tsx` |
| `activities.ts` | 5 activity categories | `content/activities.ts` |
| `xp-content.ts` | 15 XP activities | `content/xp-content.ts` |
| `xp-content.ts` | 7 levels | `content/xp-content.ts` |
| `xp-content.ts` | 5 penalties | `content/xp-content.ts` |
| `xp-content.ts` | 3 leaderboard types | `content/xp-content.ts` |
| `xp-content.ts` | 2 rewards | `content/xp-content.ts` |
| `xp-content.ts` | Intro text, footnote | `content/xp-content.ts` |
| `pillars.tsx` | 3 pillars | `components/pillar-list.tsx` |

### A.2 All Referenced Pages Not Yet Created

| Route | Referenced By | Notes |
|-------|--------------|-------|
| `/leaderboard` | GlobalNavigation link | Page does not exist |

### A.3 Assets Available

- Level icons: `/public/level-icons/level-1.png` through `level-7.png`
- Robot image: `/public/robot.png`
- Other public assets: `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`

---

## FIRST BACKEND MILESTONE

**"Foundation: Authentication and User Profile System"**

The single highest-value backend milestone is implementing **Supabase-based authentication with user profile management**, including:

1. **Supabase project setup** with PostgreSQL, Auth, RLS, and Storage
2. **Database schema** — Users, User Profiles, Levels tables with all RLS policies
3. **Authentication API** — Login, Logout, Register, and Me endpoints
4. **User Profile API** — Get and update profile with real user data
5. **Initial data seeding** — Levels (1-7) with correct XP requirements (resolve the inconsistency first)
6. **Frontend integration** — Replace localStorage auth with Supabase Auth, replace hardcoded user data ("Bhumika Khandelwal", level 1, 350 XP) with real API calls

**Why this is the highest-value milestone:**
- Every other feature depends on authentication (challenges, XP, leaderboard, events)
- It validates the Supabase stack and RLS policies work correctly
- It provides immediate visible improvement (real user data instead of hardcoded values)
- It unblocks the remaining frontend-to-backend integration
- The current "ACCESS DENIED" for non-`abc@gmail.com` emails would be immediately fixed for real students
- All hardcoded user data in navigation would become dynamic and personalized

**Estimated effort:** 1-2 weeks
**Deliverable:** Users can register, login, and see their real profile data reflected in the navbar and profile dropdown

---

*Analysis complete. No implementation performed in this session.*
*All findings are based solely on read-only inspection of the existing frontend codebase.*
