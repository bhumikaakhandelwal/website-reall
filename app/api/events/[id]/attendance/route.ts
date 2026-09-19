// Phase 7B: attendance for one event.
//
//   GET /api/events/[id]/attendance   the event, the roster, and who is recorded
//   PUT /api/events/[id]/attendance   save the recorded set
//
// Both are manager-only, via lib/auth/require-manager.ts - the same two checks
// as every other manager endpoint: a verified session (401) and an XP manager
// (403).
//
// Reads run on the service-role client behind tables that RLS denies to every
// browser-facing role, and the write goes through a function granted to
// service_role alone (see the Phase 7B migration). This route's session- and
// manager-gate is what makes both acceptable.
//
// WHAT THIS ROUTE DOES NOT DO: it awards no XP. Saving attendance records who
// was present; awarding them is POST /api/events/[id]/award, deliberately a
// separate action because a manager needs to be able to correct the list before
// anything is paid out.
//
// The XP amount is resolved here, from the event's Handbook activity code, and
// returned so the page can show what attendance is worth. It is never accepted
// from the request.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventAttendance,
  getEventById,
  getMemberDirectory,
  setEventAttendance,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { getXpActivity } from '@/lib/xp/activities';

const eventIdSchema = z.string().uuid();

// A UUID check before anything reaches the database: comparing a non-uuid
// against a uuid column raises `invalid input syntax for type uuid`, which
// would surface as a 500 for what is really just an unknown URL.
function readEventId(value: string): string | null {
  const parsed = eventIdSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

// An array of uuids, bounded. The roster is a few dozen members; the bound is a
// guard against an unbounded body, not a statement about club size.
const saveSchema = z.strictObject({
  memberIds: z.array(z.string().uuid()).max(1000),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const eventId = readEventId(id);

    // A malformed id is an event that does not exist, not a server error.
    if (!eventId) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const [event, members, attendance] = await Promise.all([
      getEventById(eventId),
      getMemberDirectory(),
      getEventAttendance(eventId),
    ]);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // null from either read means the database failed - an empty roster or an
    // empty attendance list would come back as [].
    if (!members || !attendance) {
      console.error(
        'Error in GET /api/events/[id]/attendance: roster or attendance unavailable'
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // The amount comes from the Handbook, via the event's own activity code.
    // An event whose activity has since left the Handbook is still readable -
    // Phase 7A allows history to outlive a Handbook change - but cannot award,
    // which `awardable` states explicitly rather than leaving to be inferred
    // from a zero.
    const activity = getXpActivity(event.activityCode);

    return NextResponse.json({
      event,
      // Only the three fields the page needs. The directory carries emails and
      // totals; the page shows a name and an email and nothing else.
      members: members.map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        email: member.email,
      })),
      attendance: attendance.map((row) => ({
        memberId: row.memberId,
        xpLedgerId: row.xpLedgerId,
      })),
      xpAmount: activity?.xp ?? 0,
      activityLabel: activity?.label ?? event.activityCode,
      awardable: activity !== null,
    });
  } catch (error) {
    console.error('Error in GET /api/events/[id]/attendance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const eventId = readEventId(id);

    if (!eventId) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = saveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Checked explicitly so an unknown event is a 404 rather than the 500 the
    // function's own not-found assertion would produce.
    const event = await getEventById(eventId);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Phase 8A: an archived event is read-only, so attendance can no longer be
    // recorded against it. The existing rows are still readable - GET above is
    // deliberately unaffected - they just cannot be changed.
    if (event.archivedAt !== null) {
      return NextResponse.json({ error: 'Event is archived' }, { status: 409 });
    }

    const result = await setEventAttendance(eventId, parsed.data.memberIds);

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // The counts are reported rather than a bare ok: the page needs to tell the
    // manager that an already-awarded member was left on the event, because
    // otherwise the checkbox appears to have silently reverted.
    return NextResponse.json({
      added: result.added,
      removed: result.removed,
      keptAwarded: result.keptAwarded,
    });
  } catch (error) {
    console.error('Error in PUT /api/events/[id]/attendance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
