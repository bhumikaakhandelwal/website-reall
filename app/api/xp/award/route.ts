// Phase 3: the single protected XP management operation.
//
// Only the two XP managers (lib/xp/managers.ts) may call this. Everyone else -
// including other council members - gets 403. An unauthenticated caller gets
// 401. The actor's email is read from the verified signed session, never from
// the request body, so a caller cannot claim to be a manager.
//
// Two request shapes are accepted, and they are mutually exclusive:
//
//   Award an activity   { "memberId": "<uuid>", "activityCode": "github-project" }
//   Correct a mistake   { "memberId": "<uuid>", "correctionXp": -50, "reason": "..." }
//
// For an award the XP amount is NEVER taken from the request - the client sends
// only the handbook activity code and the server resolves the amount from
// lib/xp/activities.ts. Corrections are the one place a signed amount is
// supplied, because a correction is by definition an off-handbook adjustment;
// they require a reason and are appended as new ledger rows, so the original
// entry and the correction both remain in the audit trail.
//
// This is the only endpoint in the application that performs a service-role XP
// WRITE, and it does so solely through createXpLedgerEntry after the checks
// above. (/api/xp/me also reaches the service-role client, but only for the
// private XP read.) There is no general-purpose admin API.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createXpLedgerEntry,
  getMemberProfile,
  type XpLedgerWrite,
} from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/auth/session';
import { getXpActivity } from '@/lib/xp/activities';
import { isXpManager } from '@/lib/xp/managers';

const awardSchema = z.strictObject({
  memberId: z.string().uuid(),
  activityCode: z.string().min(1).max(64),
});

const correctionSchema = z.strictObject({
  memberId: z.string().uuid(),
  // Signed: negative reverses XP, positive adds it. Bounded so a typo cannot
  // hand out or erase an unbounded amount in one entry.
  correctionXp: z
    .number()
    .int()
    .min(-1000)
    .max(1000)
    .refine((value) => value !== 0, 'Correction must not be zero'),
  reason: z.string().trim().min(1).max(500),
});

const requestSchema = z.union([awardSchema, correctionSchema]);

export async function POST(request: Request) {
  try {
    const actorId = await getSessionMemberId();

    if (!actorId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actor = await getMemberProfile(actorId);

    if (!actor || !actor.success) {
      // The cookie is signed and unexpired but no longer maps to a member.
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization. The email comes from the member record resolved from the
    // session, so it cannot be spoofed by the caller.
    if (!isXpManager(actor.data.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    let entry: XpLedgerWrite;

    if ('activityCode' in parsed.data) {
      const activity = getXpActivity(parsed.data.activityCode);

      if (!activity) {
        return NextResponse.json(
          { error: 'Unknown activity code' },
          { status: 400 }
        );
      }

      entry = {
        memberId: parsed.data.memberId,
        xpAmount: activity.xp,
        activityCode: activity.code,
        reason: activity.label,
      };
    } else {
      entry = {
        memberId: parsed.data.memberId,
        xpAmount: parsed.data.correctionXp,
        activityCode: null,
        reason: parsed.data.reason,
      };
    }

    const result = await createXpLedgerEntry(entry);

    if (!result.ok) {
      if (result.memberNotFound) {
        return NextResponse.json(
          { error: 'Member not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        memberId: entry.memberId,
        xpAmount: entry.xpAmount,
        activityCode: entry.activityCode,
        reason: entry.reason,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/xp/award:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
