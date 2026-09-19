// Phase 8D: password management.
//
// Two flows, both of which hand the password straight to Supabase and never
// store, log or hash anything themselves:
//
//   changePassword        - a signed-in member replaces their own password
//   requestPasswordReset  - anyone asks for a reset link for their address
//
// The rules live here rather than in the components, because this project has
// no DOM test environment (Node's type stripping does not transform JSX, so a
// .tsx component cannot be imported into a test at all).
//
// NO PASSWORD EVER LEAVES THIS MODULE EXCEPT TO THE API, and the API forwards it
// to Supabase's own password API. It is never put in a log line, never compared
// against a stored value, and never kept after the request.

import { isWellFormedEmail, normalizeEmail } from '@/lib/onboarding/roster';

/**
 * The minimum this application accepts.
 *
 * Stricter than Supabase's own default of 6. Supabase still enforces its own
 * policy; this is the form's rule, and being stricter than the service is safe
 * in a way that being laxer would not be.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Supabase's own ceiling, restated so an over-long value fails here first. */
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordDraft = {
  password: string;
  confirm: string;
};

export type PasswordValidation =
  | { ok: true; password: string }
  | { ok: false; field: 'password' | 'confirm'; message: string };

/**
 * Validates a password change.
 *
 * The password is NOT trimmed. Leading and trailing spaces are legitimate
 * characters in a password, and silently removing them would make a member's
 * password different from the one they typed - the classic cause of "it works
 * on the signup form and not on the login form".
 */
export function validatePasswordChange(draft: PasswordDraft): PasswordValidation {
  const password = typeof draft.password === 'string' ? draft.password : '';
  const confirm = typeof draft.confirm === 'string' ? draft.confirm : '';

  if (password.length === 0) {
    return { ok: false, field: 'password', message: 'Enter a new password.' };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: 'password',
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: 'password',
      message: `Keep the password to ${MAX_PASSWORD_LENGTH} characters or fewer.`,
    };
  }

  if (password !== confirm) {
    return {
      ok: false,
      field: 'confirm',
      message: 'The two passwords do not match.',
    };
  }

  return { ok: true, password };
}

export type PasswordOutcome =
  | { ok: true; message: string }
  | { ok: false; kind: 'invalid' | 'unauthorized' | 'rejected' | 'unavailable'; message: string };

export type ResetRequestOutcome =
  | { ok: true; message: string }
  | { ok: false; kind: 'invalid' | 'unavailable'; message: string };

const UNAVAILABLE = 'The server could not be reached. Try again in a moment.';

/**
 * Changes the signed-in member's password.
 *
 * Only the new password is sent. The member is identified by their session, not
 * by anything in this body, so one member cannot change another's password by
 * naming them.
 */
export async function changePassword(
  draft: PasswordDraft,
  fetchImpl: typeof fetch = fetch
): Promise<PasswordOutcome> {
  const checked = validatePasswordChange(draft);

  if (!checked.ok) {
    return { ok: false, kind: 'invalid', message: checked.message };
  }

  let response: Response;

  try {
    response = await fetchImpl('/api/profile/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: checked.password }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 400) {
    return {
      ok: false,
      kind: 'rejected',
      message:
        'Supabase rejected that password — it may be too short or too common. Try a longer one.',
    };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return {
    ok: true,
    message: 'Your password has been changed. Use it the next time you sign in.',
  };
}

/**
 * Asks for a reset link.
 *
 * The success message is identical whether or not the address has an account.
 * That is deliberate: this endpoint is reachable without signing in, and
 * answering "no such account" would turn it into a way to discover who is a
 * club member.
 */
export async function requestPasswordReset(
  rawEmail: string,
  fetchImpl: typeof fetch = fetch
): Promise<ResetRequestOutcome> {
  const email = normalizeEmail(rawEmail);

  if (!isWellFormedEmail(email)) {
    return {
      ok: false,
      kind: 'invalid',
      message: 'Enter the email address you sign in with.',
    };
  }

  let response: Response;

  try {
    response = await fetchImpl('/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return {
    ok: true,
    message:
      'If that address has an account, a reset link is on its way. Open it to choose a new password.',
  };
}
