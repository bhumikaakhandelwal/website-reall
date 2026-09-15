// Test double for `@/lib/auth/session`. The only thing the XP routes ask of a
// session is which member it belongs to.

export const authState = {
  /** The member id the signed session resolves to, or null for no session. */
  memberId: null as string | null,
};

export async function getSessionMemberId() {
  return authState.memberId;
}
