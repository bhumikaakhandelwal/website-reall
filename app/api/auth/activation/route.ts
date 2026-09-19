// Phase 8D: first-time self-activation.
//
//   POST /api/auth/activation   which of the four states is this email in?
//   PUT  /api/auth/activation   send that member a link to choose their password
//
// NO PASSWORD IS CREATED HERE. The member opens the emailed link and chooses
// their own; nothing in this route generates, receives or stores one.
//
// NO MASS EMAIL. This is only ever reached because somebody typed their own
// address on the login page. Nothing walks the roster, and the 42 existing
// members are untouched until each of them does this for themselves.
//
// ONLY MEMBERS MAY ACTIVATE. The email must already be in `members` - the
// application never creates a member here, so knowing an address is not enough
// to obtain an account. That check is the whole point of the endpoint.
//
// THESE ARE UNAUTHENTICATED, and they have to be: they are what a member uses
// BEFORE they can sign in. They are therefore rate-limited by Supabase's own
// email sending rather than by a session, and they reveal whether an address is
// a club member - which the login page has always revealed, and which the flow
// cannot work without.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMemberActivation, setMemberAuthUser } from '@/lib/db/queries';
import { inviteAuthUser, sendRecoveryEmail } from '@/lib/auth/supabase-auth';
import { normalizeEmail } from '@/lib/onboarding/roster';
import { resolveActivationStatus } from '@/lib/auth/activation';

const emailSchema = z.strictObject({ email: z.string().email() });

function readEmail(body: unknown): string | null {
  const parsed = emailSchema.safeParse(body);

  if (!parsed.success) return null;

  const email = normalizeEmail(parsed.data.email);

  return email.length > 0 ? email : null;
}

export async function POST(request: Request) {
  try {
    const email = readEmail(await request.json().catch(() => null));

    if (!email) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    const activation = await getMemberActivation(email);

    // resolveActivationStatus is the same function the login page uses, so the
    // page and this route cannot disagree about which state an address is in.
    const status = resolveActivationStatus({
      memberExists: activation !== null,
      membershipStatus: activation?.membershipStatus ?? null,
      hasAuthAccount: activation?.hasAuthAccount ?? false,
    });

    return NextResponse.json({ status });
  } catch (error) {
    console.error('Error in POST /api/auth/activation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const email = readEmail(await request.json().catch(() => null));

    if (!email) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    const activation = await getMemberActivation(email);

    if (!activation) {
      return NextResponse.json({ error: 'Not a member' }, { status: 403 });
    }

    // A deactivated member must not be handed a new way in. Checked here as
    // well as on the login page, because the page is not the enforcement.
    if (activation.membershipStatus === 'inactive') {
      return NextResponse.json(
        { error: 'Membership is inactive' },
        { status: 403 }
      );
    }

    const origin = new URL(request.url).origin;

    // Already activated: this is a forgotten password, not a first visit. The
    // member gets the same kind of email and the same next step, which is why
    // the response does not distinguish the two.
    if (activation.hasAuthAccount) {
      const recovery = await sendRecoveryEmail(email, origin);

      if (!recovery.ok) {
        console.error('Error sending recovery email:', recovery.message);
        return NextResponse.json(
          { error: 'Could not send the email' },
          { status: 502 }
        );
      }

      return NextResponse.json({ ok: true, alreadyActivated: true });
    }

    const invite = await inviteAuthUser(email, origin);

    // The one case the auth_user_id check cannot see: an account that exists in
    // Supabase but was never recorded here (created directly in the dashboard,
    // say). Fall back to a recovery email, which is the right email for someone
    // who already has an account.
    if (!invite.ok && invite.reason === 'already-registered') {
      const recovery = await sendRecoveryEmail(email, origin);

      if (!recovery.ok) {
        console.error('Error sending recovery email:', recovery.message);
        return NextResponse.json(
          { error: 'Could not send the email' },
          { status: 502 }
        );
      }

      return NextResponse.json({ ok: true, alreadyActivated: true });
    }

    if (!invite.ok) {
      console.error('Error inviting auth user:', invite.message);
      return NextResponse.json(
        { error: 'Could not send the email' },
        { status: 502 }
      );
    }

    // Record the link. This is what makes "has this member activated?" a fact
    // the application owns rather than something inferred from an error next
    // time. UNIQUE on the column is the structural guarantee that one member
    // cannot end up with two auth accounts.
    const recorded = await setMemberAuthUser(activation.memberId, invite.userId);

    if (!recorded) {
      // The account exists and the email has been sent, so this is not a
      // failure the member can act on - but the link is missing, which the
      // fallback above will handle on their next attempt. Logged loudly.
      console.error(
        `Failed to record auth_user_id for member ${activation.memberId}`
      );
    }

    return NextResponse.json({ ok: true, alreadyActivated: false });
  } catch (error) {
    console.error('Error in PUT /api/auth/activation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
