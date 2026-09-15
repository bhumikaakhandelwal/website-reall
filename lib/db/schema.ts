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