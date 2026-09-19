// Phase 8D: the client-side session indicator.
//
// `LoginGate` wraps every page and sends anyone to /login unless this flag is in
// localStorage. It is NOT the authentication - the Supabase auth cookies are -
// but it is what decides whether a page renders at all, so it has to be set
// wherever a session is established.
//
// IT WAS SET IN EXACTLY ONE PLACE, the login form, and that was a bug: a member
// arriving from an emailed link never used the login form, so the auth callback
// would succeed, redirect to /profile/security, and the gate would bounce them
// straight back to /login. It looked exactly like the callback failing.
//
// Hence this module. There is one definition of the key, and the two places that
// OPEN the gate - a password sign-in and an emailed link - both go through it.
// Everything that closes the gate (a 401 from any API) may keep calling
// localStorage.removeItem directly with the same key; nothing about the flag's
// meaning changes.

/** The localStorage key `LoginGate` reads. */
export const GATE_STORAGE_KEY = "dbce-logged-in";

/**
 * Records that a session has been established.
 *
 * Wrapped because localStorage throws in some privacy modes, and a throw on the
 * auth callback would strand the member on a spinner. Losing the flag is
 * recoverable - the Supabase session is real either way, and the next API call
 * that answers 200 will not care - so a failure here must never be fatal.
 */
export function markGateOpen(): void {
  try {
    localStorage.setItem(GATE_STORAGE_KEY, "true");
  } catch {
    // Nothing to do: the cookie is the credential, this is only the indicator.
  }
}

/** Records that the session has ended, or that the server refused it. */
export function markGateClosed(): void {
  try {
    localStorage.removeItem(GATE_STORAGE_KEY);
  } catch {
    // As above.
  }
}
