// Phase 8B: event analytics.
//
// Everything the analytics page SHOWS is derived here, as plain functions, for
// the same reason lib/events/events.ts and lib/events/attendance.ts exist: this
// project has no DOM test environment (Node's type stripping does not transform
// JSX, so a .tsx component cannot be imported into a test at all). Averages,
// maximums, month bucketing and the type breakdown are exactly the kind of
// arithmetic that is worth asserting on, and here they can be.
//
// The split of work with the database:
//
//   the database  does the one aggregation that cannot be done cheaply here -
//                 counting attendance per event and summing the XP it awarded
//                 (get_event_attendance_totals). That result is bounded by the
//                 number of EVENTS, not by the number of attendance records.
//   this module   does everything else: the totals, the average, the highest,
//                 the monthly trend and the type breakdown, from that plus the
//                 ordinary event list.
//
// READ-ONLY. Nothing in this module or the page it serves writes anything.
//
// Deliberately not imported here: `@/lib/db/queries`. That module pulls in the
// Supabase clients and `node:crypto`, and this one is imported by a client
// component. The `AttendanceTotal` shape below is the JSON the API sends, which
// is why it is declared here rather than shared with the database layer.

import { EVENT_TYPES, eventTypeLabel, type EventRecord, type EventType } from './events';

/** One event's attendance totals, as the API sends them. */
export type AttendanceTotal = {
  eventId: string;
  attendanceCount: number;
  xpAwarded: number;
};

/** One month of the attendance trend. */
export type TrendPoint = {
  /** 'YYYY-MM', the sort key. */
  month: string;
  /** e.g. "Sep 2026". */
  label: string;
  attendance: number;
};

/** One row of the event-type breakdown. */
export type TypeBreakdown = {
  eventType: EventType;
  label: string;
  /** How many events of this type exist. */
  events: number;
  /** Attendance recorded across all of them. */
  attendance: number;
  /** XP awarded through that attendance. */
  xp: number;
};

export type HighestAttended = {
  eventId: string;
  title: string;
  attendanceCount: number;
};

export type EventAnalytics = {
  totalEvents: number;
  totalAttendance: number;
  /**
   * Mean attendance per event, as a NUMBER rather than a rounded string, so the
   * caller formats it and the arithmetic stays assertable.
   */
  averageAttendance: number;
  /** The best-attended event, or null when no event has any attendance. */
  highestAttended: HighestAttended | null;
  xpThroughAttendance: number;
  /** Oldest month first. */
  trend: TrendPoint[];
  /** Most events first. */
  breakdown: TypeBreakdown[];
};

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * The month an event falls in, as 'YYYY-MM'.
 *
 * A pure string slice of the stored `YYYY-MM-DD` date. Deliberately NOT parsed
 * into a Date: that would reintroduce the timezone hazard the rest of this
 * project pins against, and there is nothing here that needs a Date - the date
 * is already in the form the bucket key wants.
 */
export function monthOf(eventDate: string): string {
  return eventDate.slice(0, 7);
}

/** 'YYYY-MM' -> "Sep 2026". Table-driven, so no Date and no locale. */
export function formatMonthLabel(month: string): string {
  const [year, index] = month.split('-');
  const name = MONTH_NAMES[Number(index) - 1];

  return name ? `${name} ${year}` : month;
}

/** The average, to one decimal place. e.g. 42 -> "42.0", 12.25 -> "12.3". */
export function formatAverage(value: number): string {
  return value.toFixed(1);
}

/**
 * Derives every figure on the analytics page.
 *
 * `events` is the authority for which events exist - the totals only cover
 * events that have attendance, so the two are joined here rather than trusting
 * the totals to be exhaustive. That also means an event nobody attended counts
 * towards `totalEvents` and towards the average denominator while contributing
 * nothing to `totalAttendance`, which is the correct reading of "average
 * attendance per event": an event that ran and nobody came is still an event.
 *
 * Ties for the best-attended event are broken by the earlier event date, then by
 * id, so the answer is stable rather than depending on the order the rows
 * happened to arrive in.
 */
export function summariseAnalytics(
  events: readonly EventRecord[],
  totals: readonly AttendanceTotal[]
): EventAnalytics {
  const byEventId = new Map(totals.map((total) => [total.eventId, total]));

  // Only totals belonging to a known event are counted. A row for an event that
  // is not in the list cannot happen (attendance has a foreign key to events),
  // but counting it would let `totalAttendance` exceed what the event list
  // explains, and an average larger than any event is a worse outcome than
  // ignoring an impossible row.
  const known = events.map((event) => ({
    event,
    total: byEventId.get(event.id) ?? null,
  }));

  const totalEvents = events.length;
  const totalAttendance = known.reduce(
    (sum, entry) => sum + (entry.total?.attendanceCount ?? 0),
    0
  );
  const xpThroughAttendance = known.reduce(
    (sum, entry) => sum + (entry.total?.xpAwarded ?? 0),
    0
  );

  const averageAttendance = totalEvents === 0 ? 0 : totalAttendance / totalEvents;

  // Highest-attended. Ties go to the earlier event, then to the lower id.
  let highestAttended: HighestAttended | null = null;

  for (const { event, total } of known) {
    const attendanceCount = total?.attendanceCount ?? 0;

    if (attendanceCount === 0) continue;

    if (
      highestAttended === null ||
      attendanceCount > highestAttended.attendanceCount ||
      (attendanceCount === highestAttended.attendanceCount &&
        isEarlierThan(event, highestAttended.eventId, events))
    ) {
      highestAttended = { eventId: event.id, title: event.title, attendanceCount };
    }
  }

  // Trend: one point per month that has at least one event, oldest first. A
  // month whose events drew nobody shows 0 rather than being omitted - the gap
  // is the information.
  const byMonth = new Map<string, number>();

  for (const { event, total } of known) {
    const month = monthOf(event.eventDate);

    byMonth.set(month, (byMonth.get(month) ?? 0) + (total?.attendanceCount ?? 0));
  }

  const trend: TrendPoint[] = [...byMonth.entries()]
    .map(([month, attendance]) => ({
      month,
      label: formatMonthLabel(month),
      attendance,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  // Type breakdown: every declared type that has at least one event, most events
  // first. Types with no events are omitted rather than shown as a row of
  // zeroes, which would be noise on a club with a handful of event kinds.
  const byType = new Map<string, TypeBreakdown>();

  for (const { event, total } of known) {
    const existing = byType.get(event.eventType) ?? {
      eventType: event.eventType,
      label: eventTypeLabel(event.eventType),
      events: 0,
      attendance: 0,
      xp: 0,
    };

    existing.events += 1;
    existing.attendance += total?.attendanceCount ?? 0;
    existing.xp += total?.xpAwarded ?? 0;

    byType.set(event.eventType, existing);
  }

  const breakdown = [...byType.values()].sort(
    (a, b) => b.events - a.events || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
  );

  return {
    totalEvents,
    totalAttendance,
    averageAttendance,
    highestAttended,
    xpThroughAttendance,
    trend,
    breakdown,
  };
}

/** True when `event` sorts before the current best on (date, id). */
function isEarlierThan(
  event: EventRecord,
  bestEventId: string,
  events: readonly EventRecord[]
): boolean {
  const best = events.find((candidate) => candidate.id === bestEventId);

  if (!best) return false;

  if (event.eventDate !== best.eventDate) {
    return event.eventDate < best.eventDate;
  }

  return event.id < best.id;
}

/** The declared event types, for a legend that is stable across loads. */
export const ANALYTICS_EVENT_TYPES = EVENT_TYPES;

// ---------------------------------------------------------------------------
// The client call
// ---------------------------------------------------------------------------

export type AnalyticsOutcome =
  | { ok: true; analytics: EventAnalytics }
  | { ok: false; kind: 'unauthorized' | 'forbidden' | 'unavailable'; message: string };

const UNAVAILABLE = 'The analytics could not be loaded. Try again in a moment.';

/** Loose structural check on the payload our own API sent. */
function isAnalytics(value: unknown): value is EventAnalytics {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.totalEvents === 'number' &&
    typeof candidate.totalAttendance === 'number' &&
    typeof candidate.averageAttendance === 'number' &&
    typeof candidate.xpThroughAttendance === 'number' &&
    (candidate.highestAttended === null ||
      typeof candidate.highestAttended === 'object') &&
    Array.isArray(candidate.trend) &&
    Array.isArray(candidate.breakdown)
  );
}

/**
 * Reads the analytics.
 *
 * 401 means the session is gone and 403 means the session is valid but is not a
 * manager; they are reported separately because the page responds differently -
 * the first re-gates, the second shows a "managers only" panel and stays put.
 *
 * A 2xx whose body is not the expected shape is unavailable, never an all-zero
 * dashboard, so a broken response cannot look like a club that has never run an
 * event.
 */
export async function loadAnalytics(
  fetchImpl: typeof fetch = fetch
): Promise<AnalyticsOutcome> {
  let response: Response;

  try {
    response = await fetchImpl('/api/manager/analytics');
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
      message: 'Event analytics are for XP managers.',
    };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  const payload = await response.json().catch(() => null);

  if (!isAnalytics(payload)) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return { ok: true, analytics: payload };
}
