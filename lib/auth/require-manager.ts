// The authorization gates, in one place.
//
// Every protected endpoint in this application asks one of two questions, and
// both are answered here so there is exactly one answer to each:
//
//   requireMember()      - is somebody signed in, and is their membership live?
//   requireXpManager()   - ...and are they one of the two XP managers?
//
// A session says WHO someone is; it never says what they may do. Supabase Auth
// establishes the first; these establish the second.
//
// PHASE 8D MIGRATED THE LAST HOLD-OUTS. When this helper was added in Phase 7B
// only the two new event routes used it, and /api/members,
// /api/manager/dashboard, /api/xp/award and /api/events still inlined the same
// three steps against the old custom session. Replacing that session meant
// touching all of them anyway, so they now share this gate too - which is why
// there is no longer a second copy of the manager check to drift out of step.
//
// The actor's email comes from the member record resolved from the verified
// Supabase session, never from the request, so a caller cannot claim to be a
// manager.

import { NextResponse } from 'next/server';
import { getSessionMember, isActiveMember, type SessionMember } from '@/lib/auth/session';
import { isXpManager } from '@/lib/xp/managers';

export type MemberAuth =
  | { ok: true; member: SessionMember }
  | { ok: false; response: NextResponse };

export type ManagerAuth =
  | {
      ok: true;
      /** The `members.id` every club table points at. */
      memberId: string;
      /**
       * The Supabase Auth user id. NOT the same value as memberId, and the two
       * are not interchangeable: columns that reference `auth.users(id)` - such
       * as `members.archived_by` - need THIS one. Passing memberId there is a
       * foreign-key violation, which is exactly what Phase 8E's first archive
       * attempt hit.
       */
      authUserId: string;
      email: string;
    }
  | { ok: false; response: NextResponse };

const UNAUTHORIZED = { error: 'Unauthorized' };
const FORBIDDEN = { error: 'Forbidden' };
const INACTIVE = { error: 'Membership is inactive' };

/**
 * Resolves the verified Supabase session to a member whose membership is live.
 *
 * On failure the caller must return `response` unchanged - it is already the
 * right 401 or 403, and returning it is what keeps every protected endpoint
 * answering identically.
 *
 * A deactivated member gets 403 with a distinct error body, not 401. They ARE
 * signed in - telling them their session ended would be a lie, and would send
 * them round a login loop that cannot succeed.
 */
export async function requireMember(): Promise<MemberAuth> {
  const member = await getSessionMember();

  if (!member) {
    return { ok: false, response: NextResponse.json(UNAUTHORIZED, { status: 401 }) };
  }

  if (!isActiveMember(member)) {
    return { ok: false, response: NextResponse.json(INACTIVE, { status: 403 }) };
  }

  return { ok: true, member };
}

/**
 * Resolves the verified session to one of the two XP managers.
 *
 * Checks the membership status first, so a deactivated manager is refused even
 * if their address is still on the allowlist - deactivation has to mean
 * something for managers too.
 */
export async function requireXpManager(): Promise<ManagerAuth> {
  const auth = await requireMember();

  if (!auth.ok) return auth;

  if (!isXpManager(auth.member.email)) {
    return { ok: false, response: NextResponse.json(FORBIDDEN, { status: 403 }) };
  }

  return {
    ok: true,
    memberId: auth.member.memberId,
    authUserId: auth.member.authUserId,
    email: auth.member.email,
  };
}
