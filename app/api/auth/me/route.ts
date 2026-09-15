// Phase 1C: current member for the active application session.
//
// Phase 1B read this from a Supabase Auth session. The approved-email login
// model does not create one, so this now reads the signed application session
// cookie instead and verifies it server-side. Response shape and status codes
// (401 / 404 / 500) are unchanged.

import { NextResponse } from 'next/server';
import { getMemberProfile } from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/auth/session';

export async function GET() {
  try {
    // The session cookie is the only identity source; a client-supplied
    // member id is never trusted.
    const memberId = await getSessionMemberId();

    if (!memberId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Safe, minimal fields only (validated against memberSchema).
    const member = await getMemberProfile(memberId);

    if (!member || !member.success) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json({ user: member.data });
  } catch (error) {
    console.error('Error in GET /api/auth/me:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
