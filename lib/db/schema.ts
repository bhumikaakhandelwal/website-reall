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