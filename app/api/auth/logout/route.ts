// Phase 8D: logout, now a real Supabase Auth sign-out.
//
// Until this phase there was nothing to sign out of but this application's own
// cookie - the Phase 1C login created no Supabase session. Supabase Auth owns
// the session now, so signing out has to revoke it there; `@supabase/ssr`
// clears the auth cookies as part of it.
//
// The Phase 1C cookie is cleared too, belt and braces: nothing reads it any
// more, but anyone who signed in before this phase still has one, and leaving
// it behind for the rest of its seven days would be untidy.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { LEGACY_SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function POST() {
  try {
    const supabase = await createServerClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Error signing out of Supabase Auth:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const cookieStore = await cookies();
    cookieStore.delete(LEGACY_SESSION_COOKIE_NAME);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in POST /api/auth/logout:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
