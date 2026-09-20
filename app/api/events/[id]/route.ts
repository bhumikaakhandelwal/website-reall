// Phase 8A: edit and delete one event.
//
//   PATCH  /api/events/[id]   change the event's metadata
//   DELETE /api/events/[id]   remove it, but only when nobody was recorded
//
// Both are manager-only, via lib/auth/require-manager.ts - a verified session
// (401) and an XP manager (403), the same as every other manager endpoint.
//
// THE READ-ONLY RULE. An archived event cannot be edited: PATCH answers 409.
// The rule is enforced twice on purpose - once here, so the manager gets a clear
// explanation, and once in the UPDATE itself (`.is('archived_at', null)`), so a
// request that races an archive cannot slip a change through the window between
// this route's read and its write.
//
// WHAT NEITHER VERB TOUCHES: attendance and xp_ledger. An edit rewrites four
// metadata columns and nothing else, and a delete is only permitted when there
// is no attendance to lose. That is what "preserve the attendance and XP audit
// trail" means for this phase.
//
// A DELETE IS ALLOWED ON AN ARCHIVED EVENT, deliberately. "Read-only" is applied
// to the operations that change an event's data - editing it, taking attendance
// against it, awarding it - not to removing an event that has no data at all.
// Refusing here would make an archived event permanently undeletable, which is a
// worse trap than allowing the cleanup. The attendance rule is the only
// condition on a delete, exactly as the brief states it.

import { NextResponse } from 'next/server';
import {
  deleteEvent,
  getEventById,
  updateEvent,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { getXpActivity } from '@/lib/xp/activities';
import { eventBodySchema, eventIdSchema } from '@/lib/events/request';

export async function PATCH(
  request: Request,
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

    const event = await getEventById(eventId);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // The read-only rule, stated plainly rather than as a 403: the manager IS
    // allowed to use this endpoint, the event just is not editable any more.
    if (event.archivedAt !== null) {
      return NextResponse.json({ error: 'Event is archived' }, { status: 409 });
    }

    const body = await request.json().catch(() => null);
    const parsed = eventBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Checked against the Handbook, not by a CHECK constraint, so
    // lib/xp/activities.ts stays the single source of truth - the same
    // arrangement POST /api/events and POST /api/xp/award use.
    if (!getXpActivity(parsed.data.activityCode)) {
      return NextResponse.json(
        { error: 'Unknown activity code' },
        { status: 400 }
      );
    }

    const updated = await updateEvent(eventId, {
      title: parsed.data.title,
      eventType: parsed.data.eventType,
      eventDate: parsed.data.eventDate,
      activityCode: parsed.data.activityCode,
    });

    // False means the guard matched no row: the event was archived between the
    // read above and the write.
    if (!updated) {
      return NextResponse.json({ error: 'Event is archived' }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in PATCH /api/events/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const result = await deleteEvent(parsedId.data);

    if (result.ok) {
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (result.outcome === 'not_found') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (result.outcome === 'has_attendance') {
      // 409 with the count, so the page can say how many people are recorded
      // rather than just that some are.
      return NextResponse.json(
        {
          error: 'Event has attendance',
          attendanceCount: result.attendanceCount,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } catch (error) {
    console.error('Error in DELETE /api/events/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
