import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  memberSchema,
  levelSchema,
  leaderboardRowSchema,
  memberDirectoryRowSchema,
  recentXpEntryRowSchema,
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