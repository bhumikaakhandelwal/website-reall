// Phase 4: the three monthly leaderboards.
//
// One endpoint, one request: the Handbook defines exactly three leaderboards,
// the page shows all three, and each is a handful of rows. A `?type=` parameter
// would add surface without adding anything the caller cannot get here.
//
// Authorization mirrors GET /api/xp/me: the signed session cookie is the only
// identity source, and no session means 401. A leaderboard is a view of other
// members' XP, so it is deliberately NOT public and NOT reachable with the
// publishable key alone - the aggregation function behind it is granted to
// service_role only (see the Phase 4 migration), and this route is the only
// thing that calls it.
//
// Values are derived from xp_ledger through a database-side GROUP BY: nothing
// loads ledger rows into application memory, and there is no stored total or
// leaderboard table to drift from the audit trail. Ranking is the caller's job
// (assignRanks in lib/xp/leaderboards.ts, via the shared module below).

import { NextResponse } from 'next/server';
import { getMonthlyLeaderboard } from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/auth/session';
import { LEADERBOARDS, assignRanks, utcMonthPeriod } from '@/lib/xp/leaderboards';

export async function GET() {
  try {
    const memberId = await getSessionMemberId();

    if (!memberId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The current leaderboard month, as [start, end). Both bounds are computed
    // once, in UTC, and handed to the database as an explicit range.
    const period = utcMonthPeriod();

    // One query per Handbook leaderboard, each restricted to its own activity
    // codes (null = every activity, for the overall board).
    const results = await Promise.all(
      LEADERBOARDS.map((board) =>
        getMonthlyLeaderboard(period, board.activityCodes)
      )
    );

    if (results.some((rows) => rows === null)) {
      console.error(
        'Error in GET /api/leaderboard: leaderboard aggregation unavailable'
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      boards: LEADERBOARDS.map((board, index) => ({
        id: board.id,
        // Rows arrive XP-ordered by the database; this only numbers them.
        entries: assignRanks(results[index] ?? []),
      })),
    });
  } catch (error) {
    console.error('Error in GET /api/leaderboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
