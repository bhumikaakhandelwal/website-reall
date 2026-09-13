// Database types for DBCE Coders Club
// These types represent the core entities in the database

export type MembershipStatus = 'pending' | 'active' | 'inactive';

// Level type matches the authoritative levels table
export interface Level {
  id: number; // 1-7
  title: string;
  xp_required: number; // XP threshold for this level
  sort_order: number;
}

// XP Ledger entry — represents an audit trail row
// Members can read their own entries via RLS but cannot insert/update/delete
export interface XPLedgerEntry {
  id: number;
  user_id: string;
  xp_amount: number; // Can be positive (earning) or negative (penalty)
  reason: string | null;
  created_at: string;
}

// Member profile — extends Supabase auth.users
// For foundation phase, only basic identity and membership status are needed
export interface MemberProfile {
  id: string; // UUID from auth.users
  email: string;
  display_name: string;
  membership_status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

// Re-export Zod schemas for validation
export {
  membershipStatusSchema,
  levelSchema,
  xpLedgerEntrySchema,
} from './schema';