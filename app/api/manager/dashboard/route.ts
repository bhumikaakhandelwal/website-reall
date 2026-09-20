// Phase 5C: the manager dashboard.
//
// The same two server-side checks as GET /api/members, against the same signed
// session:
//
//   1. a verified session           -> 401 without one
//   2. that member is an XP manager -> 403 for everyone else
//
// The actor's email comes from the member record resolved from the session
// cookie, never from the request, so a caller cannot claim to be a manager. The
// allowlist is lib/xp/managers.ts - the same two addresses that may award XP
// and read the directory. There is still no role column and no general
// permission system: "may see the dashboard" is deliberately the same question
// as "may change XP", so there is one place to audit.
//
// A normal member gets 403, not an empty dashboard - the same reasoning as the
// directory: this is a manager tool, and a member who reaches the URL directly
// should learn that plainly rather than be shown zeroes.
//
// THREE READS, one response:
//
//   getMemberDirectory()          -> Total Members, Active Members
//   getMonthXpTotal(period)       -> XP Awarded This Month
//   getRecentXpEntries(10)        -> the recent-activity list
//
// The member counts come from the directory's own roster rather than a new
// COUNT function, so this page and /members can never disagree about how many
// members there are. `period` comes from istMonthPeriod() - the same UTC month
// the leaderboards use - so "this month" means one thing across the whole
// application.
//
// All three run on the service-role client behind functions granted to
// service_role alone (see the Phase 5C migration), which this route's session-
// and manager-gate is exactly what makes acceptable. They are issued in
// parallel: they are independent, and the dashboard is one page load.
//
// The response carries the period as well as the cards, so a client can show
// which window the figures describe without recomputing it - the same shape
// GET /api/leaderboard already returns.

import { NextResponse } from 'next/server';
import {
  getMemberDirectory,
  getMonthXpTotal,
  getRecentXpEntries,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { istMonthPeriod } from '@/lib/xp/leaderboards';
import { RECENT_ENTRY_LIMIT, summariseDashboard } from '@/lib/manager/dashboard';

export async function GET() {
  try {
    // Phase 8D: the shared gate, replacing this route's inlined copy of the
    // session and allowlist checks.
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    // The current month, as [start, end). Computed once, in UTC, and handed to
    // the database as an explicit range.
    const period = istMonthPeriod();

    const [members, monthXp, entries] = await Promise.all([
      getMemberDirectory(),
      getMonthXpTotal(period),
      getRecentXpEntries(RECENT_ENTRY_LIMIT),
    ]);

    // null means the read failed. An empty roster is [] and an empty month is
    // 0, so neither of those is mistaken for an error here - and neither is
    // mistaken for data.
    if (!members || monthXp === null || !entries) {
      console.error(
        'Error in GET /api/manager/dashboard: dashboard data unavailable'
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const { cards, recent } = summariseDashboard({
      members,
      monthXp,
      entries,
      period,
    });

    return NextResponse.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      cards,
      recent,
    });
  } catch (error) {
    console.error('Error in GET /api/manager/dashboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
