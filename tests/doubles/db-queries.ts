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

/**
 * Mirrors `LeaderboardRow` from `@/lib/xp/leaderboards` - the camelCase shape
 * the real `lib/db/queries.ts` maps the database's snake_case rows onto. The
 * route consumes this shape, so the double must match it.
 */
export type DoubledLeaderboardRow = {
  memberId: string;
  displayName: string;
  xp: number;
};

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
  /**
   * Phase 4: rows the leaderboard aggregation should return, keyed by the
   * board's activity-code list (`'null'` string key for the overall board,
   * which passes `null`). A test that wants a populated board seeds here and
   * asserts on the ranked API payload.
   */
  leaderboardRows: new Map<string, DoubledLeaderboardRow[]>(),
  /** Every (period, activityCodes) pair the route asked the leaderboard for. */
  leaderboardCalls: [] as {
    period: { start: Date; end: Date };
    activityCodes: readonly string[] | null;
  }[],
  /** When true, every leaderboard read simulates a database failure. */
  leaderboardFails: false,
};

export function resetDbState() {
  dbState.profile = null;
  dbState.totalXp = null;
  dbState.levels = [];
  dbState.writes = [];
  dbState.writeResult = { ok: true };
  dbState.profileLookups = [];
  dbState.leaderboardRows = new Map();
  dbState.leaderboardCalls = [];
  dbState.leaderboardFails = false;
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

export async function getMonthlyLeaderboard(
  period: { start: Date; end: Date },
  activityCodes: readonly string[] | null
): Promise<DoubledLeaderboardRow[] | null> {
  dbState.leaderboardCalls.push({ period, activityCodes });

  if (dbState.leaderboardFails) return null;

  // Keyed by the board's activity-code list, which is unique per Handbook
  // board: null is the overall board, and each restricted board has its own
  // code list. `[...]`-joined so the key is a comparable string.
  const key = activityCodes === null ? 'null' : [...activityCodes].join(',');

  return dbState.leaderboardRows.get(key) ?? [];
}

export async function createXpLedgerEntry(entry: XpLedgerWrite) {
  dbState.writes.push(entry);
  return dbState.writeResult;
}
