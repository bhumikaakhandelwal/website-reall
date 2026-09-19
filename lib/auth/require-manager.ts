// The manager gate, in one place.
//
// Every manager-only endpoint in this application performs the same two
// server-side checks against the same signed session:
//
//   1. a verified session            -> 401 without one
//   2. that member is an XP manager  -> 403 for everyone else
//
// The actor's email comes from the member record resolved from the session
// cookie, never from the request, so a caller cannot claim to be a manager.
//
// This helper exists because Phase 7B added the fifth and sixth manager-only
// endpoint, and six copies of a security check is six chances for one to drift.
// The allowlist itself was always shared (lib/xp/managers.ts); this shares the
// plumbing around it.
//
// NOT YET USED EVERYWHERE. /api/members, /api/manager/dashboard, /api/xp/award
// and /api/events still inline the same three steps. They are covered by tests
// and were deliberately left alone rather than refactored inside a feature
// phase; migrating them is a mechanical follow-up. New endpoints should use
// this.

import { NextResponse } from 'next/server';
import { getMemberProfile } from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/auth/session';
import { isXpManager } from '@/lib/xp/managers';

export type ManagerAuth =
  | { ok: true; memberId: string; email: string }
  | { ok: false; response: NextResponse };

/**
 * Resolves the signed session to a verified XP manager.
 *
 * On failure the caller must return `response` unchanged - it is already the
 * right 401 or 403, and returning it is what keeps every manager-only endpoint
 * answering identically.
 */
export async function requireXpManager(): Promise<ManagerAuth> {
  const actorId = await getSessionMemberId();

  if (!actorId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const actor = await getMemberProfile(actorId);

  if (!actor || !actor.success) {
    // The cookie is signed and unexpired but no longer maps to a member.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (!isXpManager(actor.data.email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, memberId: actor.data.id, email: actor.data.email };
}
