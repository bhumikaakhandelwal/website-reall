// Phase 8D: the "Forgot password" request.
//
//   POST /api/auth/reset   send a reset link for an email
//
// UNAUTHENTICATED, because the whole point is that the member cannot sign in.
//
// THE RESPONSE IS THE SAME WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT. Answering
// differently would turn this into a way to discover who is a club member, and
// it is reachable by anyone. That is the one place this differs from the login
// route, which does say when an address is not a member - there the member is
// standing at a form that has to tell them what to do next, and the flow cannot
// work without it.
//
// No password is involved. Supabase sends the link; the member chooses a new
// password from it.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendRecoveryEmail } from '@/lib/auth/supabase-auth';
import { normalizeEmail } from '@/lib/onboarding/roster';

const bodySchema = z.strictObject({ email: z.string().email() });

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    const email = normalizeEmail(parsed.data.email);

    const result = await sendRecoveryEmail(email, new URL(request.url).origin);

    if (!result.ok) {
      // Logged, not surfaced. Telling the caller that this particular address
      // failed would leak which addresses exist.
      console.error('Error sending recovery email:', result.message);
    }

    // Always the same answer, and always 200. Supabase itself does not reveal
    // whether an address has an account, and neither does this.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in POST /api/auth/reset:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
