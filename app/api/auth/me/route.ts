// Phase 1C: current member for the active application session.
//
// Phase 1B read this from a Supabase Auth session. The approved-email login
// model does not create one, so this now reads the signed application session
// cookie instead and verifies it server-side. Response shape and status codes
// (401 / 404 / 500) are unchanged.

import { NextResponse } from 'next/server';
import { getMemberProfile } from '@/lib/db/queries';
import { getSessionMember } from '@/lib/auth/session';

export async function GET() {
  try {
    // Phase 8D: the member is resolved from the verified Supabase Auth session.
    // A client-supplied member id is never trusted, and never was.
    const member = await getSessionMember();

    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Safe, minimal fields only (validated against memberSchema). The full
    // profile is read rather than built from the session so this response keeps
    // exactly the shape it had before the session changed.
    const profile = await getMemberProfile(member.memberId);

    if (!profile || !profile.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json({ user: profile.data });
  } catch (error) {
    console.error('Error in GET /api/auth/me:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
