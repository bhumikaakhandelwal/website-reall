// Phase 8D: the Supabase Auth calls that only the server may make.
//
// Every function here takes an optional client so a test can drive it without a
// Supabase project. The default is created at CALL time, not import time, so
// importing this module never throws when the service-role key is absent (the
// same reason lib/supabase/admin.ts creates its client lazily).
//
// NO PASSWORD IS EVER PASSED THROUGH THIS MODULE. Activation and recovery both
// work by email: the member opens a link and chooses their own password in
// Supabase's own UI. Nothing here generates, receives or stores a temporary
// password, and nothing here can set one.

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Where Supabase should send a member after they open an emailed link.
 *
 * The callback exchanges the link for a session and then forwards them to the
 * security page, where they choose their password. Without the callback the
 * PKCE code in the link would never be exchanged and the member would arrive
 * signed out, unable to change anything.
 */
export function authRedirectTo(origin: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent('/profile/security')}`;
}

export type InviteOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: 'already-registered' | 'failed'; message: string };

export type RecoverOutcome = { ok: true } | { ok: false; message: string };

/**
 * Detects the one Supabase error this flow has to act on rather than report.
 *
 * Matching on a message is not ideal, and it is why this is isolated in one
 * place with a comment: the activation route's primary branch is the
 * `auth_user_id IS NULL` check on the member row, and this is only a FALLBACK
 * for the case that check cannot see - an auth account created outside this
 * application, for example directly in the Supabase dashboard.
 *
 * If Supabase ever rewords it, the consequence is bounded: the member is told
 * the setup email could not be sent rather than being told to use the reset
 * link, and the manager can still send a reset from the member page.
 */
function isAlreadyRegistered(message: string): boolean {
  return /already\s+(been\s+)?registered|already\s+exists/i.test(message);
}

/**
 * Creates a Supabase Auth account for a member and sends them the setup email.
 *
 * Returns the new auth user's id so the caller can record it on the member row -
 * which is what makes "has this member activated?" a fact the application owns
 * rather than something inferred from an error message next time.
 *
 * No password is supplied. Supabase sends the member a link and they choose one.
 */
export async function inviteAuthUser(
  email: string,
  origin: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<InviteOutcome> {
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    redirectTo: authRedirectTo(origin),
  });

  if (error) {
    return isAlreadyRegistered(error.message)
      ? { ok: false, reason: 'already-registered', message: error.message }
      : { ok: false, reason: 'failed', message: error.message };
  }

  const userId = data?.user?.id;

  // A success with no user id would leave the member with an account the
  // application cannot record, so it is reported as a failure rather than
  // written as a half-truth.
  if (!userId) {
    return {
      ok: false,
      reason: 'failed',
      message: 'Supabase did not return a user id for the invitation',
    };
  }

  return { ok: true, userId };
}

/**
 * Sends a password reset link.
 *
 * Used for the "Forgot password" flow, for a manager's "Send Password Reset
 * Email" action, and as the activation fallback when the account already
 * exists. All three want the same thing: an email the member can open to set a
 * new password.
 */
export async function sendRecoveryEmail(
  email: string,
  origin: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<RecoverOutcome> {
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectTo(origin),
  });

  if (error) return { ok: false, message: error.message };

  return { ok: true };
}
