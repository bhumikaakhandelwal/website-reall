// Test double for `@/lib/auth/session`, now that the session is backed by
// Supabase Auth.
//
// The real module asks Supabase Auth who is signed in and then resolves that
// email against `members`. In a test neither of those exists, so this double
// answers the same question from state the tests already set:
//
//   authState.memberId   - who is signed in, or null
//   dbState.profile      - that member's row (the `@/lib/db/queries` double)
//
// Keeping those two as the inputs is deliberate: every test written before
// Phase 8D already sets exactly those, so replacing the session implementation
// did not require rewriting the suite. A test that wants a deactivated member
// sets `dbState.profile` with membership_status 'inactive'.

import { getMemberProfile } from './db-queries';

export const authState = {
  /** The member id the verified session resolves to, or null for no session. */
  memberId: null as string | null,
  /**
   * The Supabase Auth user id the session carries. Synthetic: no test needs a
   * real one, and the application only ever reads it off the session.
   */
  authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as string,
};

export type DoubledSessionMember = {
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: 'pending' | 'active' | 'inactive';
  authUserId: string;
};

/**
 * The signed-in member, or null.
 *
 * Mirrors the real resolver's contract AND its shape: the real one resolves the
 * auth user's email to a member id and then loads that member's profile, so this
 * does the same through the doubled `getMemberProfile`. That matters beyond
 * fidelity - the profile lookup is observable through `dbState.profileLookups`,
 * which is how a test can tell that the ACTOR came from the session rather than
 * from the request.
 */
export async function getSessionMember(): Promise<DoubledSessionMember | null> {
  if (!authState.memberId) return null;

  // getMemberProfile answers with `{ success, data }`, not the row itself - the
  // real resolver unwraps it the same way, and reading the fields off the
  // wrapper would silently yield a member with no email.
  const result = await getMemberProfile(authState.memberId);

  if (!result || !result.success) return null;

  const profile = result.data;

  return {
    memberId: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    membershipStatus: profile.membership_status,
    authUserId: authState.authUserId,
  };
}

/** Mirrors the real rule: everything except 'inactive' may use the site. */
export function isActiveMember(member: { membershipStatus: string }): boolean {
  return member.membershipStatus !== 'inactive';
}

/** The Phase 1C cookie, still exported because the login route clears it. */
export const LEGACY_SESSION_COOKIE_NAME = 'dbce_session';
