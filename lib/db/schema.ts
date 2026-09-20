import { z } from 'zod';

export const membershipStatusSchema = z.enum(['pending', 'active', 'inactive']);

// Member profile schema for validation
// Contains only safe fields — no roles, governance, or security-sensitive data
export const memberSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().min(1),
  membership_status: membershipStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

// Level definitions follow the Handbook's seven authoritative levels.
// Level 1 is "<500" — represented here as the lower bound being 0.
export const levelSchema = z.object({
  id: z.number().int().min(1).max(7),
  title: z.string().min(1),
  xp_required: z.number().int().min(0),
  sort_order: z.number().int(),
});

// xp_ledger entry — read-only for normal members, no INSERT/UPDATE/DELETE via RLS
export const xpLedgerEntrySchema = z.object({
  id: z.number().int(),
  user_id: z.string().uuid(),
  xp_amount: z.number().int().refine((value) => value !== 0, 'XP amount must not be zero'),
  // Phase 3: handbook activity code, or null for a corrective adjustment.
  activity_code: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  created_at: z.string(),
});

// Phase 4: one aggregated row of a monthly leaderboard, as returned by the
// get_monthly_leaderboard function. Snake_case because it mirrors the
// function's output columns; lib/db/queries.ts maps it to the camelCase shape
// the API returns. Deliberately no rank column — ranking is assigned in
// lib/xp/leaderboards.ts, not in the database.
export const leaderboardRowSchema = z.object({
  member_id: z.string().uuid(),
  display_name: z.string().min(1),
  // Can be negative when corrective entries outweigh awards in the month.
  xp: z.number().int(),
});

// Phase 5A: one row of the manager-only member directory, as returned by the
// get_member_directory function. Snake_case because it mirrors the function's
// output columns; lib/db/queries.ts maps it to the camelCase shape the API
// returns. Deliberately no level column — the level is derived from
// `total_xp` through the `levels` table (lib/xp/levels.ts), so it cannot drift
// from the thresholds the rest of the app uses.
export const memberDirectoryRowSchema = z.object({
  member_id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().min(1),
  membership_status: membershipStatusSchema,
  created_at: z.string(),
  // COALESCEd in SQL, so a member with no ledger rows is a genuine 0. Can be
  // negative if corrective entries outweigh awards.
  total_xp: z.number().int(),
  // Phase 8E: NULL while the member is active. This is the column the active /
  // archived split reads - there is no separate status for it, because
  // `membership_status` already means something else (deactivated, which refuses
  // sign-in, whereas an archived member must still be able to sign in).
  archived_at: z.string().nullable(),
});

// Phase 8E: the row the archive/restore UPDATE returns. Deliberately not the
// directory shape: an UPDATE returns the `members` columns and cannot compute
// total_xp, so this mirrors what the statement can actually give back.
export const memberArchiveRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().min(1),
  membership_status: membershipStatusSchema,
  archived_at: z.string().nullable(),
  archived_by: z.string().uuid().nullable(),
});

// Phase 5C: one row of the recent-ledger list on the manager dashboard, as
// returned by the get_recent_xp_entries function. Snake_case because it mirrors
// the function's output columns; lib/db/queries.ts maps it to the camelCase
// shape the API returns.
export const recentXpEntryRowSchema = z.object({
  // `xp_ledger.id` is SERIAL, and the only column here that is unique per row -
  // the dashboard uses it as the list key, since a member can have many entries
  // and two entries can share a timestamp.
  entry_id: z.number().int(),
  member_id: z.string().uuid(),
  display_name: z.string().min(1),
  // Signed: negative for a corrective entry. Never zero (the column has a
  // CHECK constraint), which is why the dashboard can render a +/- sign from
  // the sign alone.
  xp_amount: z.number().int().refine((value) => value !== 0, 'XP amount must not be zero'),
  // Both nullable in the ledger, and both genuinely absent on some rows: a
  // corrective entry has no activity code, and `reason` predates Phase 3 on
  // older rows. The dashboard renders a fallback rather than this layer
  // inventing a value.
  activity_code: z.string().nullable(),
  reason: z.string().nullable(),
  // A TIMESTAMPTZ written by the database in UTC. Rejected here if it is not a
  // parseable instant, so a malformed row is an error to report rather than a
  // timestamp the dashboard would render as "Invalid Date".
  created_at: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      'created_at must be a parseable timestamp'
    ),
});

// Phase 7A: the closed vocabulary of club event types.
//
// Constrained here AND by a CHECK on `events.event_type`, because this is
// product vocabulary rather than Handbook data - unlike the XP activity code,
// which is deliberately left unconstrained in SQL so the Handbook list in
// lib/xp/activities.ts stays the single source of truth. lib/events/events.ts
// imports this enum and attaches the display labels, so the two cannot drift.
export const eventTypeSchema = z.enum([
  'workshop',
  'technical-session',
  'coding-contest',
  'hackathon',
  'meeting',
  'other',
]);

// Phase 7A: one row of `events`. Snake_case because it mirrors the table's
// columns; lib/db/queries.ts maps it to the camelCase shape the API returns.
export const eventRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  event_type: eventTypeSchema,
  // A DATE, which PostgREST serializes as a plain 'YYYY-MM-DD' string with no
  // time and no zone. Checked for shape AND for being a real calendar date, so
  // a row that says 2026-02-31 is an error to report rather than a date the
  // page would render as 3 March.
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'event_date must be YYYY-MM-DD')
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'event_date must be a real date'),
  // Not checked against lib/xp/activities.ts here: this layer validates the
  // shape of what the database returned, and the route validates the vocabulary
  // before inserting. A code that is no longer in the Handbook must still be
  // readable, because events created under an older Handbook are history.
  activity_code: z.string().min(1),
  // Null when the creating manager's member row was removed - ON DELETE SET
  // NULL, so club history outlives the person who entered it.
  created_by: z.string().uuid().nullable(),
  created_at: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      'created_at must be a parseable timestamp'
    ),
  // Phase 8A: NULL means the event is active. This is the whole archive state -
  // there is deliberately no separate status column that could disagree with it.
  archived_at: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      'archived_at must be a parseable timestamp'
    )
    .nullable(),
  // The manager who archived it, or null if that member row was removed.
  archived_by: z.string().uuid().nullable(),
});

// Phase 7B: one row of `attendance`. Snake_case because it mirrors the table's
// columns; lib/db/queries.ts maps it to the camelCase shape the API returns.
export const attendanceRowSchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  member_id: z.string().uuid(),
  recorded_at: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      'recorded_at must be a parseable timestamp'
    ),
  // NULL means "not yet awarded". This is the column the whole award is built
  // on, so it is deliberately nullable here rather than defaulted - a row
  // without it is a row waiting to be awarded, not a malformed row.
  xp_ledger_id: z.number().int().nullable(),
});

// Phase 8B: one event's attendance totals, as returned by the
// get_event_attendance_totals function. Snake_case because it mirrors the
// function's output columns; lib/db/queries.ts maps it to the camelCase shape
// the API returns.
export const eventAttendanceTotalRowSchema = z.object({
  event_id: z.string().uuid(),
  // Always at least 1: the function inner-joins from attendance, so an event
  // nobody attended simply does not appear. The caller treats an absent row as
  // zero, which is why this can be a positive integer rather than a count that
  // might be 0.
  attendance_count: z.number().int().positive(),
  // COALESCEd in SQL, so attendance that has not been awarded yet is a genuine
  // 0 rather than NULL - a real and temporary state, not an error.
  xp_awarded: z.number().int().min(0),
});

// Phase 8C: one full row of `xp_ledger`, for the manager-only ledger explorer.
//
// Distinct from `recentXpEntryRowSchema` (Phase 5C), which mirrors the
// get_recent_xp_entries FUNCTION and therefore carries the member's display
// name and is capped by a limit. This mirrors the TABLE itself: every row, no
// name, no cap. The name is joined in application code from the roster the
// directory already reads, so the explorer and the directory cannot disagree
// about what a member is called.
export const xpLedgerFullRowSchema = z.object({
  id: z.number().int(),
  user_id: z.string().uuid(),
  // Signed: negative for a corrective entry. Never zero (the column has a CHECK
  // constraint), which is why the explorer can render the sign from the sign
  // alone.
  xp_amount: z.number().int().refine((value) => value !== 0, 'XP amount must not be zero'),
  // Nullable in the ledger, and null is exactly what marks an entry as a
  // correction rather than an award - the explorer's Award/Correction filter is
  // this column and nothing else.
  activity_code: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      'created_at must be a parseable timestamp'
    ),
});

// Phase 8C: the link from a ledger entry back to the event it was awarded
// through, read from `attendance`. Only rows that have actually been awarded
// appear, because an unawarded attendance row points at no ledger entry.
export const xpLedgerEventLinkRowSchema = z.object({
  xp_ledger_id: z.number().int(),
  event_id: z.string().uuid(),
});
// ---------------------------------------------------------------------------
// Phase 9: challenges
// ---------------------------------------------------------------------------

export const challengeDifficultySchema = z.enum([
  'beginner',
  'intermediate',
  'advanced',
]);

export const challengeSubmissionTypeSchema = z.enum(['github_url', 'text']);

export const challengeSubmissionStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
]);

/** One row of the `challenges` table. */
export const challengeRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  slug: z.string().min(1),
  // Must be a Handbook activity code. Pinned to lib/xp/activities.ts by a test
  // rather than by a CHECK constraint, because SQL cannot import TypeScript and
  // the activity list is deliberately owned by the code.
  activity_code: z.string().min(1),
  xp_reward: z.number().int().positive(),
  difficulty: challengeDifficultySchema,
  description: z.string(),
  requirements: z.string(),
  estimated_hours: z.number().int().positive(),
  submission_type: challengeSubmissionTypeSchema,
  archived_at: z.string().nullable(),
  archived_by: z.string().uuid().nullable(),
  created_at: z.string(),
});

/** One row of the `challenge_submissions` table. */
export const challengeSubmissionRowSchema = z.object({
  id: z.string().uuid(),
  challenge_id: z.string().uuid(),
  member_id: z.string().uuid(),
  github_url: z.string().nullable(),
  submission_text: z.string().nullable(),
  status: challengeSubmissionStatusSchema,
  manager_feedback: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  reviewed_at: z.string().nullable(),
  // Null until approved. Non-null means an XP row exists for this submission.
  xp_ledger_id: z.number().int().nullable(),
  created_at: z.string(),
});
