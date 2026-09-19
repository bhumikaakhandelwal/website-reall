// Phase 8B: event analytics.
//
//   GET /api/manager/analytics
//
// Manager-only, via lib/auth/require-manager.ts - the same two checks as every
// other manager tool: a verified session (401) and an XP manager (403).
//
// READ-ONLY, and structurally so. This route issues two reads and no writes, and
// the function behind the second one is STABLE and performs no write either.
// There is no write path reachable from this page.
//
// TWO READS, one response:
//
//   getEvents()                     -> which events exist, with titles, types,
//                                      dates and archive state
//   getEventAttendanceTotals()      -> per event, how many attended and how much
//                                      XP that attendance awarded
//
// The first is the EXISTING event read, reused rather than duplicated: it is
// already the one definition of "the events", so the analytics page and the
// register cannot disagree about how many there are. The second is the one
// aggregate that cannot be derived cheaply in application code, because it sums
// across a join into a table that grows without bound.
//
// The aggregation itself happens here, in lib/events/analytics.ts, which is a
// plain module this project's tests can reach. The alternative - sending the raw
// rows and aggregating in the browser - would put untestable arithmetic in a
// component.
//
// NO ARCHIVE FILTER. Analytics cover the club's whole history; an archived event
// is still history, and excluding it would quietly shrink every figure.

import { NextResponse } from 'next/server';
import {
  getEventAttendanceTotals,
  getEvents,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { summariseAnalytics } from '@/lib/events/analytics';

export async function GET() {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const [events, totals] = await Promise.all([
      getEvents(),
      getEventAttendanceTotals(),
    ]);

    // null means the read failed. An empty event list is [], so it is not
    // mistaken for an error - and an error is not mistaken for a club that has
    // never run an event, which is what an all-zero page would say.
    if (!events || !totals) {
      console.error(
        'Error in GET /api/manager/analytics: event or attendance data unavailable'
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json(summariseAnalytics(events, totals));
  } catch (error) {
    console.error('Error in GET /api/manager/analytics:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
