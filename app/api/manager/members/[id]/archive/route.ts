// Phase 8E: archive a member.
//
//   PATCH /api/manager/members/[id]/archive
//
// Manager-only, via lib/auth/require-manager.ts.
//
// ARCHIVING IS REVERSIBLE AND DESTROYS NOTHING. No XP row, attendance row or
// event is touched. It sets two columns on the member and nothing else - which
// is why this is a PATCH on the member and not a DELETE, and why there is no
// DELETE endpoint at all.
//
// It also does NOT revoke the member's sign-in. An archived member keeps their
// Supabase Auth account and can still sign in to read their own XP and history;
// they are hidden from the working lists and refused new XP, which is a
// different thing from being locked out. (`membership_status = 'inactive'` is
// the state that refuses sign-in, and this route deliberately does not set it.)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { archiveMember, getMemberProfile } from '@/lib/db/queries';
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

    // A manager must not archive themselves. It would hide them from the very
    // list they are standing on, and with only two managers in the club it is
    // easy to do by accident. The other manager can still do it, so this guards
    // against a mis-click rather than restricting the tool.
    if (memberId === auth.memberId) {
      return NextResponse.json(
        { error: 'You cannot archive your own account' },
        { status: 409 }
      );
    }

    // `auth.authUserId`, NOT `auth.memberId`. `archived_by` references
    // `auth.users(id)`, and a member id is a different uuid - writing it here
    // fails the foreign key and the archive never happens.
    const result = await archiveMember(memberId, auth.authUserId);

    if (result.ok) {
      return NextResponse.json({ ok: true, member: result.member });
    }

    if (result.outcome === 'failed') {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // The guarded UPDATE matched no row. Either the member does not exist, or
    // they are already archived - and those are different answers, so the
    // lookup is only made on this path rather than on every archive.
    const existing = await getMemberProfile(memberId);

    if (!existing || !existing.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Member is already archived' },
      { status: 409 }
    );
  } catch (error) {
    console.error('Error in PATCH /api/manager/members/[id]/archive:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
