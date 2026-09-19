// Phase 8E: restore an archived member.
//
//   PATCH /api/manager/members/[id]/restore
//
// Manager-only, via lib/auth/require-manager.ts.
//
// IDEMPOTENT, in the same way Phase 8A's event archive is: the UPDATE only
// matches a row that IS archived, so restoring an active member changes nothing
// rather than stamping a restore that never happened. A second click, or two
// managers clicking at once, cannot corrupt the state.
//
// RESTORING RE-AWARDS NOTHING. The member's XP, attendance and event history
// were never removed, so there is nothing to put back - and re-awarding
// Membership XP here would be exactly the double-award the ledger is designed
// against. This clears two columns and stops.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMemberProfile, restoreMember } from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';

const idSchema = z.string().uuid();

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const parsedId = idSchema.safeParse(id);

    if (!parsedId.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const memberId = parsedId.data;

    const result = await restoreMember(memberId);

    if (result.ok) {
      return NextResponse.json({ ok: true, member: result.member });
    }

    if (result.outcome === 'failed') {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // Matched no row: either no such member, or they are already active.
    const existing = await getMemberProfile(memberId);

    if (!existing || !existing.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Member is already active' },
      { status: 409 }
    );
  } catch (error) {
    console.error('Error in PATCH /api/manager/members/[id]/restore:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
