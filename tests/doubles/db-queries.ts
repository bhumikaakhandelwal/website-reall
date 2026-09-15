// Test double for `@/lib/db/queries` — the only module the XP routes use to
// reach Supabase. Holds mutable state that a test sets up and inspects.

export type XpLedgerWrite = {
  memberId: string;
  xpAmount: number;
  activityCode: string | null;
  reason: string;
};

export type XpLedgerWriteResult =
  | { ok: true }
  | { ok: false; memberNotFound: boolean };

export type DoubledProfile = {
  id: string;
  email: string;
  display_name: string;
  membership_status: 'pending' | 'active' | 'inactive';
  created_at: string;
  updated_at: string;
};

export type DoubledLevel = {
  id: number;
  title: string;
  xp_required: number;
  sort_order: number;
};

export const dbState = {
  /** The member the session resolves to, or null when there is none. */
  profile: null as DoubledProfile | null,
  /** null simulates a failed ledger read (a real error, not a zero total). */
  totalXp: null as number | null,
  levels: [] as DoubledLevel[],
  /** Every ledger write the route attempted, in order. */
  writes: [] as XpLedgerWrite[],
  /** What the privileged write should answer next. */
  writeResult: { ok: true } as XpLedgerWriteResult,
  /** Every member id the route asked a profile for. */
  profileLookups: [] as string[],
};

export function resetDbState() {
  dbState.profile = null;
  dbState.totalXp = null;
  dbState.levels = [];
  dbState.writes = [];
  dbState.writeResult = { ok: true };
  dbState.profileLookups = [];
}

export async function getMemberProfile(memberId: string) {
  dbState.profileLookups.push(memberId);

  if (!dbState.profile) return null;

  return { success: true as const, data: dbState.profile };
}

export async function getMemberXP() {
  return dbState.totalXp;
}

export async function getAllLevels() {
  return dbState.levels;
}

export async function createXpLedgerEntry(entry: XpLedgerWrite) {
  dbState.writes.push(entry);
  return dbState.writeResult;
}
