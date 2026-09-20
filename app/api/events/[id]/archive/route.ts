// Phase 8A: archive one event.
//
//   POST /api/events/[id]/archive
//
// Manager-only, via lib/auth/require-manager.ts: a verified session (401) and an
// XP manager (403).
//
// Archiving marks an event finished. From that point it is read-only - it cannot
// be edited (PATCH answers 409), attendance cannot be taken against it, and it
// cannot be awarded. None of its data changes: archiving writes two columns and
// leaves the attendance rows and the XP ledger entries exactly as they were,
// which is the point of archiving rather than deleting.
//
// IDEMPOTENT. Archiving an already-archived event is a success that changes
// nothing - the UPDATE is guarded by `archived_at IS NULL`, so the original
// archive time and the manager who set it are preserved rather than overwritten.
// A manager clicking twice, or two managers clicking at once, therefore cannot
// rewrite the record of when the event was closed.
//
// The request carries no body. The manager doing the archiving comes from the
// session, never from the client.

import { NextResponse } from 'next/server';
import { archiveEvent, getEventById } from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { eventIdSchema } from '@/lib/events/request';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const parsedId = eventIdSchema.safeParse(id);

    if (!parsedId.success) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const eventId = parsedId.data;

    // Read first for two reasons: to answer 404 for an unknown id, and because
    // an already-archived event should be reported as done rather than
    // re-archived. The UPDATE is still guarded, so this read is for the
    // response, not for safety.
    const event = await getEventById(eventId);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.archivedAt !== null) {
      // Already archived. A success, not a conflict: the caller asked for the
      // event to be archived and it is archived.
      return NextResponse.json({
        ok: true,
        archived: true,
        alreadyArchived: true,
        archivedAt: event.archivedAt,
      });
    }

    const archived = await archiveEvent(eventId, auth.memberId);

    // `false` means the guard matched no row: the event was archived in the
    // window between the read above and this write, so another request got
    // there first. That is still the outcome the caller asked for, so it is
    // reported as success rather than as a conflict - and the guard means the
    // original archive time and manager are intact rather than overwritten.
    //
    // (The event could also have been deleted in that window, in which case the
    // page's reload will show it gone. Reporting failure here would be worse:
    // it would tell a manager their archive did not happen when the event no
    // longer exists to archive.)
    return NextResponse.json({
      ok: true,
      archived: true,
      alreadyArchived: !archived,
    });
  } catch (error) {
    console.error('Error in POST /api/events/[id]/archive:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
