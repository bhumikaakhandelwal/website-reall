import { randomUUID } from 'node:crypto';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  memberSchema,
  levelSchema,
  leaderboardRowSchema,
  memberDirectoryRowSchema,
  recentXpEntryRowSchema,
  eventRowSchema,
  attendanceRowSchema,
  eventAttendanceTotalRowSchema,
  xpLedgerFullRowSchema,
  xpLedgerEventLinkRowSchema,
  memberArchiveRowSchema,
  challengeRowSchema,
  challengeSubmissionRowSchema,
} from './schema';
import { activeMembers, archivedMembers } from '@/lib/members/lifecycle';
import type { LevelDefinition } from '@/lib/xp/levels';
import type { LeaderboardRow } from '@/lib/xp/leaderboards';

/**
 * One row of the member directory, as read from the database - the camelCase
 * shape `getMemberDirectory` maps the function's snake_case columns onto. The
 * level is deliberately absent: the route derives it from `totalXp`.
 */
export type MemberDirectoryRow = {
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
  joinedAt: string;
  totalXp: number;
  /** Phase 8E: null while the member is active. */
  archivedAt: string | null;
};

/**
 * Phase 8E: a member as the archive/restore statements return them.
 *
 * Not the directory shape, because an UPDATE returns the `members` columns and
 * cannot compute `totalXp`. The route reads the directory when it needs the
 * totals; this is what the write itself can honestly give back.
 */
export type MemberArchiveRecord = {
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
  archivedAt: string | null;
  archivedBy: string | null;
};

export type MemberArchiveResult =
  | { ok: true; member: MemberArchiveRecord }
  // The guard matched no row: the member was already archived (or already
  // active, for a restore), or no such member exists. The caller tells those
  // apart with a lookup, which is why it is one outcome rather than three.
  | { ok: false; outcome: 'no_change' | 'failed' };

/**
 * Phase 5C: one row of the recent-ledger list, as read from the database - the
 * camelCase shape `getRecentXpEntries` maps the function's snake_case columns
 * onto. `reason` and `activityCode` are genuinely nullable (a corrective entry
 * has no activity code), so the dashboard must render a fallback for both.
 */
export type RecentXpEntryRow = {
  entryId: number;
  memberId: string;
  displayName: string;
  xpAmount: number;
  activityCode: string | null;
  reason: string | null;
  createdAt: string;
};

/**
 * Phase 7A: one row of `events`, as read from the database - the camelCase
 * shape `getEvents` maps the table's snake_case columns onto. The XP amount is
 * deliberately absent: an event names a Handbook activity code, and the amount
 * is resolved from lib/xp/activities.ts at award time.
 */
export type EventRow = {
  id: string;
  title: string;
  eventType: 'workshop' | 'technical-session' | 'coding-contest' | 'hackathon' | 'meeting' | 'other';
  /** 'YYYY-MM-DD'. A DATE, not an instant - see lib/db/schema.ts. */
  eventDate: string;
  activityCode: string;
  /** The manager who created it, or null if their member row was removed. */
  createdBy: string | null;
  createdAt: string;
  /** Null while the event is active. An archived event is read-only. */
  archivedAt: string | null;
  /** The manager who archived it, or null. */
  archivedBy: string | null;
};

/**
 * Phase 7B: one row of `attendance`, as read from the database - the camelCase
 * shape `getEventAttendance` maps the table's snake_case columns onto.
 *
 * `xpLedgerId` is null for an attendee who has not been awarded yet, which is
 * the distinction the whole award is built on.
 */
export type AttendanceRow = {
  id: string;
  eventId: string;
  memberId: string;
  recordedAt: string;
  xpLedgerId: number | null;
};

/**
 * Phase 8B: one event's attendance totals, as read from the database - the
 * camelCase shape `getEventAttendanceTotals` maps the function's snake_case
 * columns onto.
 *
 * Only events with at least one attendance record appear. An absent row means
 * zero, which is why the analytics page joins these onto the event list rather
 * than treating them as the list.
 */
export type EventAttendanceTotal = {
  eventId: string;
  attendanceCount: number;
  xpAwarded: number;
};

// The columns every event read selects, and the mapper they both use. Shared
// rather than repeated because two reads of the same table that disagree about
// which columns they want is exactly how a field goes silently missing from one
// page and not another.
const EVENT_COLUMNS =
  'id, title, event_type, event_date, activity_code, created_by, created_at, archived_at, archived_by';

/** Maps one validated `events` row onto the camelCase shape the API returns. */
function toEventRow(row: {
  id: string;
  title: string;
  event_type: EventRow['eventType'];
  event_date: string;
  activity_code: string;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
  archived_by: string | null;
}): EventRow {
  return {
    id: row.id,
    title: row.title,
    eventType: row.event_type,
    eventDate: row.event_date,
    activityCode: row.activity_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

export async function getMemberById(id: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('members')
    .select('id, email, display_name, membership_status, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error) return null;

  return memberSchema.safeParse(data);
}

export async function getMemberByEmail(email: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('members')
    .select('id, email, display_name, membership_status, created_at, updated_at')
    .eq('email', email)
    .single();

  if (error) return null;

  return memberSchema.safeParse(data);
}

// Phase 1C approved-email login.
// RLS on `members` only allows reading your own row through a Supabase Auth
// session, which this login model deliberately does not use. These two calls
// go through narrow SECURITY DEFINER functions instead — see
// supabase/migrations/20260914000001_member_login_lookup.sql
export async function lookupMemberIdByEmail(email: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc('lookup_member_id_by_email', {
    candidate_email: email,
  });

  if (error || !data) return null;

  return data as string;
}

export async function getMemberProfile(memberId: string) {
  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc('get_member_profile', {
    member_id: memberId,
  });

  if (error || !data || data.length === 0) return null;

  return memberSchema.safeParse(data[0]);
}

// Phase 3: level definitions are public reference data, but the Phase 1B RLS
// policy on `levels` only allows reads when auth.uid() IS NOT NULL, which never
// holds for the approved-email session. Read them through the narrow
// SECURITY DEFINER function instead - see
// supabase/migrations/20260915000001_xp_engine.sql
export async function getAllLevels(): Promise<LevelDefinition[] | null> {
  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc('get_all_levels');

  if (error || !data) return null;

  const rows = data as unknown[];
  const levels = rows.map((level) => levelSchema.safeParse(level));
  const validLevels = levels.filter((level) => level.success);

  return validLevels.map((level) => level.data) as LevelDefinition[];
}

// Phase 3: total XP is always summed from the ledger, never read from a stored
// column. Returns null on failure so callers can distinguish an error from a
// genuine zero.
//
// This read runs on the SERVER-ONLY service-role client, not the anon client.
// get_member_xp_total takes an arbitrary member id, so it is deliberately not
// executable by anon/authenticated (see the grants in
// supabase/migrations/20260915000001_xp_engine.sql): if any client role could
// call it, the publishable key would be enough to read another member's total.
// Keeping it here means the API is the only way to reach it, and the API always
// passes the id from the verified session.
export async function getMemberXP(memberId: string): Promise<number | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_member_xp_total', {
    member_id: memberId,
  });

  if (error || data === null) return null;

  return data as number;
}

// Phase 4: one leaderboard, aggregated in the database.
//
// Like getMemberXP this read runs on the SERVER-ONLY service-role client: the
// function returns other members' XP and is granted to service_role alone (see
// supabase/migrations/20260916000001_monthly_leaderboards.sql), so no client
// role can reach it and the only caller is the session-checked
// GET /api/leaderboard route.
//
// The window is the caller's half-open [start, end) range, and `activityCodes`
// selects the leaderboard: null counts every ledger entry (overall), otherwise
// only entries carrying one of those Handbook activity codes (hackathon,
// open-source). The rows come back already ordered deterministically, so this
// function never sorts and never loads ledger rows into memory.
//
// Returns null on failure, so the route can answer 500 rather than render an
// empty leaderboard that looks like "nobody earned anything".
export async function getMonthlyLeaderboard(
  period: { start: Date; end: Date },
  activityCodes: readonly string[] | null
): Promise<LeaderboardRow[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_monthly_leaderboard', {
    p_period_start: period.start.toISOString(),
    p_period_end: period.end.toISOString(),
    p_activity_codes: activityCodes === null ? null : [...activityCodes],
  });

  if (error || !data) return null;

  // `get_monthly_leaderboard` is declared `RETURNS TABLE (...)`, so PostgREST
  // answers with a bare JSON array of row objects and supabase-js resolves that
  // array directly as `data` - there is no wrapper object. (The Supabase CLI
  // prints a `{ rows: [...] }`-style envelope for the same function when run by
  // hand, which is NOT the supabase-js shape; see
  // tests/leaderboard-query-shape.test.mjs, which pins both.)
  //
  // Guard the shape explicitly: a non-array here means the database and this
  // layer disagree, which is an error to report (null), not an empty month.
  if (!Array.isArray(data)) return null;

  const entries: LeaderboardRow[] = [];

  for (const row of data as unknown[]) {
    const parsed = leaderboardRowSchema.safeParse(row);

    // A row that does not match the function's declared shape means the
    // database and this layer disagree - an error, not a row to skip.
    if (!parsed.success) return null;

    entries.push({
      memberId: parsed.data.member_id,
      displayName: parsed.data.display_name,
      xp: parsed.data.xp,
    });
  }

  return entries;
}

// Phase 5A: every member, for the manager-only directory page.
//
// Like getMemberXP and getMonthlyLeaderboard this read runs on the SERVER-ONLY
// service-role client: it returns every member's email and XP, and the
// function behind it is granted to service_role alone (see
// supabase/migrations/20260917000001_member_directory.sql), so no client role
// can reach it. The only caller is the session-checked, manager-gated
// GET /api/members route - which is what makes the service-role client
// acceptable here rather than a convenience (lib/supabase/admin.ts).
//
// No search parameter: the whole roster is a few dozen rows, and the page
// filters it in the browser. That keeps one query behind the page instead of
// one per keystroke.
//
// Returns null on failure, so the route can answer 500 rather than render an
// empty roster that looks like the club has no members.
export async function getMemberDirectory(): Promise<MemberDirectoryRow[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_member_directory');

  if (error || !data) return null;

  // `get_member_directory` is declared `RETURNS TABLE (...)`, so PostgREST
  // answers with a bare JSON array of row objects and supabase-js resolves that
  // array directly as `data` - there is no wrapper object. (The Supabase CLI
  // prints a `{ rows: [...] }`-style envelope for the same function when run by
  // hand, which is NOT the supabase-js shape; see
  // tests/member-directory-query-shape.test.mjs, which pins both.)
  //
  // Guard the shape explicitly: a non-array here means the database and this
  // layer disagree, which is an error to report (null), not an empty directory.
  if (!Array.isArray(data)) return null;

  const rows: MemberDirectoryRow[] = [];

  for (const row of data as unknown[]) {
    const parsed = memberDirectoryRowSchema.safeParse(row);

    // A row that does not match the function's declared shape means the
    // database and this layer disagree - an error, not a row to skip.
    if (!parsed.success) return null;

    rows.push({
      memberId: parsed.data.member_id,
      email: parsed.data.email,
      displayName: parsed.data.display_name,
      membershipStatus: parsed.data.membership_status,
      joinedAt: parsed.data.created_at,
      archivedAt: parsed.data.archived_at,
      totalXp: parsed.data.total_xp,
    });
  }

  return rows;
}

// Phase 5C: the net XP recorded in the ledger inside a half-open month window,
// for the manager dashboard's "XP Awarded This Month" card.
//
// Like the other privileged reads this runs on the SERVER-ONLY service-role
// client: the function returns club-wide XP and is granted to service_role
// alone (see supabase/migrations/20260918000001_manager_dashboard.sql), so the
// session- and manager-checked GET /api/manager/dashboard route is the only
// caller.
//
// The window is the caller's half-open [start, end), computed in UTC and passed
// as an explicit range, exactly like getMonthlyLeaderboard - the database does
// no month arithmetic, because `timestamptz + interval '1 month'` is evaluated
// in the session timezone and can land on the wrong instant across a DST
// boundary.
//
// This is deliberately NOT a sum over getMonthlyLeaderboard: that function
// answers "who is winning this month", so it keeps only active members and
// drops zero rows. A month in which a pending member earned XP would be
// under-reported by summing it. See the migration comment.
//
// Returns null on failure so the route can answer 500. A genuine empty month is
// 0, not null - the SQL COALESCEs the sum, and the `typeof` guard below keeps a
// non-numeric response (the database and this layer disagreeing) an error
// rather than a confident zero.
export async function getMonthXpTotal(period: {
  start: Date;
  end: Date;
}): Promise<number | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_month_xp_total', {
    p_period_start: period.start.toISOString(),
    p_period_end: period.end.toISOString(),
  });

  if (error || data === null || data === undefined) return null;

  // `get_month_xp_total` returns a scalar INTEGER, so supabase-js resolves the
  // number directly as `data` - there is no row wrapper and no `rows` envelope.
  // An integer check as well as a finite one: the column is INTEGER, so a
  // fractional value would mean the database and this layer disagree.
  if (typeof data !== 'number' || !Number.isInteger(data)) return null;

  return data;
}

// Phase 5C: the most recent ledger entries, newest first, for the manager
// dashboard's activity list.
//
// SERVER-ONLY for the same reason as every other read above: it exposes other
// members' XP and is granted to service_role alone (see the Phase 5C
// migration), so the session- and manager-checked API route is the only caller.
//
// The limit is applied by the database, not here: the ledger grows without
// bound and "the last N rows" is an index walk there, not a full read into
// application memory. The function also clamps the argument to 1..100, so an
// unexpected value cannot produce a silently empty list or an unbounded read.
//
// Returns null on failure - including when a row does not match the function's
// declared shape, which means the database and this layer disagree and is an
// error to report rather than a row to skip quietly.
export async function getRecentXpEntries(
  limit: number
): Promise<RecentXpEntryRow[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_recent_xp_entries', {
    p_limit: limit,
  });

  if (error || !data) return null;

  // `get_recent_xp_entries` is declared `RETURNS TABLE (...)`, so PostgREST
  // answers with a bare JSON array of row objects and supabase-js resolves that
  // array directly as `data` - there is no wrapper object. (The Supabase CLI
  // prints a `{ rows: [...] }`-style envelope for the same function when run by
  // hand, which is NOT the supabase-js shape; see
  // tests/manager-dashboard-query-shape.test.mjs, which pins both.)
  //
  // Guard the shape explicitly: a non-array here means the database and this
  // layer disagree, which is an error to report (null), not an empty history.
  if (!Array.isArray(data)) return null;

  const entries: RecentXpEntryRow[] = [];

  for (const row of data as unknown[]) {
    const parsed = recentXpEntryRowSchema.safeParse(row);

    if (!parsed.success) return null;

    entries.push({
      entryId: parsed.data.entry_id,
      memberId: parsed.data.member_id,
      displayName: parsed.data.display_name,
      xpAmount: parsed.data.xp_amount,
      activityCode: parsed.data.activity_code,
      reason: parsed.data.reason,
      createdAt: parsed.data.created_at,
    });
  }

  return entries;
}

export type XpLedgerWrite = {
  memberId: string;
  /** Signed amount. Negative for corrective adjustments. */
  xpAmount: number;
  /** Handbook activity code, or null for a corrective adjustment. */
  activityCode: string | null;
  reason: string;
};

export type XpLedgerWriteResult =
  | { ok: true }
  // A foreign-key violation means the target member id does not exist. That is
  // reported separately so the route can answer 404 instead of 500, without
  // needing a member-existence query the anon key could not run anyway.
  | { ok: false; memberNotFound: boolean };

// Phase 3: the ONLY privileged write in the application.
//
// RLS grants members no INSERT on xp_ledger (and the anon key used everywhere
// else cannot write to it), so recording XP requires the service-role client,
// which bypasses RLS. That makes the authorization check the caller's
// responsibility: every caller MUST have verified the signed session and
// confirmed the actor is an XP manager (lib/xp/managers.ts) before calling this.
export async function createXpLedgerEntry(
  entry: XpLedgerWrite
): Promise<XpLedgerWriteResult> {
  const supabase = createAdminClient();

  const { error } = await supabase.from('xp_ledger').insert({
    user_id: entry.memberId,
    xp_amount: entry.xpAmount,
    activity_code: entry.activityCode,
    reason: entry.reason,
  });

  if (error) {
    console.error('Error writing xp_ledger entry:', error);
    return { ok: false, memberNotFound: error.code === '23503' };
  }

  return { ok: true };
}

// Phase 7A: every club event, newest first, for the manager-only /events page.
//
// Runs on the SERVER-ONLY service-role client, like the xp_ledger write above
// and unlike the Phase 3-5 reads. Those go through narrow SECURITY DEFINER
// functions because they aggregate in SQL and because RLS denies the anon
// client; `events` needs neither - it is a plain table read, and the service-
// role client already bypasses RLS. What makes that acceptable is the caller:
// the only one is the session- and manager-checked GET /api/events route. The
// migration enables RLS on `events` with NO policy, so no browser-facing role
// can reach the table even holding the publishable key.
//
// No filtering, no pagination and no search parameter: a club runs a handful of
// events a term, so the whole list is a few dozen rows.
//
// Ordering is fully deterministic - event_date DESC, then created_at DESC - so
// two events on the same day never reshuffle between two identical requests.
// The database does the ordering, as everywhere else in this layer.
//
// Returns null on failure - including when a row does not match the table's
// declared shape, which means the database and this layer disagree and is an
// error to report rather than a row to skip quietly.
export async function getEvents(): Promise<EventRow[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error || !data) return null;

  // PostgREST answers a table select with a bare JSON array of row objects, and
  // supabase-js resolves that array directly as `data` - there is no wrapper
  // object. Guard it explicitly: a non-array means the database and this layer
  // disagree, which is an error to report (null), not an empty event list.
  if (!Array.isArray(data)) return null;

  const events: EventRow[] = [];

  for (const row of data as unknown[]) {
    const parsed = eventRowSchema.safeParse(row);

    if (!parsed.success) return null;

    events.push(toEventRow(parsed.data));
  }

  return events;
}

export type EventWrite = {
  title: string;
  eventType: EventRow['eventType'];
  /** 'YYYY-MM-DD'. */
  eventDate: string;
  /** A Handbook activity code from lib/xp/activities.ts. */
  activityCode: string;
  /** The creating manager's member id, or null when unknown. */
  createdBy: string | null;
};

export type EventWriteResult =
  | { ok: true; id: string }
  | { ok: false };

// Phase 7A: create one event.
//
// The id is generated HERE rather than by the column's DEFAULT gen_random_uuid()
// so the insert needs no RETURNING round-trip and the caller learns the id
// without a second query. The database default stays in place as a safety net
// for any other insert path.
//
// The service-role client is required for the same reason as the xp_ledger
// write: RLS grants no role an INSERT on `events`. Authorization is therefore
// the caller's responsibility - every caller MUST have verified the signed
// session and confirmed the actor is an XP manager (lib/xp/managers.ts).
//
// This writes an EVENT only. It writes no XP and touches no ledger: awarding
// attendance is Phase 7B and is deliberately not implemented here.
export async function createEvent(entry: EventWrite): Promise<EventWriteResult> {
  const supabase = createAdminClient();

  const id = randomUUID();

  const { error } = await supabase.from('events').insert({
    id,
    title: entry.title,
    event_type: entry.eventType,
    event_date: entry.eventDate,
    activity_code: entry.activityCode,
    created_by: entry.createdBy,
  });

  if (error) {
    console.error('Error writing events row:', error);
    return { ok: false };
  }

  return { ok: true, id };
}

// Phase 7B: one event by id, for the attendance page.
//
// SERVER-ONLY, like every other read and write here: `events` has RLS enabled
// with no policy, so the service-role client is the only way in, and the only
// caller is the session- and manager-checked attendance route.
//
// Returns null both when the event does not exist AND when the read failed, so
// the route answers 404 for an unknown id and 500 for a failure. The two are
// told apart by the route's own existence check rather than here - see
// app/api/events/[id]/attendance/route.ts, which treats null as "not found"
// only after a successful list read has ruled out a failure.
export async function getEventById(id: string): Promise<EventRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const parsed = eventRowSchema.safeParse(data);

  if (!parsed.success) return null;

  return toEventRow(parsed.data);
}

// Phase 7B: every attendance row for one event.
//
// The whole set is read at once rather than per member: an event has a few
// dozen attendees and the page needs all of them to render the checkbox list.
//
// Ordered by member id so the result is stable between two identical requests -
// the page re-sorts for display, but nothing downstream should have to cope with
// a reshuffling array.
//
// Returns null on failure, including when a row does not match the declared
// shape, so the route can answer 500 rather than render an event as empty.
export async function getEventAttendance(
  eventId: string
): Promise<AttendanceRow[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('attendance')
    .select('id, event_id, member_id, recorded_at, xp_ledger_id')
    .eq('event_id', eventId)
    .order('member_id', { ascending: true });

  if (error || !data) return null;

  if (!Array.isArray(data)) return null;

  const rows: AttendanceRow[] = [];

  for (const row of data as unknown[]) {
    const parsed = attendanceRowSchema.safeParse(row);

    if (!parsed.success) return null;

    rows.push({
      id: parsed.data.id,
      eventId: parsed.data.event_id,
      memberId: parsed.data.member_id,
      recordedAt: parsed.data.recorded_at,
      xpLedgerId: parsed.data.xp_ledger_id,
    });
  }

  return rows;
}

export type SetAttendanceResult =
  | { ok: true; added: number; removed: number; keptAwarded: number }
  | { ok: false };

// Phase 7B: save one event's attendance.
//
// One RPC rather than a sequence of client calls, because the operation is an
// insert of the newly-checked members AND a delete of the unchecked ones. Split
// across two round trips a failure between them would leave the event
// half-saved; inside the function they commit together.
//
// The duplicate protection is the database's: the function inserts with
// ON CONFLICT DO NOTHING against the UNIQUE (event_id, member_id) constraint
// Phase 7A added, so saving the same set twice adds nothing. It also refuses to
// delete a row that has been awarded - see the migration.
//
// Authorization is the caller's responsibility: the function is granted to
// service_role alone, so every caller MUST have verified the signed session and
// confirmed the actor is an XP manager (lib/xp/managers.ts).
export async function setEventAttendance(
  eventId: string,
  memberIds: readonly string[]
): Promise<SetAttendanceResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('set_event_attendance', {
    p_event_id: eventId,
    p_member_ids: [...memberIds],
  });

  if (error || !data) return { ok: false };

  // The function RETURNS TABLE (...), so PostgREST answers with a bare array of
  // row objects and supabase-js resolves that array directly as `data` - there
  // is no wrapper object, and the function always returns exactly one row.
  if (!Array.isArray(data) || data.length !== 1) return { ok: false };

  const row = data[0] as Record<string, unknown>;

  const counts = [row.added, row.removed, row.kept_awarded];

  if (counts.some((value) => typeof value !== 'number' || !Number.isInteger(value))) {
    return { ok: false };
  }

  return {
    ok: true,
    added: row.added as number,
    removed: row.removed as number,
    keptAwarded: row.kept_awarded as number,
  };
}

export type AwardAttendanceResult =
  | { ok: true; awarded: number }
  | { ok: false };

// Phase 7B: award every unawarded attendee of one event, once each.
//
// Idempotent by construction - the function awards only rows whose
// attendance.xp_ledger_id IS NULL, and links each new ledger entry in the same
// transaction - so a second call awards nobody. It also row-locks the
// unawarded rows, so two managers awarding at the same moment cannot
// double-award. See the migration for both.
//
// `xpAmount` is resolved by the caller from the EVENT's activity code via
// lib/xp/activities.ts, which stays the single source of truth for the
// Handbook. The activity code and the reason are NOT passed in: the function
// reads them from the event row, so a client cannot invent either.
//
// Authorization is the caller's responsibility, exactly as for
// setEventAttendance: this function writes to xp_ledger, the audit trail, and
// is granted to service_role alone.
export async function awardEventAttendance(
  eventId: string,
  xpAmount: number
): Promise<AwardAttendanceResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('award_event_attendance', {
    p_event_id: eventId,
    p_xp_amount: xpAmount,
  });

  if (error || !data) return { ok: false };

  // A set-returning function answers with a bare array. An empty array is the
  // correct answer for "everything was already awarded", not a failure.
  if (!Array.isArray(data)) return { ok: false };

  for (const row of data as unknown[]) {
    const candidate = row as Record<string, unknown>;

    if (typeof candidate.member_id !== 'string' || typeof candidate.ledger_id !== 'number') {
      return { ok: false };
    }
  }

  return { ok: true, awarded: data.length };
}

export type EventUpdate = {
  title: string;
  eventType: EventRow['eventType'];
  /** 'YYYY-MM-DD'. */
  eventDate: string;
  /** A Handbook activity code from lib/xp/activities.ts. */
  activityCode: string;
};

// Phase 8A: edit an event's metadata.
//
// The `.is('archived_at', null)` clause is the read-only rule, enforced in the
// statement itself rather than only by the route's earlier check: an archived
// event matches no row, so the update is a no-op even if the two requests race.
// `.select('id')` is what makes that observable - without it supabase-js reports
// only an error, and "nothing was updated" would look identical to success.
//
// Returns false when nothing was updated: the event is archived, or it no
// longer exists. The route has already read the event, so either case means the
// state changed underneath it.
//
// Only metadata is written. An edit never touches attendance or xp_ledger, which
// is what "preserve the attendance and XP audit trail" means here: renaming an
// event must not disturb the record of who attended it or what they were paid.
export async function updateEvent(
  id: string,
  update: EventUpdate
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('events')
    .update({
      title: update.title,
      event_type: update.eventType,
      event_date: update.eventDate,
      activity_code: update.activityCode,
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');

  if (error || !Array.isArray(data)) return false;

  return data.length === 1;
}

// Phase 8A: archive an event, making it read-only.
//
// Idempotent by construction: the `.is('archived_at', null)` clause means a
// second call matches no row and changes nothing, so the original archive time
// and the manager who set it are preserved rather than overwritten.
//
// The timestamp is supplied by the caller rather than by a database default.
// That is a deliberate exception to this project's usual rule - every other
// timestamp comes from the database - and it is the reason this is not also a
// SQL function: an UPDATE with a guard needs no transaction, so adding a
// function for it would be surface without benefit. The cost is that
// `archived_at` carries the application clock; for a "when was this archived"
// marker that is immaterial.
//
// Returns false when nothing was archived - already archived, or gone.
export async function archiveEvent(
  id: string,
  archivedBy: string | null
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('events')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: archivedBy,
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');

  if (error || !Array.isArray(data)) return false;

  return data.length === 1;
}

export type DeleteEventResult =
  | { ok: true }
  | { ok: false; outcome: 'has_attendance'; attendanceCount: number }
  | { ok: false; outcome: 'not_found' }
  | { ok: false; outcome: 'failed' };

// Phase 8A: delete an event, but only when nobody was recorded on it.
//
// Goes through a function rather than a count-then-delete here, and the reason
// is the audit trail: `attendance.event_id` is ON DELETE CASCADE, so a delete
// racing a concurrent attendance insert would destroy the only record of who
// attended. The function locks the event row first, which closes that window.
// See the migration.
//
// `has_attendance` is reported with the count rather than as a generic failure,
// because "12 members are recorded on this event" is an explanation and
// "conflict" is not.
//
// Authorization is the caller's responsibility: the function is granted to
// service_role alone, so every caller MUST have verified the signed session and
// confirmed the actor is an XP manager (lib/xp/managers.ts).
export async function deleteEvent(id: string): Promise<DeleteEventResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('delete_event', { p_event_id: id });

  if (error || !data) return { ok: false, outcome: 'failed' };

  // The function RETURNS TABLE (...), so PostgREST answers with a bare array and
  // the function always returns exactly one row.
  if (!Array.isArray(data) || data.length !== 1) {
    return { ok: false, outcome: 'failed' };
  }

  const row = data[0] as Record<string, unknown>;

  if (row.outcome === 'deleted') return { ok: true };

  if (row.outcome === 'not_found') return { ok: false, outcome: 'not_found' };

  if (row.outcome === 'has_attendance' && typeof row.attendance_count === 'number') {
    return {
      ok: false,
      outcome: 'has_attendance',
      attendanceCount: row.attendance_count,
    };
  }

  return { ok: false, outcome: 'failed' };
}

// Phase 8B: per-event attendance totals, for the manager analytics page.
//
// SERVER-ONLY, like every other read here: the function is granted to
// service_role alone, so the only caller is the session- and manager-checked
// GET /api/manager/analytics route.
//
// READ-ONLY by construction. The function is STABLE and writes nothing, which is
// what "keep analytics read-only" means structurally rather than by convention -
// there is no write path to accidentally reach from this page.
//
// Returns one row per event that HAS attendance, bounded by the number of events
// rather than by the number of attendance records. That bound is the whole
// reason this is a function rather than an application-side grouping: the XP
// figure is a SUM across a join into a table that grows forever.
//
// The caller joins these onto the event list from getEvents(), which is the
// authority for which events exist. An event with no row here has zero
// attendance, not missing data.
//
// Returns null on failure - including when a row does not match the declared
// shape - so the route can answer 500 rather than render every figure as zero.
export async function getEventAttendanceTotals(): Promise<
  EventAttendanceTotal[] | null
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_event_attendance_totals');

  if (error || !data) return null;

  // The function is declared `RETURNS TABLE (...)`, so PostgREST answers with a
  // bare JSON array of row objects and supabase-js resolves that array directly
  // as `data` - there is no wrapper object. Guard it explicitly: a non-array
  // means the database and this layer disagree, which is an error to report,
  // not an event with no attendance.
  if (!Array.isArray(data)) return null;

  const totals: EventAttendanceTotal[] = [];

  for (const row of data as unknown[]) {
    const parsed = eventAttendanceTotalRowSchema.safeParse(row);

    if (!parsed.success) return null;

    totals.push({
      eventId: parsed.data.event_id,
      attendanceCount: parsed.data.attendance_count,
      xpAwarded: parsed.data.xp_awarded,
    });
  }

  return totals;
}

/**
 * Phase 8C: one full row of `xp_ledger`, as read from the database - the
 * camelCase shape `getXpLedgerEntries` maps the table's snake_case columns onto.
 *
 * Deliberately carries no member name and no event: the name is joined in
 * application code from the roster the directory already reads, and the event
 * comes from `getXpLedgerEventLinks`. Both joins are done in
 * lib/manager/ledger.ts, which is a plain module the tests can reach.
 */
export type XpLedgerFullRow = {
  entryId: number;
  memberId: string;
  xpAmount: number;
  /** Null for a corrective entry, which is how the explorer identifies one. */
  activityCode: string | null;
  reason: string | null;
  createdAt: string;
};

/** Phase 8C: which event a ledger entry was awarded through. */
export type XpLedgerEventLink = {
  xpLedgerId: number;
  eventId: string;
};

/**
 * Phase 8D: what the activation flow needs to know about an email.
 *
 * `hasAuthAccount` is the whole reason the member row carries auth_user_id - it
 * is the difference between "you are a member, create your password" and "you
 * already have an account, sign in".
 */
export type MemberActivation = {
  memberId: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
  hasAuthAccount: boolean;
};

// Phase 8C: every XP ledger entry, newest first, for the manager-only explorer.
//
// SERVER-ONLY, like every other read here: `xp_ledger` is RLS-protected and the
// service-role client is the only way in, and the only caller is the session-
// and manager-checked GET /api/manager/ledger route.
//
// NO LIMIT, and that is the point of the page - it shows the whole audit trail,
// not the most recent slice that Phase 5C's dashboard shows. The ledger is the
// club's permanent record and a club accumulates a few hundred entries a year,
// so reading it whole is cheaper than a paginated API nobody would use.
//
// Ordering is the database's job and fully deterministic - created_at DESC, then
// id DESC - so the explorer's default "newest first" cannot reshuffle between
// two identical requests, including when several entries share a timestamp.
// (`id` is SERIAL, so it is a strictly increasing insertion counter.)
//
// Returns null on failure - including when a row does not match the declared
// shape - so the route can answer 500 rather than render a truncated ledger.
export async function getXpLedgerEntries(): Promise<XpLedgerFullRow[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('xp_ledger')
    .select('id, user_id, xp_amount, activity_code, reason, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error || !data) return null;

  // PostgREST answers a table select with a bare JSON array of row objects, and
  // supabase-js resolves that array directly as `data`. Guard it explicitly: a
  // non-array means the database and this layer disagree, which is an error to
  // report, not an empty ledger.
  if (!Array.isArray(data)) return null;

  const entries: XpLedgerFullRow[] = [];

  for (const row of data as unknown[]) {
    const parsed = xpLedgerFullRowSchema.safeParse(row);

    if (!parsed.success) return null;

    entries.push({
      entryId: parsed.data.id,
      memberId: parsed.data.user_id,
      xpAmount: parsed.data.xp_amount,
      activityCode: parsed.data.activity_code,
      reason: parsed.data.reason,
      createdAt: parsed.data.created_at,
    });
  }

  return entries;
}

// Phase 8C: the link from each awarded ledger entry back to the event it came
// from.
//
// There is no column for this. `xp_ledger` does not reference `events`, because
// XP is recorded against a MEMBER and an event is only one of the several ways
// it can be earned. The link runs the other way: Phase 7B's award writes an
// attendance row per attendee and stores the new ledger id on it, so
// `attendance.xp_ledger_id` is the only record of which event an entry came
// from. This reads that mapping, and the explorer joins it in application code.
//
// Only LINKED rows are read (`.not('xp_ledger_id', 'is', null)`), so an event
// whose attendance has not been awarded yet contributes nothing - there is no
// ledger entry for it to point at.
//
// Returns null on failure, so the route can answer 500 rather than show every
// entry as having no event.
export async function getXpLedgerEventLinks(): Promise<
  XpLedgerEventLink[] | null
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('attendance')
    .select('xp_ledger_id, event_id')
    .not('xp_ledger_id', 'is', null);

  if (error || !data) return null;

  if (!Array.isArray(data)) return null;

  const links: XpLedgerEventLink[] = [];

  for (const row of data as unknown[]) {
    const parsed = xpLedgerEventLinkRowSchema.safeParse(row);

    if (!parsed.success) return null;

    links.push({
      xpLedgerId: parsed.data.xp_ledger_id,
      eventId: parsed.data.event_id,
    });
  }

  return links;
}

// Phase 8D: the activation lookup for one email.
//
// SERVER-ONLY, and it uses the service-role client because
// get_member_activation is granted to service_role alone - it is the only thing
// in the application that reads `members.auth_user_id`, which must not be
// reachable from a browser-facing role.
//
// Returns null for "no such member" AND for a read failure. The caller treats
// both as "not a member", which is the safe answer: the alternative would be to
// tell someone they are a member on the strength of a failed query.
export async function getMemberActivation(
  email: string
): Promise<MemberActivation | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_member_activation', {
    p_email: email,
  });

  if (error || !data) return null;

  // A set-returning function answers with a bare array; zero rows is "not a
  // member", not an error.
  if (!Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as Record<string, unknown>;

  if (typeof row.member_id !== 'string' || typeof row.membership_status !== 'string') {
    return null;
  }

  if (
    row.membership_status !== 'pending' &&
    row.membership_status !== 'active' &&
    row.membership_status !== 'inactive'
  ) {
    return null;
  }

  return {
    memberId: row.member_id,
    membershipStatus: row.membership_status,
    hasAuthAccount: row.has_auth_account === true,
  };
}

// Phase 8D: record which Supabase Auth account a member signs in with.
//
// WRITE-ONCE BY CONSTRUCTION. The `.is('auth_user_id', null)` clause means this
// can only ever fill an empty link, never repoint one that is already set. That
// is the second half of "no duplicate Auth accounts": the column is UNIQUE, so
// two members cannot share an account, and this guard means one member cannot
// silently acquire a second one.
//
// Returns false when nothing was written - already set, or no such member. The
// caller logs that rather than failing the request, because the account exists
// and the email has been sent either way; the activation route's fallback
// handles the next attempt.
//
// Uses the service-role client: `members` is RLS-protected and no browser-facing
// role may write this column.
export async function setMemberAuthUser(
  memberId: string,
  authUserId: string
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('members')
    .update({ auth_user_id: authUserId })
    .eq('id', memberId)
    .is('auth_user_id', null)
    .select('id');

  if (error || !Array.isArray(data)) return false;

  return data.length === 1;
}

/**
 * Phase 8D: a new member created by a manager.
 *
 * `membershipStart` is the day they were added, which is what the roster import
 * set for the existing 42.
 */
export type MemberWrite = {
  displayName: string;
  email: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
  /** 'YYYY-MM-DD'. */
  membershipStart: string;
};

export type MemberWriteResult =
  | { ok: true; memberId: string }
  // A UNIQUE violation on members.email. Reported separately so the route can
  // answer 409 rather than 500, without a pre-flight read that could race.
  | { ok: false; duplicate: boolean };

// Phase 8D: insert a member. Never creates an auth account and never emails
// anyone - the new member activates themselves from the login page.
export async function createMember(
  entry: MemberWrite
): Promise<MemberWriteResult> {
  const supabase = createAdminClient();

  const memberId = randomUUID();

  const { error } = await supabase.from('members').insert({
    id: memberId,
    display_name: entry.displayName,
    email: entry.email,
    membership_status: entry.membershipStatus,
    membership_start: entry.membershipStart,
  });

  if (error) {
    console.error('Error inserting members row:', error);
    return { ok: false, duplicate: error.code === '23505' };
  }

  return { ok: true, memberId };
}

// Phase 8D: deactivate or reactivate a member.
//
// A status change, never a delete. Members are permanent club records that XP
// and attendance point at, and the phase brief is explicit that they are never
// removed; `membership_status` is the existing mechanism for this and already
// allows 'pending', 'active' and 'inactive'.
//
// The auth account is deliberately NOT touched. Banning it would be a second,
// harder-to-reverse way of expressing the same thing, and the application
// refuses an inactive member at the door (lib/auth/require-manager.ts) either
// way.
export async function setMemberStatus(
  memberId: string,
  status: 'pending' | 'active' | 'inactive'
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('members')
    .update({ membership_status: status })
    .eq('id', memberId)
    .select('id');

  if (error || !Array.isArray(data)) return false;

  return data.length === 1;
}

// ---------------------------------------------------------------------------
// Phase 8E: the member lifecycle
// ---------------------------------------------------------------------------

/** Maps a `members` row returned by an archive/restore statement. */
function mapArchiveRow(row: unknown): MemberArchiveRecord | null {
  const parsed = memberArchiveRowSchema.safeParse(row);

  if (!parsed.success) return null;

  return {
    memberId: parsed.data.id,
    email: parsed.data.email,
    displayName: parsed.data.display_name,
    membershipStatus: parsed.data.membership_status,
    archivedAt: parsed.data.archived_at,
    archivedBy: parsed.data.archived_by,
  };
}

// Phase 8E: archive a member.
//
// GUARDED, exactly like Phase 8A's event archive: `.is('archived_at', null)`
// means this can only ever fill an empty archive, never overwrite one. So two
// managers clicking at once cannot re-stamp the time or the manager, and
// "archive an already-archived member" is a no-op the caller can report as a
// conflict rather than a second archive.
//
// Returns the updated member, so the route does not need a second read to say
// what changed.
//
// Uses the service-role client: `members` is RLS-protected and no browser-facing
// role may write these columns.
export async function archiveMember(
  memberId: string,
  archivedBy: string
): Promise<MemberArchiveResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('members')
    .update({ archived_at: new Date().toISOString(), archived_by: archivedBy })
    .eq('id', memberId)
    .is('archived_at', null)
    .select('id, email, display_name, membership_status, archived_at, archived_by');

  if (error || !Array.isArray(data)) return { ok: false, outcome: 'failed' };

  // The guard matched no row: already archived, or no such member.
  if (data.length === 0) return { ok: false, outcome: 'no_change' };

  const member = mapArchiveRow(data[0]);

  if (!member) return { ok: false, outcome: 'failed' };

  return { ok: true, member };
}

// Phase 8E: restore an archived member.
//
// Idempotent, and guarded the same way in the opposite direction: the UPDATE
// only matches a row that IS archived, so restoring an active member changes
// nothing rather than stamping a restore that never happened. Both columns are
// cleared together, because a half-cleared archive would read as active while
// still claiming who archived it.
//
// NO HISTORICAL ROW IS TOUCHED. Restoring does not re-award Membership XP, does
// not re-add attendance, and does not write to the ledger - the member's history
// was never removed, so there is nothing to put back.
export async function restoreMember(
  memberId: string
): Promise<MemberArchiveResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('members')
    .update({ archived_at: null, archived_by: null })
    .eq('id', memberId)
    .not('archived_at', 'is', null)
    .select('id, email, display_name, membership_status, archived_at, archived_by');

  if (error || !Array.isArray(data)) return { ok: false, outcome: 'failed' };

  if (data.length === 0) return { ok: false, outcome: 'no_change' };

  const member = mapArchiveRow(data[0]);

  if (!member) return { ok: false, outcome: 'failed' };

  return { ok: true, member };
}

// Phase 8E: the active half of the roster.
//
// BOTH HALVES COME FROM THE ONE DIRECTORY READ, which is what stops
// /manager/members and /members disagreeing about who is on the roster. The
// split is a pure function over the rows rather than a second query, and it
// lives in lib/members/lifecycle.ts so it can be asserted on.
export async function getActiveMembers(): Promise<MemberDirectoryRow[] | null> {
  const rows = await getMemberDirectory();

  return rows === null ? null : activeMembers(rows);
}

/** Phase 8E: the archived half of the roster. */
export async function getArchivedMembers(): Promise<
  MemberDirectoryRow[] | null
> {
  const rows = await getMemberDirectory();

  return rows === null ? null : archivedMembers(rows);
}

/**
 * Phase 8E: one member's archive state, for the guards.
 *
 * Read from the directory rather than from a dedicated statement, so "who is on
 * the roster and are they archived" has exactly one answer in this codebase.
 * The roster is a few dozen rows and is already read whole elsewhere; a second
 * query returning one column would be a second definition for no gain.
 *
 * Returns null both for "no such member" and for a failed read. The guards treat
 * both as "nothing to refuse on": an award to a member who does not exist is
 * already caught by the ledger's foreign key, which reports it as a 404.
 */
export async function getMemberArchiveState(
  memberId: string
): Promise<{ memberId: string; archivedAt: string | null } | null> {
  const rows = await getMemberDirectory();

  if (!rows) return null;

  const row = rows.find((candidate) => candidate.memberId === memberId);

  if (!row) return null;

  return { memberId: row.memberId, archivedAt: row.archivedAt };
}
// ---------------------------------------------------------------------------
// Phase 9: challenges
// ---------------------------------------------------------------------------

/** One challenge, as read from the database. */
export type ChallengeRecord = {
  challengeId: string;
  title: string;
  slug: string;
  /** A Handbook activity code from lib/xp/activities.ts. */
  activityCode: string;
  /** The Handbook XP value. Never chosen by a member. */
  xpReward: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  requirements: string;
  estimatedHours: number;
  submissionType: 'github_url' | 'text';
  archivedAt: string | null;
  createdAt: string;
};

/** One member's attempt at one challenge. */
export type ChallengeSubmissionRecord = {
  submissionId: string;
  challengeId: string;
  memberId: string;
  githubUrl: string | null;
  submissionText: string | null;
  status: 'pending' | 'approved' | 'rejected';
  managerFeedback: string | null;
  reviewedAt: string | null;
  /** Null until a manager approves. Non-null means an XP row exists. */
  xpLedgerId: number | null;
  createdAt: string;
};

function mapChallenge(row: unknown): ChallengeRecord | null {
  const parsed = challengeRowSchema.safeParse(row);

  if (!parsed.success) return null;

  return {
    challengeId: parsed.data.id,
    title: parsed.data.title,
    slug: parsed.data.slug,
    activityCode: parsed.data.activity_code,
    xpReward: parsed.data.xp_reward,
    difficulty: parsed.data.difficulty,
    description: parsed.data.description,
    requirements: parsed.data.requirements,
    estimatedHours: parsed.data.estimated_hours,
    submissionType: parsed.data.submission_type,
    archivedAt: parsed.data.archived_at,
    createdAt: parsed.data.created_at,
  };
}

function mapSubmission(row: unknown): ChallengeSubmissionRecord | null {
  const parsed = challengeSubmissionRowSchema.safeParse(row);

  if (!parsed.success) return null;

  return {
    submissionId: parsed.data.id,
    challengeId: parsed.data.challenge_id,
    memberId: parsed.data.member_id,
    githubUrl: parsed.data.github_url,
    submissionText: parsed.data.submission_text,
    status: parsed.data.status,
    managerFeedback: parsed.data.manager_feedback,
    reviewedAt: parsed.data.reviewed_at,
    xpLedgerId: parsed.data.xp_ledger_id,
    createdAt: parsed.data.created_at,
  };
}

const CHALLENGE_COLUMNS =
  'id, title, slug, activity_code, xp_reward, difficulty, description, requirements, estimated_hours, submission_type, archived_at, archived_by, created_at';

const SUBMISSION_COLUMNS =
  'id, challenge_id, member_id, github_url, submission_text, status, manager_feedback, reviewed_by, reviewed_at, xp_ledger_id, created_at';

/**
 * Phase 9: every challenge a member may take, cheapest first.
 *
 * ARCHIVED CHALLENGES ARE EXCLUDED, so a challenge a manager has retired stops
 * appearing on the homepage and stops accepting submissions - but the
 * submissions already made against it stay readable, because archiving hides a
 * challenge rather than deleting it.
 */
export async function getChallenges(): Promise<ChallengeRecord[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenges')
    .select(CHALLENGE_COLUMNS)
    .is('archived_at', null)
    .order('xp_reward', { ascending: true })
    .order('title', { ascending: true });

  if (error || !data) return null;

  if (!Array.isArray(data)) return null;

  const challenges: ChallengeRecord[] = [];

  for (const row of data as unknown[]) {
    const challenge = mapChallenge(row);

    if (!challenge) return null;

    challenges.push(challenge);
  }

  return challenges;
}

/** Phase 9: every challenge including archived ones, for the manager page. */
export async function getAllChallenges(): Promise<ChallengeRecord[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenges')
    .select(CHALLENGE_COLUMNS)
    .order('archived_at', { ascending: true, nullsFirst: true })
    .order('title', { ascending: true });

  if (error || !data) return null;

  if (!Array.isArray(data)) return null;

  const challenges: ChallengeRecord[] = [];

  for (const row of data as unknown[]) {
    const challenge = mapChallenge(row);

    if (!challenge) return null;

    challenges.push(challenge);
  }

  return challenges;
}

/**
 * Phase 9: one challenge by slug.
 *
 * Archived challenges are still returned - a member who bookmarked the page, or
 * whose submission is under review, must still be able to read it. The page
 * decides what to show.
 */
export async function getChallengeBySlug(
  slug: string
): Promise<ChallengeRecord | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenges')
    .select(CHALLENGE_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;

  return mapChallenge(data);
}

/**
 * Phase 9: one member's submissions.
 *
 * Includes every status, because the page has to show a member their rejected
 * attempts and the feedback on them - that is what "resubmit after rejection"
 * requires.
 */
export async function getMemberSubmissions(
  memberId: string
): Promise<ChallengeSubmissionRecord[] | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenge_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (error || !data) return null;

  if (!Array.isArray(data)) return null;

  const submissions: ChallengeSubmissionRecord[] = [];

  for (const row of data as unknown[]) {
    const submission = mapSubmission(row);

    if (!submission) return null;

    submissions.push(submission);
  }

  return submissions;
}

/**
 * Phase 9: the review queue.
 *
 * Every submission, newest first. The manager page groups them by status, so
 * this reads them all rather than filtering, and the grouping is a pure
 * function over the result.
 */
export async function getChallengeSubmissions(): Promise<
  ChallengeSubmissionRecord[] | null
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenge_submissions')
    .select(SUBMISSION_COLUMNS)
    .order('created_at', { ascending: false });

  if (error || !data) return null;

  if (!Array.isArray(data)) return null;

  const submissions: ChallengeSubmissionRecord[] = [];

  for (const row of data as unknown[]) {
    const submission = mapSubmission(row);

    if (!submission) return null;

    submissions.push(submission);
  }

  return submissions;
}

export type SubmissionWrite = {
  challengeId: string;
  memberId: string;
  githubUrl: string | null;
  submissionText: string | null;
};

export type SubmissionWriteResult =
  | { ok: true; submissionId: string }
  // The partial unique index rejected a second PENDING submission for the same
  // member and challenge. Reported separately so the route can answer 409
  // instead of 500, without a pre-flight read that could race.
  | { ok: false; alreadyPending: boolean };

/**
 * Phase 9: record a submission.
 *
 * WRITES NO XP. There is no path from here to `xp_ledger` - the ledger is only
 * ever touched by approve_challenge_submission. A submission is a claim, and the
 * Handbook is explicit that XP is subject to approval.
 *
 * The one-pending-per-challenge rule is enforced by the database rather than by
 * a check here, so two rapid clicks cannot both succeed.
 */
export async function createChallengeSubmission(
  entry: SubmissionWrite
): Promise<SubmissionWriteResult> {
  const supabase = createAdminClient();

  const submissionId = randomUUID();

  const { error } = await supabase.from('challenge_submissions').insert({
    id: submissionId,
    challenge_id: entry.challengeId,
    member_id: entry.memberId,
    github_url: entry.githubUrl,
    submission_text: entry.submissionText,
  });

  if (error) {
    console.error('Error inserting challenge_submissions row:', error);
    // 23505 is the partial unique index: a pending submission already exists.
    return { ok: false, alreadyPending: error.code === '23505' };
  }

  return { ok: true, submissionId };
}

export type ReviewResult =
  | { ok: true; ledgerId: number | null }
  // The submission was already decided, or does not exist. The caller reports
  // that rather than retrying, and nothing was written.
  | { ok: false; outcome: 'not_found' | 'already_reviewed' | 'failed' };

/**
 * Phase 9: approve a submission - the ONLY way a challenge grants XP.
 *
 * Delegates to approve_challenge_submission, which locks the row, refuses
 * unless it is still pending, inserts exactly one ledger row using the
 * CHALLENGE OWN xp_reward, and stamps the submission. Approving twice cannot
 * produce a second award.
 *
 * `reason` is the only caller-supplied text and is a display string composed in
 * TypeScript, where the Handbook activity labels live. The XP amount is not
 * passed at all - the function reads it from the challenges table.
 */
export async function approveChallengeSubmission(
  submissionId: string,
  reviewedBy: string,
  reason: string
): Promise<ReviewResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('approve_challenge_submission', {
    p_submission_id: submissionId,
    p_reviewed_by: reviewedBy,
    p_reason: reason,
  });

  if (error) {
    // no_data_found is the function's own "no such submission".
    if (error.code === 'P0002' || /does not exist/.test(error.message)) {
      return { ok: false, outcome: 'not_found' };
    }

    console.error('Error approving challenge submission:', error);
    return { ok: false, outcome: 'failed' };
  }

  // A set-returning function answers with a bare array. ZERO rows is the
  // correct answer for "already reviewed", not a failure - and it is the
  // guarantee that a double-click writes nothing.
  if (!Array.isArray(data)) return { ok: false, outcome: 'failed' };

  if (data.length === 0) return { ok: false, outcome: 'already_reviewed' };

  const row = data[0] as Record<string, unknown>;

  return {
    ok: true,
    ledgerId: typeof row.ledger_id === 'number' ? row.ledger_id : null,
  };
}

/** Phase 9: reject a submission. Writes no XP and never touches the ledger. */
export async function rejectChallengeSubmission(
  submissionId: string,
  reviewedBy: string,
  feedback: string | null
): Promise<ReviewResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('reject_challenge_submission', {
    p_submission_id: submissionId,
    p_reviewed_by: reviewedBy,
    p_feedback: feedback,
  });

  if (error) {
    if (error.code === 'P0002' || /does not exist/.test(error.message)) {
      return { ok: false, outcome: 'not_found' };
    }

    console.error('Error rejecting challenge submission:', error);
    return { ok: false, outcome: 'failed' };
  }

  if (!Array.isArray(data)) return { ok: false, outcome: 'failed' };

  if (data.length === 0) return { ok: false, outcome: 'already_reviewed' };

  return { ok: true, ledgerId: null };
}

/** Phase 9: a challenge a manager is creating or editing. */
export type ChallengeWrite = {
  title: string;
  slug: string;
  activityCode: string;
  xpReward: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  requirements: string;
  estimatedHours: number;
  submissionType: 'github_url' | 'text';
};

export type ChallengeWriteResult =
  | { ok: true; challengeId: string }
  | { ok: false; duplicateSlug: boolean };

/** Phase 9: create a challenge. */
export async function createChallenge(
  entry: ChallengeWrite
): Promise<ChallengeWriteResult> {
  const supabase = createAdminClient();

  const challengeId = randomUUID();

  const { error } = await supabase.from('challenges').insert({
    id: challengeId,
    title: entry.title,
    slug: entry.slug,
    activity_code: entry.activityCode,
    xp_reward: entry.xpReward,
    difficulty: entry.difficulty,
    description: entry.description,
    requirements: entry.requirements,
    estimated_hours: entry.estimatedHours,
    submission_type: entry.submissionType,
  });

  if (error) {
    console.error('Error inserting challenges row:', error);
    return { ok: false, duplicateSlug: error.code === '23505' };
  }

  return { ok: true, challengeId };
}

/**
 * Phase 9: edit a challenge.
 *
 * The slug is deliberately NOT editable: it is the public URL, and changing it
 * would break every link to the challenge. Everything else a manager may fix.
 */
export async function updateChallenge(
  challengeId: string,
  entry: Omit<ChallengeWrite, 'slug'>
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenges')
    .update({
      title: entry.title,
      activity_code: entry.activityCode,
      xp_reward: entry.xpReward,
      difficulty: entry.difficulty,
      description: entry.description,
      requirements: entry.requirements,
      estimated_hours: entry.estimatedHours,
      submission_type: entry.submissionType,
    })
    .eq('id', challengeId)
    .select('id');

  if (error || !Array.isArray(data)) return false;

  return data.length === 1;
}

/**
 * Phase 9: archive a challenge.
 *
 * Guarded, exactly like Phase 8A event archive and 8E member archive: it can
 * only ever fill an empty archive. Submissions already made are untouched - a
 * challenge is hidden, never deleted, and never re-valued.
 */
export async function archiveChallenge(
  challengeId: string,
  archivedBy: string
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('challenges')
    .update({ archived_at: new Date().toISOString(), archived_by: archivedBy })
    .eq('id', challengeId)
    .is('archived_at', null)
    .select('id');

  if (error || !Array.isArray(data)) return false;

  return data.length === 1;
}
