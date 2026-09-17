import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { memberSchema, levelSchema, leaderboardRowSchema } from './schema';
import type { LevelDefinition } from '@/lib/xp/levels';
import type { LeaderboardRow } from '@/lib/xp/leaderboards';

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