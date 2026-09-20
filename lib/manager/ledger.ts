// Phase 8C: the XP ledger explorer.
//
// Everything the ledger page DECIDES lives here, as plain functions, for the
// same reason lib/manager/dashboard.ts and lib/events/analytics.ts exist: this
// project has no DOM test environment (Node's type stripping does not transform
// JSX, so a .tsx component cannot be imported into a test at all). The
// enrichment - joining a member name and an event title onto each ledger row -
// and the four filters are exactly the logic worth asserting on, and here they
// can be.
//
// The joins happen HERE rather than in SQL, on purpose. A ledger row carries a
// member id and nothing else: the member's name comes from the roster the
// directory already reads, and the event comes from the attendance link Phase 7B
// writes. Doing both in application code means the explorer reuses the existing
// member and event reads instead of introducing a third definition of either -
// and it means the join is testable, which a SQL join in a view would not be.
//
// READ-ONLY. Nothing in this module or the page it serves writes anything, and
// the route behind it issues no writes.
//
// REUSED, not duplicated: formatSignedXp, formatLedgerTimestamp and entryReason
// come from lib/manager/dashboard.ts, which already formats ledger rows for the
// manager dashboard. A ledger entry must read the same on both pages.

import {
  entryReason,
  formatLedgerTimestamp,
  formatSignedXp,
} from './dashboard';
import { getXpActivity } from '@/lib/xp/activities';
import { isCalendarDate } from '@/lib/events/events';

/** Shown when a ledger row names a member the roster no longer contains. */
export const UNKNOWN_MEMBER = 'Unknown member';

/** One ledger row as the database layer reads it. */
export type LedgerSourceRow = {
  entryId: number;
  memberId: string;
  xpAmount: number;
  activityCode: string | null;
  reason: string | null;
  createdAt: string;
};

/** One ledger entry, ready to render. */
export type LedgerEntry = {
  entryId: number;
  memberId: string;
  displayName: string;
  /** Empty when the member is unknown; used by the member search. */
  email: string;
  xpAmount: number;
  /** e.g. "+50" or "-300". */
  xpLabel: string;
  /**
   * True when the entry carries no activity code, which is what a correction
   * is: an off-Handbook adjustment rather than an award. This is the column the
   * Award/Correction filter reads.
   */
  isCorrection: boolean;
  activityCode: string | null;
  /** The Handbook label, or "Correction" for an entry with no code. */
  activityLabel: string;
  /** Never empty - see entryReason. */
  reason: string;
  /** The event this was awarded through, or null for a manual award. */
  eventId: string | null;
  eventTitle: string | null;
  /** The raw instant, for a <time dateTime> attribute. */
  createdAt: string;
  /** e.g. "Sep 17, 2026, 22:13", in UTC. */
  timestamp: string;
};

const CORRECTION_LABEL = 'Correction';

/**
 * Joins the member name, the event title and the display labels onto every
 * ledger row.
 *
 * Order is preserved exactly as given - the database ordered it newest-first and
 * nothing here re-sorts, so "newest first" is the database's answer rather than
 * a second opinion.
 *
 * Every join is tolerant of a miss. A member who is not on the roster, an event
 * that has been deleted, and an entry with no event at all are all normal
 * states, not errors: the ledger is an append-only audit trail that outlives the
 * things it refers to, and an entry must still be readable when the thing it
 * names is gone.
 */
export function enrichLedgerEntries(
  entries: readonly LedgerSourceRow[],
  members: readonly { memberId: string; displayName: string; email: string }[],
  links: readonly { xpLedgerId: number; eventId: string }[],
  events: readonly { id: string; title: string }[]
): LedgerEntry[] {
  const memberById = new Map(members.map((member) => [member.memberId, member]));
  const eventById = new Map(events.map((event) => [event.id, event]));

  // The link is read as a map rather than used as a join table, so a ledger
  // entry can never be duplicated by it. Phase 7B writes one ledger row per
  // attendance row, so a ledger id appears at most once - but the explorer must
  // not depend on that to avoid showing the same entry twice. First wins.
  const eventIdByLedgerId = new Map<number, string>();

  for (const link of links) {
    if (!eventIdByLedgerId.has(link.xpLedgerId)) {
      eventIdByLedgerId.set(link.xpLedgerId, link.eventId);
    }
  }

  return entries.map((entry) => {
    const member = memberById.get(entry.memberId);
    const eventId = eventIdByLedgerId.get(entry.entryId) ?? null;
    const event = eventId ? eventById.get(eventId) ?? null : null;
    const activity = entry.activityCode ? getXpActivity(entry.activityCode) : null;

    return {
      entryId: entry.entryId,
      memberId: entry.memberId,
      displayName: member?.displayName ?? UNKNOWN_MEMBER,
      email: member?.email ?? '',
      xpAmount: entry.xpAmount,
      xpLabel: formatSignedXp(entry.xpAmount),
      isCorrection: entry.activityCode === null,
      activityCode: entry.activityCode,
      activityLabel: activity?.label ?? entry.activityCode ?? CORRECTION_LABEL,
      reason: entryReason(entry),
      // An event that has since been deleted leaves the entry readable, with no
      // event named rather than a broken one.
      eventId: event ? eventId : null,
      eventTitle: event?.title ?? null,
      createdAt: entry.createdAt,
      timestamp: formatLedgerTimestamp(entry.createdAt),
    };
  });
}

export type LedgerEntryKind = 'all' | 'award' | 'correction';

export type LedgerFilters = {
  /** Matches the member's name or email, case-insensitively. */
  memberQuery: string;
  /** An activity code, or '' for every activity. */
  activityCode: string;
  kind: LedgerEntryKind;
  /** 'YYYY-MM-DD', or '' for no lower bound. */
  from: string;
  /** 'YYYY-MM-DD', or '' for no upper bound. */
  to: string;
};

export const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  memberQuery: '',
  activityCode: '',
  kind: 'all',
  from: '',
  to: '',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The half-open instant range a date filter describes, or null when neither
 * bound is set.
 *
 * HALF-OPEN, `[start, end)`: `to` is INCLUSIVE of the whole day the manager
 * picked, which is what anyone reading "from the 1st to the 5th" expects, and
 * the bound is the start of the 6th. That is the same convention the monthly
 * leaderboards use, and it avoids the classic bug where the last day of a range
 * silently drops everything after midnight.
 *
 * A bound that is not a real calendar date is ignored rather than failing: the
 * inputs are native date pickers, so the only other thing they can be is empty.
 */
export function dateBounds(
  from: string,
  to: string
): { start: number; end: number } | null {
  const start = isCalendarDate(from) ? Date.parse(`${from}T00:00:00Z`) : null;
  const end = isCalendarDate(to) ? Date.parse(`${to}T00:00:00Z`) + DAY_MS : null;

  if (start === null && end === null) return null;

  return {
    start: start ?? Number.NEGATIVE_INFINITY,
    end: end ?? Number.POSITIVE_INFINITY,
  };
}

/**
 * Applies the four filters, keeping the order it was given.
 *
 * All four combine with AND, which is what a manager expects from a filter bar:
 * narrowing one filter narrows the result, it does not widen it.
 */
export function filterLedgerEntries(
  entries: readonly LedgerEntry[],
  filters: LedgerFilters
): LedgerEntry[] {
  const needle = filters.memberQuery.trim().toLowerCase();
  const bounds = dateBounds(filters.from, filters.to);

  return entries.filter((entry) => {
    if (needle !== '') {
      const matches =
        entry.displayName.toLowerCase().includes(needle) ||
        entry.email.toLowerCase().includes(needle);

      if (!matches) return false;
    }

    if (filters.activityCode !== '' && entry.activityCode !== filters.activityCode) {
      return false;
    }

    if (filters.kind === 'award' && entry.isCorrection) return false;
    if (filters.kind === 'correction' && !entry.isCorrection) return false;

    if (bounds !== null) {
      // Compared as instants rather than as strings: the database writes
      // created_at with a numeric offset (`+00:00`) while the bounds above are
      // built with `Z`, and comparing those as text would be wrong.
      const at = Date.parse(entry.createdAt);

      if (!(at >= bounds.start && at < bounds.end)) return false;
    }

    return true;
  });
}

export type LedgerSummary = {
  /** How many entries the filters left. */
  shown: number;
  /** How many there are in total, so the page can say "12 of 94". */
  total: number;
  awards: number;
  corrections: number;
  /** Net XP across the SHOWN entries. Negative when corrections outweigh. */
  netXp: number;
};

/** The counts the page shows above the list. */
export function summariseLedger(
  shown: readonly LedgerEntry[],
  total: number
): LedgerSummary {
  let awards = 0;
  let corrections = 0;
  let netXp = 0;

  for (const entry of shown) {
    if (entry.isCorrection) {
      corrections += 1;
    } else {
      awards += 1;
    }

    netXp += entry.xpAmount;
  }

  return { shown: shown.length, total, awards, corrections, netXp };
}

/**
 * The activities the ledger actually contains, for the activity dropdown.
 *
 * Derived from the entries rather than from the Handbook list, so the dropdown
 * offers only activities that would return something. A filter that can only
 * ever produce an empty list is worse than no filter.
 *
 * Corrections are not an option: they carry no activity code, and the
 * Award/Correction filter is what selects them.
 */
export function activityOptions(
  entries: readonly LedgerEntry[]
): { code: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const entry of entries) {
    if (entry.activityCode === null) continue;

    const existing = counts.get(entry.activityCode);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(entry.activityCode, { label: entry.activityLabel, count: 1 });
    }
  }

  return [...counts.entries()]
    .map(([code, value]) => ({ code, label: value.label, count: value.count }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The client call
// ---------------------------------------------------------------------------

export type LedgerOutcome =
  | { ok: true; entries: LedgerEntry[] }
  | { ok: false; kind: 'unauthorized' | 'forbidden' | 'unavailable'; message: string };

const UNAVAILABLE = 'The ledger could not be loaded. Try again in a moment.';

/**
 * Reads the ledger.
 *
 * 401 means the session is gone and 403 means the session is valid but is not a
 * manager; they are reported separately because the page responds differently -
 * the first re-gates, the second shows a "managers only" panel and stays put.
 *
 * A 2xx whose body is not the expected shape is unavailable, never an empty
 * ledger, so a broken response cannot look like a club that has never recorded
 * any XP.
 */
export async function loadLedger(
  fetchImpl: typeof fetch = fetch
): Promise<LedgerOutcome> {
  let response: Response;

  try {
    response = await fetchImpl('/api/manager/ledger');
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    return {
      ok: false,
      kind: 'forbidden',
      message: 'The XP ledger is for XP managers.',
    };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  const payload = (await response.json().catch(() => null)) as {
    entries?: unknown;
  } | null;

  if (!payload || !Array.isArray(payload.entries)) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return { ok: true, entries: payload.entries as LedgerEntry[] };
}
