// Phase 8D: the manager's actions on one member.
//
//   POST /api/manager/members/[id]   { action: 'deactivate' | 'reactivate' | 'send-reset' }
//
// Manager-only, via lib/auth/require-manager.ts.
//
// NEVER A DELETE. The phase brief is explicit that members are not removed, and
// the database agrees: XP, attendance and event authorship all point at
// `members.id`, so deleting one would either destroy club history or be blocked
// by a foreign key. Deactivating is the existing mechanism - `membership_status`
// already allows 'pending', 'active' and 'inactive' - and it is reversible,
// which deletion is not.
//
// The auth account is deliberately left alone when a member is deactivated.
// Banning it would be a second, harder-to-reverse expression of the same fact,
// and the application already refuses an inactive member at the door
// (lib/auth/require-manager.ts) and at login.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMemberProfile, setMemberStatus } from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { sendRecoveryEmail } from '@/lib/auth/supabase-auth';

const bodySchema = z.strictObject({
  action: z.enum(['deactivate', 'reactivate', 'send-reset']),
});

const idSchema = z.string().uuid();

export async function POST(
  request: Request,
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

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const memberId = parsedId.data;
    const { action } = parsed.data;

    const member = await getMemberProfile(memberId);

    if (!member || !member.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // A manager must not be able to deactivate themselves. It would lock them
    // out of the very page they are standing on, and with only two managers in
    // the club it is not hard to do by accident. The other manager can still do
    // it, so this is a guard against a mis-click, not a restriction of the tool.
    if (action === 'deactivate' && memberId === auth.memberId) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account' },
        { status: 409 }
      );
    }

    if (action === 'send-reset') {
      const result = await sendRecoveryEmail(
        member.data.email,
        new URL(request.url).origin
      );

      if (!result.ok) {
        console.error('Error sending recovery email:', result.message);
        return NextResponse.json(
          { error: 'Could not send the email' },
          { status: 502 }
        );
      }

      return NextResponse.json({ ok: true, action });
    }

    const status = action === 'deactivate' ? 'inactive' : 'active';

    const changed = await setMemberStatus(memberId, status);

    if (!changed) {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, action, status });
  } catch (error) {
    console.error('Error in POST /api/manager/members/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
