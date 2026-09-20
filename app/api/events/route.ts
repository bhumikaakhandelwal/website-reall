// Phase 7A: the event foundation.
//
//   GET  /api/events   list every event, newest first
//   POST /api/events   create one event
//
// The same two server-side checks as every other manager tool in this
// application, against the same signed session:
//
//   1. a verified session           -> 401 without one
//   2. that member is an XP manager -> 403 for everyone else
//
// The actor's email comes from the member record resolved from the session
// cookie, never from the request, so a caller cannot claim to be a manager. The
// allowlist is lib/xp/managers.ts - the same two addresses that may award XP,
// read the directory and see the dashboard. There is still no role column and no
// general permission system.
//
// A normal member gets 403, not an empty list - the same reasoning as /members
// and /manager: this is a manager tool, and a member who reaches the URL
// directly should learn that plainly.
//
// Both verbs run on the service-role client behind tables that RLS denies to
// every browser-facing role (the Phase 7A migration enables RLS on `events` and
// `attendance` with NO policy). This route's session- and manager-gate is what
// makes that acceptable, exactly as with /api/members.
//
// WHAT THIS ROUTE DOES NOT DO: it writes no XP. Creating an event records the
// event; awarding the members who attended it is Phase 7B and is deliberately
// not implemented. In particular the request body carries no XP amount - an
// event names a Handbook activity CODE, and the amount is resolved from
// lib/xp/activities.ts at award time, so a client can never choose a value.

import { NextResponse } from 'next/server';
import { createEvent, getEvents } from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { getXpActivity } from '@/lib/xp/activities';
import { eventBodySchema } from '@/lib/events/request';

// Phase 8D: this route used to carry its own `authorize()` - a copy of the
// session and allowlist checks against the Phase 1C cookie. Replacing that
// session meant touching every one of these anyway, so the copy is gone and the
// shared gate in lib/auth/require-manager.ts is used directly.

export async function GET() {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const events = await getEvents();

    // null means the read failed. An empty list is [], so it is not mistaken
    // for an error - and an error is not mistaken for "no events yet".
    if (!events) {
      console.error('Error in GET /api/events: event list unavailable');
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error in GET /api/events:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = eventBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // The activity code must be a real Handbook activity. Checked here rather
    // than by a CHECK constraint so lib/xp/activities.ts stays the single
    // source of truth - the same arrangement POST /api/xp/award uses.
    if (!getXpActivity(parsed.data.activityCode)) {
      return NextResponse.json(
        { error: 'Unknown activity code' },
        { status: 400 }
      );
    }

    const result = await createEvent({
      title: parsed.data.title,
      eventType: parsed.data.eventType,
      eventDate: parsed.data.eventDate,
      activityCode: parsed.data.activityCode,
      // From the session, never from the request.
      createdBy: auth.memberId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/events:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
