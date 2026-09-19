// Phase 7B: attendance-taking and the bulk award.
//
// Everything the attendance page DECIDES lives here, as plain functions, for
// the same reason lib/events/events.ts and lib/manager/dashboard.ts exist: this
// project has no DOM test environment (Node's type stripping does not transform
// JSX, so a .tsx component cannot be imported into a test at all). The member
// search, the checkbox semantics, the awarded/unawarded split and what each
// response means are therefore all asserted on here, and
// app/components/attendance-manager.tsx is presentation and wiring only.
//
// NOTHING here chooses an XP amount. The amount arrives from the API, resolved
// server-side from the event's Handbook activity code via lib/xp/activities.ts.
// A manager's action carries no number at all, which is what "no custom XP
// amounts" means end to end.

import { getXpActivity } from '@/lib/xp/activities';
import type { EventRecord } from './events';

/** One member of the roster the page offers. */
export type AttendanceMember = {
  memberId: string;
  displayName: string;
  email: string;
};

/** One saved attendance row, as the API returns it. */
export type AttendanceEntry = {
  memberId: string;
  /** null until the attendee has been awarded. */
  xpLedgerId: number | null;
};

/** The whole payload of GET /api/events/[id]/attendance. */
export type AttendancePayload = {
  event: EventRecord;
  /** The full roster, so the page can offer every member. */
  members: AttendanceMember[];
  /** Who is currently recorded as present. */
  attendance: AttendanceEntry[];
  /** Resolved from the event's activity code. Never chosen by the client. */
  xpAmount: number;
  activityLabel: string;
  /**
   * False when the event names an activity that is no longer in the Handbook.
   *
   * Such an event is still readable - Phase 7A deliberately allows history to
   * outlive a Handbook change - and attendance can still be taken against it,
   * but it cannot award XP, because there is no amount to award. Stated
   * explicitly rather than inferred from `xpAmount === 0`, which would be an
   * implicit contract nobody would remember.
   */
  awardable: boolean;
};

export type AttendanceFailureKind =
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'rejected'
  | 'unavailable';

export type AttendanceFailure = {
  ok: false;
  kind: AttendanceFailureKind;
  message: string;
};

export type LoadOutcome =
  | { ok: true; payload: AttendancePayload }
  | AttendanceFailure;

export type SaveOutcome =
  | { ok: true; added: number; removed: number; keptAwarded: number; message: string }
  | AttendanceFailure;

export type AwardOutcome =
  | { ok: true; awarded: number; xpAmount: number; message: string }
  | AttendanceFailure;

/**
 * Filters the roster by name or email, case-insensitively.
 *
 * The same rule as the member directory's search, over the whole roster in the
 * browser rather than as a server round-trip per keystroke: 42 rows is nothing,
 * and the attendance route deliberately has no search parameter.
 *
 * A blank query returns the roster untouched, in its original order.
 */
export function filterMembers(
  members: readonly AttendanceMember[],
  query: string
): AttendanceMember[] {
  const needle = query.trim().toLowerCase();

  if (needle === '') return [...members];

  return members.filter(
    (member) =>
      member.displayName.toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle)
  );
}

/**
 * Turns the saved attendance rows into the two sets the page needs.
 *
 * `present` drives the checkboxes; `awarded` drives which of them are locked.
 * Keeping them as separate sets rather than one list of rows means the checkbox
 * state cannot drift from the award state: a member is checked because they are
 * in `present`, and cannot be unchecked because they are in `awarded`.
 */
export function splitAttendance(entries: readonly AttendanceEntry[]): {
  present: Set<string>;
  awarded: Set<string>;
} {
  const present = new Set<string>();
  const awarded = new Set<string>();

  for (const entry of entries) {
    present.add(entry.memberId);

    if (entry.xpLedgerId !== null) {
      awarded.add(entry.memberId);
    }
  }

  return { present, awarded };
}

export type AttendanceStats = {
  /** Members currently checked. */
  present: number;
  /** Checked members already awarded - they cannot be un-recorded. */
  awarded: number;
  /** Checked members still waiting to be awarded. */
  awaiting: number;
};

/** The counts the page shows above the list. */
export function attendanceStats(
  entries: readonly AttendanceEntry[]
): AttendanceStats {
  let present = 0;
  let awarded = 0;

  for (const entry of entries) {
    present += 1;

    if (entry.xpLedgerId !== null) awarded += 1;
  }

  return { present, awarded, awaiting: present - awarded };
}

/** e.g. "+50 XP". Display only - the amount is resolved server-side. */
export function formatXpAmount(xp: number): string {
  return `+${xp.toLocaleString('en-US')} XP`;
}

/**
 * The sentence shown after saving.
 *
 * Reports removals and kept-awarded rows explicitly rather than just saying
 * "saved": a manager who unchecks someone who has already been awarded needs to
 * know the row was KEPT, because otherwise the checkbox appears to have
 * silently reverted.
 */
export function describeSave(result: {
  added: number;
  removed: number;
  keptAwarded: number;
}): string {
  const parts: string[] = [];

  if (result.added > 0) {
    parts.push(`${result.added} added`);
  }

  if (result.removed > 0) {
    parts.push(`${result.removed} removed`);
  }

  const summary =
    parts.length === 0 ? 'Attendance saved — nothing changed.' : `Attendance saved — ${parts.join(', ')}.`;

  if (result.keptAwarded > 0) {
    return `${summary} ${result.keptAwarded} ${
      result.keptAwarded === 1 ? 'member has' : 'members have'
    } already been awarded and ${
      result.keptAwarded === 1 ? 'was' : 'were'
    } left on the event.`;
  }

  return summary;
}

/**
 * The sentence shown after awarding.
 *
 * Zero is a SUCCESS, not a failure: it is the correct answer when everything
 * was already awarded, which is exactly what the idempotency guard produces on
 * a second click. Saying so plainly is the difference between "nothing to do"
 * and "something went wrong".
 */
export function describeAward(awarded: number, xpAmount: number): string {
  if (awarded === 0) {
    return 'Everyone recorded on this event has already been awarded — nothing changed.';
  }

  const each = formatXpAmount(xpAmount);

  return `Awarded ${awarded} ${awarded === 1 ? 'member' : 'members'} ${each} each.`;
}

/** The label for the event's activity, or the raw code if it is unknown. */
export function activityLabelFor(activityCode: string): string {
  return getXpActivity(activityCode)?.label ?? activityCode;
}

// ---------------------------------------------------------------------------
// Client calls
// ---------------------------------------------------------------------------

const UNAVAILABLE = 'The page could not reach the server. Try again in a moment.';

function attendanceUrl(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/attendance`;
}

function awardUrl(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/award`;
}

/** Maps a status code onto the failure the page should show. */
async function failureFor(response: Response): Promise<AttendanceFailure> {
  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    return {
      ok: false,
      kind: 'forbidden',
      message: 'The attendance register is for XP managers.',
    };
  }

  if (response.status === 404) {
    return { ok: false, kind: 'notFound', message: 'That event no longer exists.' };
  }

  if (response.status === 400) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    return {
      ok: false,
      kind: 'rejected',
      message:
        payload?.error === 'Unknown activity code'
          ? 'This event names an activity that is no longer in the Handbook, so it cannot award XP.'
          : 'That request was not accepted. Reload the page and try again.',
    };
  }

  return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
}

/** Reads the event, the roster and the current attendance. */
export async function loadAttendance(
  eventId: string,
  fetchImpl: typeof fetch = fetch
): Promise<LoadOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(attendanceUrl(eventId));
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) return failureFor(response);

  const payload = (await response.json().catch(() => null)) as AttendancePayload | null;

  // A 2xx without the expected shape is a broken response, not an empty event.
  if (
    !payload ||
    typeof payload !== 'object' ||
    !payload.event ||
    !Array.isArray(payload.members) ||
    !Array.isArray(payload.attendance) ||
    typeof payload.xpAmount !== 'number' ||
    typeof payload.awardable !== 'boolean'
  ) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return { ok: true, payload };
}

/**
 * Saves the checked set.
 *
 * Sends member ids only. There is no amount in the body, and the server would
 * not accept one: the XP comes from the event's activity code at award time.
 */
export async function saveAttendance(
  eventId: string,
  memberIds: readonly string[],
  fetchImpl: typeof fetch = fetch
): Promise<SaveOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(attendanceUrl(eventId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberIds: [...memberIds] }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) return failureFor(response);

  const payload = (await response.json().catch(() => null)) as {
    added?: unknown;
    removed?: unknown;
    keptAwarded?: unknown;
  } | null;

  const counts = [payload?.added, payload?.removed, payload?.keptAwarded];

  if (counts.some((value) => typeof value !== 'number')) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  const result = {
    added: payload?.added as number,
    removed: payload?.removed as number,
    keptAwarded: payload?.keptAwarded as number,
  };

  return { ok: true, ...result, message: describeSave(result) };
}

/**
 * Awards every recorded attendee who has not been awarded yet.
 *
 * The request body is EMPTY - not even the amount is sent. The server resolves
 * it from the event's own activity code, so there is nothing here for a client
 * to get wrong or to forge.
 */
export async function awardAttendance(
  eventId: string,
  fetchImpl: typeof fetch = fetch
): Promise<AwardOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(awardUrl(eventId), { method: 'POST' });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) return failureFor(response);

  const payload = (await response.json().catch(() => null)) as {
    awarded?: unknown;
    xpAmount?: unknown;
  } | null;

  if (typeof payload?.awarded !== 'number' || typeof payload.xpAmount !== 'number') {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return {
    ok: true,
    awarded: payload.awarded,
    xpAmount: payload.xpAmount,
    message: describeAward(payload.awarded, payload.xpAmount),
  };
}
