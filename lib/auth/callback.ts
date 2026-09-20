// Phase 8D: the decisions behind the auth callback page.
//
// WHY THIS PAGE EXISTS AT ALL, AND WHY IT HAD TO MOVE TO THE BROWSER
//
// Supabase's emailed links come in one of two shapes:
//
//   PKCE      /auth/callback?code=...            <- a query parameter
//   implicit  /auth/callback#access_token=...    <- a URL FRAGMENT
//
// A FRAGMENT IS NEVER SENT TO THE SERVER. That is not a detail - it is the whole
// bug this module was written to fix. The first version of this callback was a
// server route handler, which read `?code=`, found nothing when Supabase sent a
// fragment, and redirected to `/login?error=that link has expired` while the
// tokens sat unread in the address bar.
//
// So the callback is now a client page: the browser is the only place the
// fragment exists, and it is the only place that can hand it to Supabase Auth.
// `@supabase/ssr`'s browser client is created with `detectSessionInUrl: true`,
// which consumes the fragment on creation and writes the auth cookies the
// server later reads.
//
// The decisions - which parameters matter, where it is safe to send someone,
// and what to say when it fails - live here rather than in the page, because
// this project has no DOM test environment (Node's type stripping does not
// transform JSX, so a .tsx component cannot be imported into a test at all).

/** Where a member lands when the link did not say, or said something unsafe. */
export const DEFAULT_NEXT = '/profile/security';

/**
 * What a member is told when no session could be established.
 *
 * Deliberately does not guess why. The link may have expired, been used
 * already, or been opened in a different browser from the one that requested
 * it - and the next step is the same in all three cases.
 */
export const CALLBACK_ERROR_MESSAGE =
  'That link has expired or has already been used. Request a new one.';

/**
 * Only a same-site path is accepted.
 *
 * `next` arrives in a URL anyone can craft, and the member is redirected to it
 * straight after signing in. A value starting with `//` or carrying a scheme
 * would send them to another site while they believed they were still signing
 * in - the exact shape of an open redirect.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return DEFAULT_NEXT;

  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_NEXT;

  // A backslash is treated as a slash by some browsers, so `/\evil.com` is
  // another way to write a protocol-relative URL.
  if (value.startsWith('/\\')) return DEFAULT_NEXT;

  return value;
}

export type CallbackParams = {
  /** The PKCE code, when Supabase sent one. */
  code: string | null;
  /** Where to go once a session exists. */
  next: string;
  /** Supabase's own error, when the link was rejected before it got here. */
  errorDescription: string | null;
};

/**
 * Reads the query string of the callback URL.
 *
 * Only the query string - the fragment is Supabase's to consume, and parsing it
 * here would risk reading the tokens before the client has stored them.
 */
export function readCallbackParams(search: string): CallbackParams {
  const params = new URLSearchParams(search);

  return {
    code: params.get('code'),
    next: safeNext(params.get('next')),
    errorDescription: params.get('error_description'),
  };
}

export type FragmentSession = {
  accessToken: string;
  refreshToken: string;
  /**
   * Supabase's `type` - 'recovery' for a reset or first-time link, 'invite',
   * 'signup', or null.
   *
   * Carried because it decides the destination: a recovery link must land on
   * the password form whatever `next` says, because that is what the member
   * came to do.
   */
  type: string | null;
};

/**
 * The tokens in a URL fragment, or null.
 *
 * MUST BE CALLED BEFORE THE SUPABASE CLIENT IS CREATED. The browser client
 * consumes the fragment as part of starting up and rewrites the URL, so this is
 * the last moment the tokens are guaranteed to be readable.
 */
export function parseFragmentSession(hash: string): FragmentSession | null {
  if (!hash) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken, type: params.get('type') };
}

/**
 * Whether a fragment looks like it carries a session.
 *
 * Only for diagnostics and for deciding whether to try the fragment by hand -
 * its ABSENCE IS NOT A FAILURE, because the browser client may already have
 * consumed and cleared it.
 */
export function hasFragmentSession(hash: string): boolean {
  return parseFragmentSession(hash) !== null;
}

/** Where to send someone whose link could not be turned into a session. */
export function loginErrorUrl(origin: string): string {
  return `${origin}/login?error=${encodeURIComponent(CALLBACK_ERROR_MESSAGE)}`;
}

/** Where to send someone once their session exists. */
export function callbackDestination(origin: string, next: string): string {
  return `${origin}${next}`;
}
