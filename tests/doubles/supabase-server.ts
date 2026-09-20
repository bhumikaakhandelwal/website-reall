// Test double for `@/lib/supabase/server`, the anon-key client bound to the
// request's cookies.
//
// Phase 8D moved sign-in, sign-out, password update and password reset onto
// Supabase Auth, so the routes that perform them now call this client. In a test
// there is no Supabase project and no cookie jar, so this double records what
// each route asked for and answers from state the test sets.
//
// The real `lib/db/queries.ts` also uses this client for five reads
// (getMemberById, getMemberByEmail, lookupMemberIdByEmail, getMemberProfile,
// getAllLevels). Route tests never reach those - `@/lib/db/queries` is doubled
// above them - and the query-shape tests exercise only the admin-client reads,
// so doubling this module does not disturb them.

export const serverAuthState = {
  /** What `signInWithPassword` should answer. */
  signInResult: {
    data: { user: null, session: null },
    error: null,
  } as {
    data: { user: { id: string; email: string } | null; session: unknown };
    error: { message: string } | null;
  },

  /** What `signOut` should answer. */
  signOutResult: { error: null } as { error: { message: string } | null },

  /** What `updateUser` should answer. */
  updateUserResult: { data: { user: null }, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },

  /** What `resetPasswordForEmail` should answer. */
  resetResult: { data: {}, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },

  /** Every auth call this double served, in order. */
  calls: [] as { method: string; args: unknown[] }[],
};

export function resetServerAuthState() {
  serverAuthState.signInResult = { data: { user: null, session: null }, error: null };
  serverAuthState.signOutResult = { error: null };
  serverAuthState.updateUserResult = { data: { user: null }, error: null };
  serverAuthState.resetResult = { data: {}, error: null };
  serverAuthState.calls = [];
}

export async function createServerClient() {
  return {
    auth: {
      async signInWithPassword(credentials: unknown) {
        serverAuthState.calls.push({ method: 'signInWithPassword', args: [credentials] });
        return serverAuthState.signInResult;
      },
      async signOut() {
        serverAuthState.calls.push({ method: 'signOut', args: [] });
        return serverAuthState.signOutResult;
      },
      async updateUser(attributes: unknown) {
        serverAuthState.calls.push({ method: 'updateUser', args: [attributes] });
        return serverAuthState.updateUserResult;
      },
      async resetPasswordForEmail(email: unknown, options?: unknown) {
        serverAuthState.calls.push({
          method: 'resetPasswordForEmail',
          args: [email, options],
        });
        return serverAuthState.resetResult;
      },
      async getUser() {
        serverAuthState.calls.push({ method: 'getUser', args: [] });
        return { data: { user: null }, error: null };
      },
    },
  } as never;
}
