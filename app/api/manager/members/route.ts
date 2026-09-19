// Phase 8D: add a member.
//
//   POST /api/manager/members
//
// Manager-only, via lib/auth/require-manager.ts.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not create a Supabase Auth account
// and it does not send an invitation. The new member activates themselves from
// the login page, exactly like the 42 members who came before them. That is what
// keeps onboarding from emailing somebody who has not asked for anything, and it
// means there is one activation path rather than two.
//
// The membership XP goes through createXpLedgerEntry - the same single write
// path the Award XP panel and the event award use - with the same activity code,
// amount and reason constants the roster import uses. The ledger stays
// append-only: this adds a row, and nothing here can edit or remove one.
//
// The member row is created FIRST and the XP is awarded second. If the award
// fails the member still exists, so the response says so rather than reporting a
// failure that would send the manager looking for a member who is already there.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createMember,
  createXpLedgerEntry,
  getActiveMembers,
  getArchivedMembers,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { normalizeEmail, normalizeName } from '@/lib/onboarding/roster';
import {
  MEMBERSHIP_ACTIVITY_CODE,
  MEMBERSHIP_REASON,
  MEMBERSHIP_XP,
} from '@/lib/onboarding/roster';

const bodySchema = z.strictObject({
  displayName: z.string(),
  email: z.string(),
});

/** Today, in UTC, as 'YYYY-MM-DD' - what the roster import used. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Phase 8E: the member lifecycle page's read.
//
// BOTH HALVES COME FROM THE ONE ROSTER READ. `getActiveMembers` and
// `getArchivedMembers` are two views of `get_member_directory`, so this page and
// the member directory cannot disagree about who is on the roster - a member
// cannot appear in both lists, or in neither.
//
// READ-ONLY. Archiving and restoring are PATCHes on their own paths.
export async function GET() {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const [active, archived] = await Promise.all([
      getActiveMembers(),
      getArchivedMembers(),
    ]);

    // null means the roster read failed. An empty roster is [], so it is not
    // mistaken for an error - and an error is not mistaken for a club with no
    // members.
    if (!active || !archived) {
      console.error('Error in GET /api/manager/members: roster unavailable');
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ active, archived, viewerId: auth.memberId });
  } catch (error) {
    console.error('Error in GET /api/manager/members:', error);
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
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const displayName = normalizeName(parsed.data.displayName);
    const email = normalizeEmail(parsed.data.email);

    // Shape only. The length bounds and the email rule are enforced by the form
    // through lib/members/onboarding.ts, and `members` has its own constraints;
    // this is the backstop for a caller that skipped the form.
    if (displayName.length === 0 || email.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const created = await createMember({
      displayName,
      email,
      // 'active' immediately: the manager vouching for them IS the gate, the
      // same as for the 42 members the roster import added. 'pending' exists but
      // nothing sets it, and a pending member would be missing from the
      // leaderboard while already holding Membership XP - which is worse than
      // the alternative.
      membershipStatus: 'active',
      membershipStart: todayUtc(),
    });

    if (!created.ok) {
      // A UNIQUE violation on members.email. 409 rather than 500 so the page can
      // say "already on the list" instead of "something went wrong".
      if (created.duplicate) {
        // Phase 8E: an archived member is NOT a plain duplicate.
        //
        // The address is taken by somebody still on the books, and the right
        // answer is to restore them - re-adding would either fail on the UNIQUE
        // index or, worse, create a second member for one person. So the manager
        // is told which of the two it is. (`members.email` stays UNIQUE: it is
        // the roster's identity key, and dropping it would let one person hold
        // two member rows and two XP histories.)
        const archived = await getArchivedMembers();

        const match = archived?.find((member) => member.email === email);

        return NextResponse.json(
          {
            error: match ? 'Member is archived' : 'Email already exists',
            memberId: match?.memberId ?? null,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const awarded = await createXpLedgerEntry({
      memberId: created.memberId,
      xpAmount: MEMBERSHIP_XP,
      activityCode: MEMBERSHIP_ACTIVITY_CODE,
      reason: MEMBERSHIP_REASON,
    });

    if (!awarded.ok) {
      // The member exists, so this is not a failure of the request - but the
      // Membership entry is missing, which a manager has to know about. Reported
      // in the payload rather than as a 500, because a 500 would say nothing was
      // created when something was.
      console.error(
        `Membership XP was not awarded for new member ${created.memberId}`
      );

      return NextResponse.json(
        { ok: true, memberId: created.memberId, xpAwarded: false },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { ok: true, memberId: created.memberId, xpAwarded: true },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/manager/members:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
