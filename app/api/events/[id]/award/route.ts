// Phase 7B: award XP to everyone recorded on one event.
//
//   POST /api/events/[id]/award
//
// Manager-only, via lib/auth/require-manager.ts: a verified session (401) and
// an XP manager (403), the same as every other manager endpoint.
//
// THIS IS THE SECOND ENDPOINT IN THE APPLICATION THAT WRITES XP. The first is
// POST /api/xp/award, which records one activity against one member. This one
// records one activity against every attendee of an event, which is why it goes
// through a database function rather than a loop of client calls: the ledger
// insert and the attendance link have to commit together, and the unawarded
// rows have to be locked so two managers clicking at once cannot double-award.
// See supabase/migrations/20260919000001_attendance_awards.sql.
//
// NO AMOUNT COMES FROM THE CLIENT. The request body is not read at all. The
// amount is resolved HERE, from the event's own Handbook activity code via
// lib/xp/activities.ts, which stays the single source of truth; the activity
// code and the reason are not even passed to the function, which reads them
// from the event row. A manager's action carries no number end to end.
//
// IDEMPOTENT. The function awards only rows whose attendance.xp_ledger_id IS
// NULL, so a second call awards nobody and reports zero. Zero is a success, not
// an error - it is what the page shows when a manager clicks twice.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  awardEventAttendance,
  getEventById,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { getXpActivity } from '@/lib/xp/activities';

const eventIdSchema = z.string().uuid();

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

    // The event is read first for two reasons: to answer 404 for an unknown id,
    // and because its activity code is what the amount is resolved from.
    const event = await getEventById(eventId);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Phase 8A: an archived event is read-only, so no further XP can be awarded
    // against it. Checked here rather than inside award_event_attendance, which
    // would mean duplicating that function's body in a new migration to add one
    // condition - and this route is the only caller of a function granted to
    // service_role alone.
    //
    // XP already awarded is untouched: archiving an event never reverses it, and
    // reversing an entry is a correction (a new negative row), not a deletion.
    if (event.archivedAt !== null) {
      return NextResponse.json({ error: 'Event is archived' }, { status: 409 });
    }

    const activity = getXpActivity(event.activityCode);

    // An event whose activity has left the Handbook has no amount to award.
    // Refused with a 400 rather than awarding a guess.
    if (!activity) {
      return NextResponse.json(
        { error: 'Unknown activity code' },
        { status: 400 }
      );
    }

    const result = await awardEventAttendance(eventId, activity.xp);

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // 200, not 201: awarding is idempotent and a second call reports zero
    // awarded without having created anything. `awarded: 0` is the honest
    // answer to "did anything change?", and the page renders it as such.
    return NextResponse.json({
      ok: true,
      awarded: result.awarded,
      xpAmount: activity.xp,
      activityLabel: activity.label,
    });
  } catch (error) {
    console.error('Error in POST /api/events/[id]/award:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
