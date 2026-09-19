// Phase 8D: the application session, now backed by Supabase Auth.
//
// THIS REPLACES the Phase 1C custom session entirely. Until this phase the
// application kept its own signed cookie (`dbce_session`) holding a member id,
// and login consisted of proving you knew an approved email address - there was
// no password, no OTP, no email verification, and no Supabase Auth user at all.
// That cookie, its HMAC signing, and the SESSION_SECRET it depended on are gone.
//
// WHAT REPLACED IT
//
// Supabase Auth owns the credential and the session. `@supabase/ssr` stores the
// auth cookies, and this module answers the one question the rest of the
// application asks: given the current request, WHICH MEMBER IS THIS?
//
// The answer is resolved in two steps:
//
//   1. Supabase Auth verifies the session and gives us the signed-in user.
//   2. That user's email is matched against `members` through
//      lookup_member_id_by_email - the SECURITY DEFINER function the Phase 1C
//      login already used, reused here rather than replaced.
//
// WHY EMAIL IS THE LINK, and not members.auth_user_id: `members.email` is
// UNIQUE, and the only way to obtain an auth account is the activation flow,
// which refuses any address that is not already a member. So the two can never
// disagree. `auth_user_id` is kept for what it is actually for - knowing whether
// a member has activated - rather than being a second, redundant way to resolve
// the same identity that could drift from the first.
//
// A SESSION IS NOT AN AUTHORIZATION. Being signed in says who someone is, not
// what they may do. Every caller must still check the membership status and, for
// manager tools, the manager allowlist - see lib/auth/require-manager.ts.

import { createServerClient } from '@/lib/supabase/server';
import { getMemberProfile, lookupMemberIdByEmail } from '@/lib/db/queries';
import { normalizeEmail } from '@/lib/onboarding/roster';

export type MembershipStatus = 'pending' | 'active' | 'inactive';

export type SessionMember = {
  /** The `members.id` every other table points at. */
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: MembershipStatus;
  /** The Supabase Auth user id. */
  authUserId: string;
};

/**
 * The member behind the current request, or null.
 *
 * Returns the member whatever their membership status, so callers can tell
 * "nobody is signed in" apart from "this member is deactivated" and say
 * something useful about the second. Use isActiveMember before granting access.
 *
 * Returns null - never throws - when there is no session, when the session is
 * for an email that is not a member, or when the member row fails validation.
 * A signed-in auth user with no member row is possible in principle (an account
 * created directly in the Supabase dashboard) and is treated as "not a member",
 * which is the safe answer.
 */
export async function getSessionMember(): Promise<SessionMember | null> {
  const supabase = await createServerClient();

  // getUser, not getSession: getUser revalidates the token with Supabase Auth
  // rather than trusting what the cookie claims.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user?.email) return null;

  const email = normalizeEmail(data.user.email);

  const memberId = await lookupMemberIdByEmail(email);

  if (!memberId) return null;

  const member = await getMemberProfile(memberId);

  if (!member || !member.success) return null;

  return {
    memberId: member.data.id,
    email: member.data.email,
    displayName: member.data.display_name,
    membershipStatus: member.data.membership_status,
    authUserId: data.user.id,
  };
}

/**
 * Whether this member may use the site.
 *
 * A deactivated member can still sign in - the credential is Supabase's, and
 * revoking it would mean banning the auth account - so the refusal happens here,
 * at the door, rather than being assumed. 'pending' is allowed through: a member
 * added by a manager but not yet active is expected to be able to sign in and
 * see the club.
 */
export function isActiveMember(member: SessionMember): boolean {
  return member.membershipStatus !== 'inactive';
}

/** The cookie the Phase 1C session used. Cleared on login; no longer read. */
export const LEGACY_SESSION_COOKIE_NAME = 'dbce_session';
