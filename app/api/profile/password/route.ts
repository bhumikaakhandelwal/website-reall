// Phase 8D: change your own password.
//
//   POST /api/profile/password
//
// Authenticated, but NOT manager-only: every member manages their own password.
//
// The member is identified by their session and by nothing else. The request
// body carries only the new password - there is no member id in it, so one
// member cannot change another's password by naming them, and no manager can
// change a member's password through this route.
//
// NOTHING IS STORED HERE. The password is handed straight to Supabase's own
// password API and never written, logged, hashed or compared by this
// application. The one thing this route does with it is pass it on.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/require-manager';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/profile/security';

// The same bounds the form uses. Supabase enforces its own policy as well; this
// is the early, friendly rejection.
const bodySchema = z.strictObject({
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export async function POST(request: Request) {
  try {
    const auth = await requireMember();

    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Password does not meet the requirements' },
        { status: 400 }
      );
    }

    const supabase = await createServerClient();

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      // The message is Supabase's and may mention its own policy, so it is
      // logged rather than echoed - a member does not need the internal reason,
      // and it could hint at what a valid password looks like.
      console.error('Error updating password:', error);

      return NextResponse.json(
        { error: 'Password was not accepted' },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in POST /api/profile/password:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
