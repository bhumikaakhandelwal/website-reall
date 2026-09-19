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
} from './schema';
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
};

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