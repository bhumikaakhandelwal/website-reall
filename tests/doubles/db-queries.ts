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
  /** Phase 8E: null while the member is active. */
  archivedAt?: string | null;
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
  /** Phase 8A: null while the event is active. */
  archivedAt: string | null;
  archivedBy: string | null;
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

/**
 * Mirrors `EventAttendanceTotal` from `@/lib/db/queries` - the camelCase shape
 * the real `lib/db/queries.ts` maps the get_event_attendance_totals function's
 * snake_case columns onto. Only events WITH attendance appear.
 */
export type DoubledAttendanceTotal = {
  eventId: string;
  attendanceCount: number;
  xpAwarded: number;
};

/**
 * Mirrors `XpLedgerFullRow` from `@/lib/db/queries` - one full ledger row, with
 * no member name and no event, which the route joins in application code.
 */
export type DoubledLedgerRow = {
  entryId: number;
  memberId: string;
  xpAmount: number;
  activityCode: string | null;
  reason: string | null;
  createdAt: string;
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
  /** Phase 8A: every event edit the route attempted, in order. */
  updateEventCalls: [] as {
    id: string;
    update: {
      title: string;
      eventType: string;
      eventDate: string;
      activityCode: string;
    };
  }[],
  /** What the edit should answer next - false means the guard matched no row. */
  updateEventResult: true,
  /** Every archive the route attempted, in order. */
  archiveEventCalls: [] as { id: string; archivedBy: string | null }[],
  /** What the archive should answer next. */
  archiveEventResult: true,
  /** Every delete the route attempted, in order. */
  deleteEventCalls: [] as string[],
  /** What the delete should answer next. */
  deleteEventResult: { ok: true } as
    | { ok: true }
    | { ok: false; outcome: 'has_attendance'; attendanceCount: number }
    | { ok: false; outcome: 'not_found' }
    | { ok: false; outcome: 'failed' },
  /**
   * Phase 8B: the per-event attendance totals the analytics read should return.
   * Only events WITH attendance belong here, mirroring the function's inner
   * join.
   */
  attendanceTotals: [] as DoubledAttendanceTotal[],
  /** Every attendance-totals read the route performed. */
  attendanceTotalsCalls: 0,
  /** When true, the attendance-totals read simulates a database failure. */
  attendanceTotalsFail: false,
  /**
   * Phase 8C: every ledger row the explorer read should return, in the order
   * the database would have ordered them - newest first.
   */
  ledgerEntries: [] as DoubledLedgerRow[],
  /** Every ledger read the route performed. */
  ledgerEntriesCalls: 0,
  /** When true, the ledger read simulates a database failure. */
  ledgerEntriesFail: false,
  /** The ledger-to-event links the explorer read should return. */
  ledgerLinks: [] as { xpLedgerId: number; eventId: string }[],
  /** Every link read the route performed. */
  ledgerLinksCalls: 0,
  /** When true, the link read simulates a database failure. */
  ledgerLinksFail: false,
  /** Every auth_user_id write the activation flow attempted. */
  authUserWrites: [] as { memberId: string; authUserId: string }[],
  /** What the auth_user_id write should answer next. */
  authUserWriteResult: true,
  /** Every member the add flow tried to create. */
  memberWrites: [] as {
    displayName: string;
    email: string;
    membershipStatus: string;
    membershipStart: string;
  }[],
  /** What the member insert should answer next. */
  memberWriteResult: { ok: true, memberId: '77777777-7777-4777-8777-777777777777' } as
    | { ok: true; memberId: string }
    | { ok: false; duplicate: boolean },
  /** Phase 8E: every archive/restore the routes attempted. */
  archiveCalls: [] as { memberId: string; archivedBy: string }[],
  restoreCalls: [] as string[],
  /** What the archive/restore statement should answer next. */
  lifecycleResult: { ok: true, member: null } as unknown,

  /** Phase 9: the challenge catalogue and the submissions. */
  challengeRows: [] as Record<string, unknown>[],
  submissionRows: [] as Record<string, unknown>[],
  challengeCalls: [] as string[],
  /** What the submission insert should answer next. */
  submissionWriteResult: { ok: true, submissionId: '99999999-9999-4999-8999-999999999999' } as unknown,
  /** What the approve/reject RPC should answer next. */
  reviewResult: { data: [{ ledger_id: 42 }], error: null } as unknown,
  reviewCalls: [] as { fnName: string; args: unknown }[],

  /** Phase 9: writes the challenge routes attempted. */
  challengeSubmissionWrites: [] as Record<string, unknown>[],
  challengeWrites: [] as Record<string, unknown>[],
  challengeUpdates: [] as { challengeId: string; entry: Record<string, unknown> }[],
  challengeArchives: [] as { challengeId: string; archivedBy: string }[],
  challengeWriteResult: { ok: true, challengeId: '88888888-8888-4888-8888-888888888888' } as unknown,
  challengeUpdateResult: true,
  challengeArchiveResult: true,

  /** Every status change the manager actions attempted. */
  statusWrites: [] as { memberId: string; status: string }[],
  /** What the status change should answer next. */
  statusWriteResult: true,
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
  dbState.updateEventCalls = [];
  dbState.updateEventResult = true;
  dbState.archiveEventCalls = [];
  dbState.archiveEventResult = true;
  dbState.deleteEventCalls = [];
  dbState.deleteEventResult = { ok: true };
  dbState.attendanceTotals = [];
  dbState.attendanceTotalsCalls = 0;
  dbState.attendanceTotalsFail = false;
  dbState.ledgerEntries = [];
  dbState.ledgerEntriesCalls = 0;
  dbState.ledgerEntriesFail = false;
  dbState.ledgerLinks = [];
  dbState.ledgerLinksCalls = 0;
  dbState.ledgerLinksFail = false;
  dbState.authUserWrites = [];
  dbState.authUserWriteResult = true;
  dbState.memberWrites = [];
  dbState.memberWriteResult = { ok: true, memberId: '77777777-7777-4777-8777-777777777777' };
  dbState.statusWrites = [];
  dbState.statusWriteResult = true;
  dbState.challengeSubmissionWrites = [];
  dbState.challengeWrites = [];
  dbState.challengeUpdates = [];
  dbState.challengeArchives = [];
  dbState.challengeWriteResult = { ok: true, challengeId: '88888888-8888-4888-8888-888888888888' };
  dbState.challengeUpdateResult = true;
  dbState.challengeArchiveResult = true;
  dbState.challengeRows = [];
  dbState.submissionRows = [];
  dbState.challengeCalls = [];
  dbState.submissionWriteResult = { ok: true, submissionId: '99999999-9999-4999-8999-999999999999' };
  dbState.reviewResult = { data: [{ ledger_id: 42 }], error: null };
  dbState.reviewCalls = [];
  dbState.archiveCalls = [];
  dbState.restoreCalls = [];
  dbState.lifecycleResult = { ok: true, member: null };
  resetActivationState();
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

export async function updateEvent(
  id: string,
  update: {
    title: string;
    eventType: string;
    eventDate: string;
    activityCode: string;
  }
) {
  dbState.updateEventCalls.push({ id, update });

  return dbState.updateEventResult;
}

export async function archiveEvent(id: string, archivedBy: string | null) {
  dbState.archiveEventCalls.push({ id, archivedBy });

  return dbState.archiveEventResult;
}

export async function deleteEvent(id: string) {
  dbState.deleteEventCalls.push(id);

  return dbState.deleteEventResult;
}

export async function getEventAttendanceTotals(): Promise<
  DoubledAttendanceTotal[] | null
> {
  dbState.attendanceTotalsCalls += 1;

  if (dbState.attendanceTotalsFail) return null;

  return dbState.attendanceTotals;
}

export async function getXpLedgerEntries(): Promise<DoubledLedgerRow[] | null> {
  dbState.ledgerEntriesCalls += 1;

  if (dbState.ledgerEntriesFail) return null;

  return dbState.ledgerEntries;
}

export async function getXpLedgerEventLinks(): Promise<
  { xpLedgerId: number; eventId: string }[] | null
> {
  dbState.ledgerLinksCalls += 1;

  if (dbState.ledgerLinksFail) return null;

  return dbState.ledgerLinks;
}

// ---------------------------------------------------------------------------
// Phase 8D: the auth / onboarding surface
// ---------------------------------------------------------------------------

/** What `getMemberActivation` should answer for the next lookup. */
export const activationState = {
  result: null as {
    memberId: string;
    membershipStatus: 'pending' | 'active' | 'inactive';
    hasAuthAccount: boolean;
  } | null,
  emails: [] as string[],
};

export function resetActivationState() {
  activationState.result = null;
  activationState.emails = [];
}

export async function getMemberActivation(email: string) {
  activationState.emails.push(email);

  return activationState.result;
}

export async function setMemberAuthUser(memberId: string, authUserId: string) {
  dbState.authUserWrites.push({ memberId, authUserId });

  return dbState.authUserWriteResult;
}

export async function createMember(entry: {
  displayName: string;
  email: string;
  membershipStatus: string;
  membershipStart: string;
}) {
  dbState.memberWrites.push(entry);

  return dbState.memberWriteResult;
}

export async function setMemberStatus(memberId: string, status: string) {
  dbState.statusWrites.push({ memberId, status });

  return dbState.statusWriteResult;
}

// ---------------------------------------------------------------------------
// Phase 8E: the member lifecycle
// ---------------------------------------------------------------------------

/** A directory row's archive state defaults to active. */
function archivedAtOf(row: DoubledDirectoryRow): string | null {
  return row.archivedAt ?? null;
}

export async function getActiveMembers() {
  const rows = await getMemberDirectory();

  return rows === null ? null : rows.filter((row) => archivedAtOf(row) === null);
}

export async function getArchivedMembers() {
  const rows = await getMemberDirectory();

  return rows === null ? null : rows.filter((row) => archivedAtOf(row) !== null);
}

export async function getMemberArchiveState(memberId: string) {
  const rows = await getMemberDirectory();

  if (!rows) return null;

  const row = rows.find((candidate) => candidate.memberId === memberId);

  return row ? { memberId: row.memberId, archivedAt: archivedAtOf(row) } : null;
}

export async function archiveMember(memberId: string, archivedBy: string) {
  dbState.archiveCalls.push({ memberId, archivedBy });

  return dbState.lifecycleResult;
}

export async function restoreMember(memberId: string) {
  dbState.restoreCalls.push(memberId);

  return dbState.lifecycleResult;
}

// ---------------------------------------------------------------------------
// Phase 9: challenges
// ---------------------------------------------------------------------------

// The challenge doubles return the MAPPED (camelCase) shape, not raw rows:
// every other double in this suite does the same, because the real
// lib/db/queries.ts maps snake_case columns onto camelCase records. A double
// that returned raw rows would give the routes `undefined` for every field -
// which is exactly the trap this comment exists to prevent.
export async function getChallenges() {
  dbState.challengeCalls.push('getChallenges');

  return dbState.challengeRows.filter((row) => row.archivedAt === null);
}

export async function getAllChallenges() {
  dbState.challengeCalls.push('getAllChallenges');

  return dbState.challengeRows;
}

export async function getChallengeBySlug(slug: string) {
  dbState.challengeCalls.push(`getChallengeBySlug:${slug}`);

  return dbState.challengeRows.find((row) => row.slug === slug) ?? null;
}

export async function getMemberSubmissions(memberId: string) {
  dbState.challengeCalls.push('getMemberSubmissions');

  return dbState.submissionRows.filter((row) => row.memberId === memberId);
}

export async function getChallengeSubmissions() {
  dbState.challengeCalls.push('getChallengeSubmissions');

  return dbState.submissionRows;
}

export async function createChallengeSubmission(entry: {
  challengeId: string;
  memberId: string;
  githubUrl: string | null;
  submissionText: string | null;
}) {
  dbState.challengeCalls.push('createChallengeSubmission');
  dbState.challengeSubmissionWrites.push(entry);

  return dbState.submissionWriteResult;
}

export async function approveChallengeSubmission(
  submissionId: string,
  reviewedBy: string,
  reason: string
) {
  dbState.reviewCalls.push({
    fnName: 'approve_challenge_submission',
    args: { submissionId, reviewedBy, reason },
  });

  const result = dbState.reviewResult as { data?: unknown; error?: unknown } | null;

  if (!result || result.error) return { ok: false, outcome: 'failed' };

  if (!Array.isArray(result.data)) return { ok: false, outcome: 'failed' };

  if (result.data.length === 0) return { ok: false, outcome: 'already_reviewed' };

  const row = result.data[0] as Record<string, unknown>;

  return { ok: true, ledgerId: typeof row.ledger_id === 'number' ? row.ledger_id : null };
}

export async function rejectChallengeSubmission(
  submissionId: string,
  reviewedBy: string,
  feedback: string | null
) {
  dbState.reviewCalls.push({
    fnName: 'reject_challenge_submission',
    args: { submissionId, reviewedBy, feedback },
  });

  const result = dbState.reviewResult as { data?: unknown; error?: unknown } | null;

  if (!result || result.error) return { ok: false, outcome: 'failed' };

  if (!Array.isArray(result.data)) return { ok: false, outcome: 'failed' };

  if (result.data.length === 0) return { ok: false, outcome: 'already_reviewed' };

  return { ok: true, ledgerId: null };
}

export async function createChallenge(entry: Record<string, unknown>) {
  dbState.challengeCalls.push('createChallenge');
  dbState.challengeWrites.push(entry);

  return dbState.challengeWriteResult;
}

export async function updateChallenge(challengeId: string, entry: Record<string, unknown>) {
  dbState.challengeCalls.push('updateChallenge');
  dbState.challengeUpdates.push({ challengeId, entry });

  return dbState.challengeUpdateResult;
}

export async function archiveChallenge(challengeId: string, archivedBy: string) {
  dbState.challengeCalls.push('archiveChallenge');
  dbState.challengeArchives.push({ challengeId, archivedBy });

  return dbState.challengeArchiveResult;
}
