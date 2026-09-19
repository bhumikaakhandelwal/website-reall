// Phase 5A: the member directory.
//
// The FIRST endpoint in this application that returns other members' data, so
// its authorization is the whole point of it. Two independent checks, both
// server-side against the signed session:
//
//   1. a verified session          -> 401 without one
//   2. that member is an XP manager -> 403 for everyone else
//
// The actor's email comes from the member record resolved from the session
// cookie, never from the request, so a caller cannot claim to be a manager. The
// allowlist is lib/xp/managers.ts - the same two addresses that may award XP.
// There is still no role column, no `isAdmin` flag, and no general permission
// system: "may see the roster" is deliberately the same question as "may change
// XP", so there is one place to audit.
//
// A normal member gets 403, not an empty list. The directory is not a
// member-facing feature with a hidden section; it is a manager tool, and a
// member who reaches this URL directly should learn that plainly.
//
// Levels are derived here (resolveLevel over get_all_levels) rather than in
// SQL, so the directory, /api/xp/me and the leaderboard all agree on what level
// a given total is. The read itself runs on the service-role client because the
// function behind it is granted to service_role alone (see the Phase 5A
// migration) - this route being session- and manager-gated is exactly what
// makes that acceptable.

import { NextResponse } from 'next/server';
import { getActiveMembers, getAllLevels } from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { resolveLevel } from '@/lib/xp/levels';

export async function GET() {
  try {
    // Phase 8D: the shared gate. This route used to inline the session and
    // allowlist checks against the Phase 1C cookie; replacing that session
    // meant touching it anyway, so it now shares lib/auth/require-manager.ts.
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const [rows, levels] = await Promise.all([
      getActiveMembers(),
      getAllLevels(),
    ]);

    // null means the read failed (a genuinely empty roster would come back as
    // []), and an unseeded `levels` table makes the level column meaningless -
    // both are errors, not an empty directory.
    if (!rows || !levels || levels.length === 0) {
      console.error(
        'Error in GET /api/members: directory or level data unavailable'
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      entries: rows.map((row) => {
        const progress = resolveLevel(row.totalXp, levels);

        return {
          memberId: row.memberId,
          email: row.email,
          displayName: row.displayName,
          membershipStatus: row.membershipStatus,
          joinedAt: row.joinedAt,
          totalXp: row.totalXp,
          level: progress.level,
          levelName: progress.title,
        };
      }),
    });
  } catch (error) {
    console.error('Error in GET /api/members:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
