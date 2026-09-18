// Phase 7A: the event foundation's client-side logic.
//
// Everything the /events page DECIDES lives here, as plain functions, for the
// same reason lib/xp/award.ts and lib/manager/dashboard.ts exist: this project
// has no DOM test environment (Node's type stripping does not transform JSX, so
// a .tsx component cannot be imported into a test at all). The component is
// therefore presentation and wiring only, and the validation, the request
// shapes, and what each response means are all asserted on here.
//
// Deliberately NOT in this module: the XP amount. An event names a Handbook
// activity CODE; the amount is resolved from lib/xp/activities.ts at award time
// (Phase 7B). Nothing here writes XP - this phase creates events and lists them.

import { XP_ACTIVITIES, getXpActivity } from '@/lib/xp/activities';

/**
 * The closed vocabulary of club event types, with their display labels.
 *
 * The CODES must match `eventTypeSchema` in lib/db/schema.ts and the CHECK
 * constraint on `events.event_type`. They are written out here rather than
 * derived from that schema because importing it would pull zod into the browser
 * bundle, and a test pins the two lists together instead.
 */
export const EVENT_TYPES = [
  { code: 'workshop', label: 'Workshop' },
  { code: 'technical-session', label: 'Technical session' },
  { code: 'coding-contest', label: 'Coding contest' },
  { code: 'hackathon', label: 'Hackathon' },
  { code: 'meeting', label: 'Meeting' },
  { code: 'other', label: 'Other' },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]['code'];

export const EVENT_TITLE_MAX = 200;

/**
 * The Handbook activities a manager can attach to an event, in the order
 * lib/xp/activities.ts declares them.
 *
 * Mapped from XP_ACTIVITIES rather than redefined, so the dropdown can never
 * offer an activity the server would reject. This is the same arrangement the
 * Award XP panel uses.
 */
export const ACTIVITY_OPTIONS = XP_ACTIVITIES.map((activity) => ({
  code: activity.code,
  label: activity.label,
  xp: activity.xp,
}));

/** The label to show for a stored event type. */
export function eventTypeLabel(code: string): string {
  return EVENT_TYPES.find((type) => type.code === code)?.label ?? code;
}

/**
 * True only for a real calendar date in `YYYY-MM-DD` form.
 *
 * The round-trip through Date is the point: `Date.parse('2026-02-31T00:00:00Z')`
 * succeeds by rolling over to 3 March, so a parse check alone would accept a
 * date the manager did not type. Comparing the components back catches it.
 *
 * Month and day are range-checked by the round-trip too - `Date.UTC(2026, 12, 1)`
 * is January 2027, which fails the year comparison.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export type EventDraft = {
  title: string;
  eventType: string;
  eventDate: string;
  activityCode: string;
};

export type EventDraftField = 'title' | 'eventType' | 'eventDate' | 'activityCode';

export type EventValidation =
  | {
      ok: true;
      title: string;
      eventType: EventType;
      eventDate: string;
      activityCode: string;
    }
  | { ok: false; field: EventDraftField; message: string };

/**
 * Validates a draft event and returns the NORMALIZED values to submit.
 *
 * Returns the first problem with the field it belongs to, so the form can put
 * the message next to the input that caused it rather than in one lump at the
 * bottom. Unlike the roster validator (which reports every problem so a bulk
 * import can be fixed in one pass), a four-field form is corrected one field at
 * a time, and naming the field is more useful than listing them all.
 *
 * The activity code is checked against the real Handbook list, so the dropdown
 * cannot submit something POST /api/events would reject.
 */
export function validateEventDraft(draft: EventDraft): EventValidation {
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';

  if (title.length === 0) {
    return { ok: false, field: 'title', message: 'Give the event a title.' };
  }

  if (title.length > EVENT_TITLE_MAX) {
    return {
      ok: false,
      field: 'title',
      message: `Keep the title to ${EVENT_TITLE_MAX} characters or fewer.`,
    };
  }

  const eventType = EVENT_TYPES.find((type) => type.code === draft.eventType);

  if (!eventType) {
    return { ok: false, field: 'eventType', message: 'Choose an event type.' };
  }

  const eventDate = typeof draft.eventDate === 'string' ? draft.eventDate.trim() : '';

  if (!isCalendarDate(eventDate)) {
    return { ok: false, field: 'eventDate', message: 'Choose a valid date.' };
  }

  const activityCode =
    typeof draft.activityCode === 'string' ? draft.activityCode.trim() : '';

  if (!getXpActivity(activityCode)) {
    return {
      ok: false,
      field: 'activityCode',
      message: 'Choose the Handbook activity this event awards.',
    };
  }

  return {
    ok: true,
    title,
    eventType: eventType.code,
    eventDate,
    activityCode,
  };
}

/**
 * The XP this event will award, as a label, or null if no activity is chosen.
 *
 * Display only, and deliberately ignores the rest of the draft - it is a
 * preview of one dropdown, exactly like the Award XP panel's. Nothing is
 * submitted from it; the server resolves the amount from the activity code.
 */
export function activityXpPreview(activityCode: string): string | null {
  const activity = getXpActivity(activityCode);

  return activity ? `+${activity.xp} XP` : null;
}

/**
 * Formats a stored `YYYY-MM-DD` date for display, e.g. "Fri, Sep 18, 2026".
 *
 * UTC-PINNED, and that is not incidental. `event_date` is a DATE with no zone;
 * `new Date('2026-09-18')` parses as midnight UTC, so formatting it in the
 * visitor's local zone renders the PREVIOUS day for anyone west of UTC. The
 * same bug class is documented in lib/manager/dashboard.ts, and this is the
 * third place in the project it would bite.
 *
 * Locale is pinned to en-US for the same reason the dashboard pins it: the
 * separator and month abbreviation must not change with the host's locale.
 */
export function formatEventDate(iso: string): string {
  if (!isCalendarDate(iso)) return iso;

  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** One event as GET /api/events returns it. */
export type EventRecord = {
  id: string;
  title: string;
  eventType: EventType;
  eventDate: string;
  activityCode: string;
  createdBy: string | null;
  createdAt: string;
};

export type ListEventsOutcome =
  | { ok: true; events: EventRecord[] }
  | { ok: false; kind: 'unauthorized' | 'forbidden' | 'unavailable'; message: string };

export type SubmitEventOutcome =
  | { ok: true; id: string }
  | { ok: false; kind: 'rejected' | 'unauthorized' | 'forbidden' | 'unavailable'; message: string };

const REJECTION_MESSAGES: Record<string, string> = {
  'Invalid request body': 'That event was not valid. Check the details, then try again.',
  'Unknown activity code': 'That activity is not in the Handbook list.',
};

function rejectionMessage(error: string): string {
  return REJECTION_MESSAGES[error] ?? 'That event was not valid. Check the details, then try again.';
}

/**
 * Reads the event list.
 *
 * 401 means the session is gone and 403 means the session is valid but is not a
 * manager. They are reported separately because the page responds to them
 * differently - the first re-gates and returns to /login, the second shows a
 * "managers only" panel and stays put, because retrying will never help it.
 * (The Award XP panel only has to distinguish 401, because it is rendered only
 * once the roster read has already answered 200; this page has no such prior
 * check, so it must tell the two apart itself.)
 *
 * A 2xx whose body is not the expected shape is treated as unavailable, never
 * as an empty list, so a broken response cannot look like "no events yet".
 */
export async function fetchEvents(
  fetchImpl: typeof fetch = fetch
): Promise<ListEventsOutcome> {
  let response: Response;

  try {
    response = await fetchImpl('/api/events');
  } catch {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The events could not be loaded. Try again in a moment.',
    };
  }

  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    return {
      ok: false,
      kind: 'forbidden',
      message: 'The event register is for XP managers.',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The events could not be loaded. Try again in a moment.',
    };
  }

  const payload = (await response.json().catch(() => null)) as { events?: unknown } | null;

  if (!payload || !Array.isArray(payload.events)) {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The events could not be loaded. Try again in a moment.',
    };
  }

  return { ok: true, events: payload.events as EventRecord[] };
}

/**
 * Creates one event.
 *
 * The body carries ONLY the four fields the manager chose plus the activity
 * code. In particular it never carries an XP amount: the event names an
 * activity, and the amount is resolved server-side at award time. Sending one
 * would be meaningless here and is not accepted.
 */
export async function submitEvent(
  draft: EventDraft,
  fetchImpl: typeof fetch = fetch
): Promise<SubmitEventOutcome> {
  let response: Response;

  try {
    response = await fetchImpl('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        eventType: draft.eventType,
        eventDate: draft.eventDate,
        activityCode: draft.activityCode,
      }),
    });
  } catch {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The event was not saved — nothing has changed. Try again.',
    };
  }

  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    // The session is valid but this member is not on the manager allowlist -
    // possible if the allowlist changed while the form was open.
    return {
      ok: false,
      kind: 'forbidden',
      message: 'You are not an XP manager, so the event was not saved.',
    };
  }

  if (response.status === 400 || response.status === 404) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    return { ok: false, kind: 'rejected', message: rejectionMessage(payload?.error ?? '') };
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The event was not saved — nothing has changed. Try again.',
    };
  }

  const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;

  // A 2xx without an id is a broken response, not a success: reporting success
  // would leave the manager believing an event exists when it does not.
  if (!payload || typeof payload.id !== 'string') {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The event was not saved — nothing has changed. Try again.',
    };
  }

  return { ok: true, id: payload.id };
}
