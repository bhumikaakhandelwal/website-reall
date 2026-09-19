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

/**
 * Mirrors `MemberDirectoryRow` from `@/lib/db/queries` - the camelCase shape
 * the real `lib/db/queries.ts` maps the database's snake_case rows onto. The
 * route consumes this shape, so the double must match it.
 */
export type DoubledDirectoryRow = {
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
  joinedAt: string;
  totalXp: number;
};

/**
 * Mirrors `RecentXpEntryRow` from `@/lib/db/queries` - the camelCase shape the
 * real `lib/db/queries.ts` maps the database's snake_case rows onto. The route
 * consumes this shape, so the double must match it.
 */
export type DoubledRecentEntry = {
  entryId: number;
  memberId: string;
  displayName: string;
  xpAmount: number;
  activityCode: string | null;
  reason: string | null;
  createdAt: string;
};

/**
 * Mirrors `EventRow` from `@/lib/db/queries` - the camelCase shape the real
 * `lib/db/queries.ts` maps the `events` table's snake_case columns onto. The
 * route consumes this shape, so the double must match it.
 */
export type DoubledEventRow = {
  id: string;
  title: string;
  eventType: 'workshop' | 'technical-session' | 'coding-contest' | 'hackathon' | 'meeting' | 'other';
  eventDate: string;
  activityCode: string;
  createdBy: string | null;
  createdAt: string;
};

/**
 * Mirrors `AttendanceRow` from `@/lib/db/queries` - the camelCase shape the
 * real `lib/db/queries.ts` maps the `attendance` table's snake_case columns
 * onto. `xpLedgerId` is null for an attendee who has not been awarded yet.
 */
export type DoubledAttendanceRow = {
  id: string;
  eventId: string;
  memberId: string;
  recordedAt: string;
  xpLedgerId: number | null;
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
  /**
   * Phase 5A: the rows the directory read should return. An empty array is a
   * genuine empty roster; `directoryFails` is the error path.
   */
  directoryRows: [] as DoubledDirectoryRow[],
  /** Every directory read the route performed. */
  directoryCalls: 0,
  /** When true, the directory read simulates a database failure. */
  directoryFails: false,
  /**
   * Phase 5C: the net XP the month total should report. null simulates a failed
   * read; 0 is a genuine empty month, which is why the two are distinct.
   */
  monthXp: 0 as number | null,
  /** Every window the route asked the month total for. */
  monthXpCalls: [] as { start: Date; end: Date }[],
  /** When true, the month total read simulates a database failure. */
  monthXpFails: false,
  /**
   * Phase 5C: the rows the recent-entries read should return, newest first -
   * the double preserves the order it is given, like the database does.
   */
  recentEntries: [] as DoubledRecentEntry[],
  /** Every limit the route passed to the recent-entries read. */
  recentEntryLimits: [] as number[],
  /** When true, the recent-entries read simulates a database failure. */
  recentEntriesFail: false,
  /**
   * Phase 7A: the rows the event list read should return, in the order the
   * database would have ordered them - the double preserves what it is given,
   * like every other read here.
   */
  eventRows: [] as DoubledEventRow[],
  /** Every event list read the route performed. */
  eventListCalls: 0,
  /** When true, the event list read simulates a database failure. */
  eventsFail: false,
  /** Every event the route tried to create, in order. */
  eventWrites: [] as {
    title: string;
    eventType: string;
    eventDate: string;
    activityCode: string;
    createdBy: string | null;
  }[],
  /** What the event write should answer next. */
  eventWriteResult: { ok: true, id: '00000000-0000-4000-8000-000000000000' } as
    | { ok: true; id: string }
    | { ok: false },
  /**
   * Phase 7B: the event `getEventById` should answer, or null for "no such
   * event". Kept separate from `eventRows` because the attendance page reads
   * one event by id while the register reads them all.
   */
  eventById: null as DoubledEventRow | null,
  /** Every event id the route asked a single event for. */
  eventByIdLookups: [] as string[],
  /** The attendance rows the attendance read should return. */
  attendanceRows: [] as DoubledAttendanceRow[],
  /** Every event id the attendance read was asked for. */
  attendanceReads: [] as string[],
  /** When true, the attendance read simulates a database failure. */
  attendanceFails: false,
  /** Every attendance save the route attempted, in order. */
  setAttendanceCalls: [] as { eventId: string; memberIds: string[] }[],
  /** What the attendance save should answer next. */
  setAttendanceResult: { ok: true, added: 0, removed: 0, keptAwarded: 0 } as
    | { ok: true; added: number; removed: number; keptAwarded: number }
    | { ok: false },
  /** Every award the route attempted, in order. */
  awardCalls: [] as { eventId: string; xpAmount: number }[],
  /** What the award should answer next. */
  awardResult: { ok: true, awarded: 0 } as { ok: true; awarded: number } | { ok: false },
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
  dbState.directoryRows = [];
  dbState.directoryCalls = 0;
  dbState.directoryFails = false;
  dbState.monthXp = 0;
  dbState.monthXpCalls = [];
  dbState.monthXpFails = false;
  dbState.recentEntries = [];
  dbState.recentEntryLimits = [];
  dbState.recentEntriesFail = false;
  dbState.eventRows = [];
  dbState.eventListCalls = 0;
  dbState.eventsFail = false;
  dbState.eventWrites = [];
  dbState.eventWriteResult = { ok: true, id: '00000000-0000-4000-8000-000000000000' };
  dbState.eventById = null;
  dbState.eventByIdLookups = [];
  dbState.attendanceRows = [];
  dbState.attendanceReads = [];
  dbState.attendanceFails = false;
  dbState.setAttendanceCalls = [];
  dbState.setAttendanceResult = { ok: true, added: 0, removed: 0, keptAwarded: 0 };
  dbState.awardCalls = [];
  dbState.awardResult = { ok: true, awarded: 0 };
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

export async function getMemberDirectory(): Promise<DoubledDirectoryRow[] | null> {
  dbState.directoryCalls += 1;

  if (dbState.directoryFails) return null;

  return dbState.directoryRows;
}

export async function getMonthXpTotal(period: {
  start: Date;
  end: Date;
}): Promise<number | null> {
  dbState.monthXpCalls.push(period);

  if (dbState.monthXpFails) return null;

  return dbState.monthXp;
}

export async function getRecentXpEntries(
  limit: number
): Promise<DoubledRecentEntry[] | null> {
  dbState.recentEntryLimits.push(limit);

  if (dbState.recentEntriesFail) return null;

  return dbState.recentEntries;
}

export async function getEvents(): Promise<DoubledEventRow[] | null> {
  dbState.eventListCalls += 1;

  if (dbState.eventsFail) return null;

  return dbState.eventRows;
}

export async function createEvent(entry: {
  title: string;
  eventType: string;
  eventDate: string;
  activityCode: string;
  createdBy: string | null;
}) {
  dbState.eventWrites.push(entry);

  return dbState.eventWriteResult;
}

export async function getEventById(id: string): Promise<DoubledEventRow | null> {
  dbState.eventByIdLookups.push(id);

  return dbState.eventById;
}

export async function getEventAttendance(
  eventId: string
): Promise<DoubledAttendanceRow[] | null> {
  dbState.attendanceReads.push(eventId);

  if (dbState.attendanceFails) return null;

  return dbState.attendanceRows;
}

export async function setEventAttendance(
  eventId: string,
  memberIds: readonly string[]
) {
  dbState.setAttendanceCalls.push({ eventId, memberIds: [...memberIds] });

  return dbState.setAttendanceResult;
}

export async function awardEventAttendance(eventId: string, xpAmount: number) {
  dbState.awardCalls.push({ eventId, xpAmount });

  return dbState.awardResult;
}
