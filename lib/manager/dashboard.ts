import { formatIstDateTime, formatIstMonth } from '@/lib/dates';
// Phase 5C: the manager dashboard's derivations.
//
// Everything the dashboard DECIDES lives here, as plain functions, for the same
// reason lib/xp/award.ts exists: this project has no DOM test environment (no
// jsdom, no testing-library), so `npm test` can only reach logic that is not
// inside a React component. app/components/manager-dashboard.tsx is therefore
// presentation and wiring only - it renders exactly what these functions
// return, and the route is what feeds them.
//
// The split of responsibility:
//
//   the database  orders the ledger rows (created_at DESC, id DESC) and applies
//                 the row limit; it also sums the month
//   this module   turns those rows into the four cards and the display-ready
//                 list: counting the roster, formatting the month, signing the
//                 XP, and formatting the timestamp
//
// Deliberately absent: any re-sorting. Every other list in this application
// (the leaderboard, the directory) trusts the database's ordering so two
// identical requests can never produce two different orders, and the ledger's
// order is the whole point of a "most recent" list.

/** How many recent ledger entries the dashboard shows. */
export const RECENT_ENTRY_LIMIT = 10;

/** The roster subset the dashboard counts. */
export type DashboardMember = {
  memberId: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
};

/** A ledger row as the API returns it, before it is formatted for display. */
export type DashboardLedgerEntry = {
  entryId: number;
  memberId: string;
  displayName: string;
  xpAmount: number;
  activityCode: string | null;
  reason: string | null;
  createdAt: string;
};

/** The four summary cards. */
export type DashboardCards = {
  totalMembers: number;
  activeMembers: number;
  /** Net XP recorded in the ledger this month. May be negative. */
  monthXp: number;
  /** e.g. "September 2026". */
  monthLabel: string;
};

/** One recent entry, ready to render. */
export type RecentEntry = {
  /** Unique per ledger row; the list key. */
  entryId: number;
  memberId: string;
  displayName: string;
  /** Signed amount, for anything that needs the number rather than the label. */
  xpAmount: number;
  /** e.g. "+50" or "-300". */
  xpLabel: string;
  /** Never empty - see `entryReason`. */
  reason: string;
  /** e.g. "Sep 17, 2026, 22:13", in UTC. */
  timestamp: string;
  /** The raw instant, for a <time dateTime> attribute. */
  createdAt: string;
};

export type DashboardSummary = {
  cards: DashboardCards;
  recent: RecentEntry[];
};

/**
 * The month label, e.g. "September 2026".
 *
 * Explicit locale AND UTC. The period start is midnight UTC on the 1st, so
 * formatting it in the visitor's local timezone would render "August 2026" for
 * anyone west of UTC - the card would name the wrong month for most of the
 * world. /leaderboard's own month label is formatted the same way.
 */
export function formatMonthLabel(period: { start: Date }): string {
  // Phase 10A: the month label is the club's month, formatted in IST by
  // lib/dates.ts. `period.start` is now an IST month boundary too, so the label
  // and the window it describes cannot disagree.
  return formatIstMonth(period.start);
}

/**
 * A signed XP amount, e.g. "+50", "-300", "+1,200".
 *
 * The sign is always shown for a positive amount: on a ledger where a
 * correction can subtract XP, an unsigned number would leave the reader
 * guessing which direction the entry went. Zero is rendered without a sign -
 * the ledger column forbids it, but this function is exported and generic.
 *
 * Pinned to 'en-US' so the thousands separator cannot change with the host's
 * locale.
 */
export function formatSignedXp(amount: number): string {
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('en-US')}`;
}

/**
 * A ledger timestamp, e.g. "Sep 17, 2026, 22:13".
 *
 * Explicit locale and UTC, for the same reason as the directory's join date:
 * `created_at` is a TIMESTAMPTZ written by the database in UTC, and a ledger
 * entry must not appear to move by hours - or across a day - depending on where
 * the manager happens to be sitting.
 *
 * The ledger records that a manager DID something, so the time matters and is
 * shown, unlike the directory's date-only join column.
 */
export function formatLedgerTimestamp(iso: string): string {
  // Phase 10A: IST, so a manager in Goa reads the club's own clock rather than
  // the server's. Still PINNED, never the visitor's - see lib/dates.ts for why
  // that distinction matters. The formatter returns an unparseable value
  // unchanged, which is the guard this function used to make itself.
  return formatIstDateTime(iso);
}

/**
 * The reason to display for an entry.
 *
 * `xp_ledger.reason` is nullable, and a row written before Phase 3 may have no
 * activity code either, so there is nothing to fall back to. Rather than render
 * an empty cell - which reads as a rendering bug - or substitute the activity
 * code (a different field, and a misleading answer to "why"), a missing reason
 * is stated plainly.
 */
export function entryReason(entry: {
  reason: string | null;
  activityCode: string | null;
}): string {
  const reason = entry.reason?.trim();

  return reason && reason.length > 0 ? reason : 'No reason recorded';
}

/**
 * Turns the route's three reads into the dashboard's payload.
 *
 * `members` is the same roster GET /api/members serves the directory, so
 * "Total Members" is that page's row count and "Active Members" is its status
 * count - the two pages cannot report different roster sizes. Counting a few
 * dozen rows here is cheaper than a second query, and it keeps one definition
 * of "the roster".
 *
 * `entries` is sliced to RECENT_ENTRY_LIMIT even though the database already
 * applies the limit, so the list can never render more than ten rows whatever
 * the query returns.
 */
export function summariseDashboard(input: {
  members: readonly DashboardMember[];
  monthXp: number;
  entries: readonly DashboardLedgerEntry[];
  period: { start: Date };
}): DashboardSummary {
  return {
    cards: {
      totalMembers: input.members.length,
      activeMembers: input.members.filter(
        (member) => member.membershipStatus === 'active'
      ).length,
      monthXp: input.monthXp,
      monthLabel: formatMonthLabel(input.period),
    },
    recent: input.entries.slice(0, RECENT_ENTRY_LIMIT).map((entry) => ({
      entryId: entry.entryId,
      memberId: entry.memberId,
      displayName: entry.displayName,
      xpAmount: entry.xpAmount,
      xpLabel: formatSignedXp(entry.xpAmount),
      reason: entryReason(entry),
      timestamp: formatLedgerTimestamp(entry.createdAt),
      createdAt: entry.createdAt,
    })),
  };
}
