// Phase 8A: the event lifecycle.
//
// Everything the register's lifecycle actions DECIDE lives here, as plain
// functions, for the same reason lib/events/events.ts and
// lib/events/attendance.ts exist: this project has no DOM test environment
// (Node's type stripping does not transform JSX, so a .tsx component cannot be
// imported into a test at all). The archive split, the read-only rule, the
// sentences each action shows, and what every response means are all asserted
// on here, and the components are presentation and wiring only.
//
// THE ONE RULE THIS MODULE EXISTS TO KEEP: an archived event is read-only. It
// cannot be edited, taken attendance against, or awarded. `isEditable` is the
// single expression of that, and the routes enforce the same rule server-side -
// this is the interface for it, not the enforcement.

import {
  formatEventDate,
  validateEventDraft,
  type EventDraft,
  type EventRecord,
} from './events';

/** The register's two groups, each keeping the order the database returned. */
export type EventGroups = {
  active: EventRecord[];
  archived: EventRecord[];
};

/**
 * Splits the register into active and archived events.
 *
 * Order is preserved within each group rather than re-sorted: the database
 * already orders by event date, and re-sorting here would be a second opinion
 * about ordering that could disagree with it.
 *
 * Archived events go last in the page, which is why this returns them as a
 * separate list rather than a flag the component has to group by itself.
 */
export function splitByArchive(events: readonly EventRecord[]): EventGroups {
  const active: EventRecord[] = [];
  const archived: EventRecord[] = [];

  for (const event of events) {
    (isArchived(event) ? archived : active).push(event);
  }

  return { active, archived };
}

/** True once an event has been archived, and is therefore read-only. */
export function isArchived(event: EventRecord): boolean {
  return event.archivedAt !== null;
}

/**
 * True while an event can still be edited, taken attendance against, or awarded.
 *
 * The single expression of the read-only rule. Every place that needs to know
 * asks this, so there is one answer rather than a `!event.archivedAt` written
 * out in several components and eventually written wrong in one of them.
 */
export function isEditable(event: EventRecord): boolean {
  return event.archivedAt === null;
}

/**
 * The date an event was archived, e.g. "Sat, Sep 19, 2026".
 *
 * Reuses formatEventDate by taking the UTC date part of the stored timestamp,
 * which keeps the project's UTC pinning in one place - the same pin that stops
 * a date rendering as the previous day for a manager west of UTC.
 */
export function formatArchivedDate(archivedAt: string): string {
  return formatEventDate(archivedAt.slice(0, 10));
}

export type LifecycleFailureKind =
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'rejected'
  | 'conflict'
  | 'unavailable';

export type LifecycleFailure = {
  ok: false;
  kind: LifecycleFailureKind;
  message: string;
};

export type EditOutcome = { ok: true; message: string } | LifecycleFailure;
export type ArchiveOutcome = { ok: true; message: string } | LifecycleFailure;
export type DeleteOutcome = { ok: true; message: string } | LifecycleFailure;

const UNAVAILABLE = 'The page could not reach the server. Try again in a moment.';

/**
 * The sentence shown after deleting is refused because attendance exists.
 *
 * Names the count, because "12 members are recorded on this event" explains the
 * rule and "conflict" does not. The rule itself is stated rather than implied:
 * an event is deletable only while nobody has been recorded on it, and deleting
 * one would take the record of who attended with it.
 */
export function describeDeleteRefusal(attendanceCount: number): string {
  const who =
    attendanceCount === 1
      ? '1 member is recorded'
      : `${attendanceCount} members are recorded`;

  return `This event cannot be deleted — ${who} on it, and deleting would take the record of who attended with it. Archive it instead.`;
}

/** The sentence shown after a successful delete. */
export function describeDelete(title: string): string {
  return `“${title}” was deleted. It had no attendance, so nothing else was affected.`;
}

/** The sentence shown after a successful archive. */
export function describeArchive(title: string): string {
  return `“${title}” was archived. It is now read-only — its attendance and XP are unchanged.`;
}

/** The sentence shown after a successful edit. */
export function describeEdit(title: string): string {
  return `“${title}” was updated. Its attendance and XP are unchanged.`;
}

function eventUrl(id: string): string {
  return `/api/events/${encodeURIComponent(id)}`;
}

/** Maps a status code onto the failure the page should show. */
async function failureFor(response: Response): Promise<LifecycleFailure> {
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

  if (response.status === 404) {
    return { ok: false, kind: 'notFound', message: 'That event no longer exists.' };
  }

  if (response.status === 409) {
    // Conflict means the event changed underneath the page - it was archived
    // while the form was open, or attendance was recorded while the delete was
    // being confirmed. The server's message explains which.
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      attendanceCount?: unknown;
    } | null;

    if (typeof payload?.attendanceCount === 'number') {
      return {
        ok: false,
        kind: 'conflict',
        message: describeDeleteRefusal(payload.attendanceCount),
      };
    }

    return {
      ok: false,
      kind: 'conflict',
      message:
        payload?.error === 'Event is archived'
          ? 'This event has been archived, so it is read-only.'
          : 'This event changed while the page was open. Reload and try again.',
    };
  }

  if (response.status === 400) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    return {
      ok: false,
      kind: 'rejected',
      message:
        payload?.error === 'Unknown activity code'
          ? 'That activity is not in the Handbook list.'
          : 'That change was not accepted. Check the details, then try again.',
    };
  }

  return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
}

/**
 * Edits an event's metadata.
 *
 * The draft is validated HERE with the same validator the create form uses, so
 * a bad title or an unknown activity code is caught before a request is made
 * and the message names the field that caused it. The route validates again -
 * this is the friendly path, not the authoritative one.
 *
 * Only the four metadata fields are sent. Attendance and XP are not mentioned
 * anywhere in this request, which is what "preserve the audit trail" means for
 * an edit.
 */
export async function editEvent(
  id: string,
  draft: EventDraft,
  fetchImpl: typeof fetch = fetch
): Promise<EditOutcome> {
  const checked = validateEventDraft(draft);

  if (!checked.ok) {
    return { ok: false, kind: 'rejected', message: checked.message };
  }

  let response: Response;

  try {
    response = await fetchImpl(eventUrl(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: checked.title,
        eventType: checked.eventType,
        eventDate: checked.eventDate,
        activityCode: checked.activityCode,
      }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) return failureFor(response);

  return { ok: true, message: describeEdit(checked.title) };
}

/**
 * Archives an event.
 *
 * The request carries no body: archiving is a state change on the event, and
 * the manager doing it comes from the session, never from the client.
 */
export async function archiveEvent(
  id: string,
  title: string,
  fetchImpl: typeof fetch = fetch
): Promise<ArchiveOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(`${eventUrl(id)}/archive`, { method: 'POST' });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) return failureFor(response);

  return { ok: true, message: describeArchive(title) };
}

/**
 * Deletes an event.
 *
 * The rule - only when nobody is recorded on it - is the server's, and the 409
 * it returns carries the count so the message can be specific. This function
 * does not pre-check anything: the page does not know the attendance count, and
 * guessing would be a second, weaker copy of the rule.
 */
export async function deleteEvent(
  id: string,
  title: string,
  fetchImpl: typeof fetch = fetch
): Promise<DeleteOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(eventUrl(id), { method: 'DELETE' });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) return failureFor(response);

  return { ok: true, message: describeDelete(title) };
}
