// Phase 1C: logout.
//
// Clears this application's own session cookie. Supabase Auth is not used by
// the approved-email login model, so there is no Supabase session to sign out
// of (see lib/auth/session.ts).

import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth/session';

export async function POST() {
  try {
    await clearSession();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in POST /api/auth/logout:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
