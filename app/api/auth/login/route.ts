// Phase 8D: email + password login, backed by Supabase Auth.
//
// REPLACES the Phase 1C approved-email login, which proved only that the caller
// knew an approved address: there was no password, no OTP and no verification.
// Supabase Auth now owns the credential and the session, and `@supabase/ssr`
// writes the auth cookies from this handler.
//
// THE MEMBERSHIP CHECK COMES FIRST, before Supabase is contacted at all, and it
// is deliberate:
//
//   * it preserves the message the login page has always shown a non-member
//     ("Email is not on the approved members list"), rather than replacing it
//     with a generic "invalid credentials" that would send a real member to ask
//     a manager about a membership they already have;
//   * it means an address that is not a member never reaches Supabase Auth, so
//     no account can exist for a non-member even by accident.
//
// It does mean this endpoint reveals whether an address is a club member. That
// was already true of the Phase 1C login, and the activation flow depends on it
// (the login page has to know whether to offer "create your password"), so it is
// accepted rather than newly introduced.
//
// A DEACTIVATED MEMBER IS REFUSED HERE. The gate in lib/auth/require-manager.ts
// refuses them too, but failing at the door gives them a sentence that explains
// what happened instead of a signed-in page that mysteriously 403s.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMemberProfile, lookupMemberIdByEmail } from '@/lib/db/queries';
import { createServerClient } from '@/lib/supabase/server';
import { LEGACY_SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { normalizeEmail } from '@/lib/onboarding/roster';
import { cookies } from 'next/headers';

const loginSchema = z.strictObject({
  email: z.string().email(),
  // Not length-checked beyond non-empty: Supabase owns the password policy, and
  // rejecting a short password here would tell an attacker which guesses are
  // structurally impossible. The password is never inspected, logged or stored.
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'An email address and password are required' },
        { status: 400 }
      );
    }

    const email = normalizeEmail(parsed.data.email);

    const memberId = await lookupMemberIdByEmail(email);

    if (!memberId) {
      return NextResponse.json(
        { error: 'Email is not on the approved members list' },
        { status: 401 }
      );
    }

    const member = await getMemberProfile(memberId);

    if (!member || !member.success) {
      return NextResponse.json(
        { error: 'Email is not on the approved members list' },
        { status: 401 }
      );
    }

    if (member.data.membership_status === 'inactive') {
      return NextResponse.json(
        { error: 'Membership is inactive' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });

    if (error || !data?.user) {
      // One message for every failure Supabase reports, so this cannot be used
      // to tell a wrong password from an address with no account.
      return NextResponse.json(
        { error: 'That email and password do not match' },
        { status: 401 }
      );
    }

    // Phase 8D removed the Phase 1C cookie. Anyone who was signed in under it
    // still has one in their browser; clearing it here stops it lingering for
    // the rest of its seven days now that nothing reads it.
    const cookieStore = await cookies();
    cookieStore.delete(LEGACY_SESSION_COOKIE_NAME);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
