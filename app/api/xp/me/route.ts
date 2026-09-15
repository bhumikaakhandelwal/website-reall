// Phase 3: the authenticated member's own XP and level.
//
// Identity comes from the signed session cookie only. There is deliberately no
// `?memberId=` parameter and no path segment naming a member: a member can read
// exactly one member's XP through this endpoint, their own. Manager-only views
// of another member's XP are not part of this API.
//
// Total XP is summed from xp_ledger on every request (get_member_xp_total) and
// the level is derived from the `levels` table (get_all_levels) - there is no
// stored total and no hardcoded level table in application code.
//
// The XP sum is the one read in this app that is NOT client-reachable: the RPC
// behind it accepts an arbitrary member id and is granted to service_role
// alone, so this route is the only way to obtain a total, and the id it passes
// always comes from the verified session (see lib/db/queries.ts).

import { NextResponse } from 'next/server';
import { getMemberProfile, getMemberXP, getAllLevels } from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/auth/session';
import { resolveLevel } from '@/lib/xp/levels';

export async function GET() {
  try {
    const memberId = await getSessionMemberId();

    if (!memberId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [member, totalXp, levels] = await Promise.all([
      getMemberProfile(memberId),
      getMemberXP(memberId),
      getAllLevels(),
    ]);

    if (!member || !member.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // null means the sum could not be read (a genuine zero comes back as 0),
    // so it is an error rather than a default.
    if (totalXp === null || !levels || levels.length === 0) {
      console.error('Error in GET /api/xp/me: XP or level data unavailable');
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const progress = resolveLevel(totalXp, levels);

    return NextResponse.json({
      memberId: member.data.id,
      totalXp,
      level: progress.level,
      levelName: progress.title,
      nextLevelXp: progress.nextLevelXp,
    });
  } catch (error) {
    console.error('Error in GET /api/xp/me:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
