// Handbook leaderboards.
//
// SINGLE SOURCE OF TRUTH for which XP activity belongs to which leaderboard.
// Values come from the DBCE Coders Club Handbook (AY 2026-27), which defines
// three monthly leaderboards and no others:
//
//   1. Overall XP Leaderboard          - every activity
//   2. Hackathon Leaderboard           - hackathon activities only
//   3. Open-Source Contribution        - the open-source activity only
//
// The activity codes below are the ones in lib/xp/activities.ts (the server's
// single source of truth for XP amounts). They are NOT duplicated into SQL: the
// aggregation function takes a code list as a parameter, so the Handbook
// mapping stays in one place, in code, next to the activity list.
//
// Note: app/content/xp-content.ts holds a separate, display-only copy of the
// three leaderboard names used by the public /xp-system page and the
// /leaderboard page. That page is frozen presentational content and is never
// used to compute a ranking. tests/leaderboard-core.test.mjs pins the two id
// lists together so they cannot drift apart.

export type LeaderboardId = 'overall' | 'hackathon' | 'open-source';

export type LeaderboardDefinition = {
  id: LeaderboardId;
  /**
   * Handbook activity codes counted for this leaderboard.
   * `null` means every ledger entry counts, including corrective adjustments
   * (which carry no activity code but still change the member's XP).
   */
  activityCodes: readonly string[] | null;
};

export const LEADERBOARDS: readonly LeaderboardDefinition[] = [
  { id: 'overall', activityCodes: null },
  {
    id: 'hackathon',
    activityCodes: [
      'external-contest-hackathon',
      'hackathon-finals',
      'win-hackathon',
    ],
  },
  { id: 'open-source', activityCodes: ['open-source-contribution'] },
];

/** A leaderboard row as read from the database, before it is ranked. */
export type LeaderboardRow = {
  memberId: string;
  displayName: string;
  xp: number;
};

/**
 * Assigns a rank to each row of an already XP-ordered leaderboard.
 *
 * Ties share a rank and the following rank skips (1, 1, 3) - the standard
 * meaning of "rank" on a leaderboard. The rows themselves are ordered by the
 * database (xp DESC, display_name, member id), so tied members always appear in
 * the same order; this function only numbers them.
 *
 * Input order is assumed to be XP-descending; it is not re-sorted here.
 */
export function assignRanks<T extends { xp: number }>(
  entries: readonly T[]
): (T & { rank: number })[] {
  let rank = 0;
  let previousXp: number | null = null;

  return entries.map((entry, index) => {
    if (index === 0 || entry.xp !== previousXp) {
      rank = index + 1;
    }

    previousXp = entry.xp;

    return { ...entry, rank };
  });
}

import { istMonthPeriod as clubMonthPeriod } from '@/lib/dates';

export type MonthlyPeriod = {
  /** First instant of the month, inclusive. */
  start: Date;
  /** First instant of the next month, exclusive. */
  end: Date;
};

/**
   * The current leaderboard month, as the half-open range [start, end).
   *
   * Phase 10A: THE INDIAN MONTH. This was `utcMonthPeriod`, and its own comment
   * justified the UTC calendar month on the grounds that "there is no
   * application-level timezone anywhere" - a premise this phase ends. The club
   * is in Goa and the site now labels the month in IST, so the window has to
   * agree with the label; a UTC window under an IST heading would disagree for
   * five and a half hours at every month boundary, showing August's entries
   * under "September 2026".
   *
   * The boundaries are IST midnights expressed as UTC instants, which is what
   * the database is queried with. `Date.UTC` performs exact calendar
   * arithmetic, so the window is correct across month lengths and leap years
   * alike. The end instant is computed here rather than as
   * `period_start + 1 month` in SQL, because that SQL arithmetic is evaluated
   * in the session timezone and can land an hour off across a DST change.
   *
   * The aggregation, the ranking and the row mapping are untouched.
   */
  
export function istMonthPeriod(now: Date = new Date()): MonthlyPeriod {
  return clubMonthPeriod(now);
}

