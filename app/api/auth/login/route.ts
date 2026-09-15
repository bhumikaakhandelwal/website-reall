// Phase 1C: approved-email login.
//
// Identity model (intentional, documented in docs/BACKEND-IMPLEMENTATION-PLAN.md):
// knowing an approved email address is sufficient to log in. There is no
// password, OTP, magic link, OAuth, or email verification.
//
// This route does NOT create a Supabase Auth user or session. It verifies the
// email against the `members` allowlist and then establishes this
// application's own signed session cookie (see lib/auth/session.ts).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { lookupMemberIdByEmail } from '@/lib/db/queries';
import { createSession } from '@/lib/auth/session';

const emailSchema = z.string().email();

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = emailSchema.safeParse(body?.email);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    // Normalize before the allowlist lookup.
    const email = parsed.data.trim().toLowerCase();

    const memberId = await lookupMemberIdByEmail(email);

    // Not on the approved members list.
    if (!memberId) {
      return NextResponse.json(
        { error: 'Email is not on the approved members list' },
        { status: 401 }
      );
    }

    // Approved: establish the server-side session. Only the member id is
    // signed into the cookie — never the member's database record.
    await createSession(memberId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
