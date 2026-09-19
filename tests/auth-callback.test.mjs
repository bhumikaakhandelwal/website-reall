// Phase 8D: the auth callback's decisions.
//
// This file exists because of a real bug. The first callback was a SERVER route
// handler, and Supabase's implicit flow returns the session in the URL FRAGMENT
// - which a server never sees. It read `?code=`, found nothing, and told the
// member their link had expired while the tokens sat unread in the address bar.
//
// The page itself is a .tsx component and cannot be imported here (this project
// has no DOM test environment - Node's type stripping does not transform JSX),
// so the decisions it makes live in lib/auth/callback.ts and are asserted on
// here. hasFragmentSession is the one that names the bug directly.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { GATE_STORAGE_KEY, markGateClosed, markGateOpen } from '@/lib/auth/gate';
import {
  CALLBACK_ERROR_MESSAGE,
  DEFAULT_NEXT,
  callbackDestination,
  hasFragmentSession,
  loginErrorUrl,
  parseFragmentSession,
  readCallbackParams,
  safeNext,
} from '@/lib/auth/callback';

// ---------------------------------------------------------------------------
// The client gate flag
// ---------------------------------------------------------------------------
//
// This is what actually fixed the first-time flow. The callback was working and
// redirecting to /profile/security correctly - and LoginGate bounced that page
// back to /login, because the flag it reads was set in exactly one place (the
// login form) and a member arriving from an email link never used it.

test('the gate key is the exact string LoginGate reads', () => {
  // The two live in different files and must agree. LoginGate is Bhumika's
  // component, so the key is read here rather than changed there.
  assert.strictEqual(GATE_STORAGE_KEY, 'dbce-logged-in');

  const gate = readFileSync(
    new URL('../app/components/login-gate.tsx', import.meta.url),
    'utf8'
  );

  assert.ok(
    gate.includes(`"${GATE_STORAGE_KEY}"`),
    'LoginGate must read the same key this module writes'
  );
});

test('the gate helpers never throw without a browser', () => {
  // localStorage does not exist in Node, and it throws in some browser privacy
  // modes. A throw on the callback would strand the member on a spinner, so
  // both helpers swallow it - and this asserts that, by calling them here.
  assert.doesNotThrow(() => markGateOpen());
  assert.doesNotThrow(() => markGateClosed());
});

test('the gate helpers write and clear the flag when storage is available', () => {
  const store = new Map();

  // A minimal stand-in, so the two helpers are exercised rather than only
  // their failure path.
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };

  try {
    markGateOpen();
    assert.strictEqual(store.get(GATE_STORAGE_KEY), 'true');

    markGateClosed();
    assert.strictEqual(store.has(GATE_STORAGE_KEY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------------------------------------------------------------------------
// The callback page's wiring
// ---------------------------------------------------------------------------
//
// The page is a .tsx component and cannot be imported here, so these are
// source assertions. They are weaker than behavioural tests and they earn their
// place anyway: BOTH bugs in this page were wiring mistakes that no unit test
// could see, and the first of these would have caught the second one outright.

const CALLBACK_SOURCE = readFileSync(
  new URL('../app/auth/callback/page.tsx', import.meta.url),
  'utf8'
);

test('the effect cleanup does NOT mark the page as redirected', () => {
  // THE REGRESSION GUARD. React StrictMode runs effects twice in development:
  // set up, tear down, set up again. An earlier version set the redirect guard
  // in the cleanup, so the tear-down marked the page as already redirected and
  // the second set-up returned early WITHOUT subscribing, checking the session
  // or setting the timeout - leaving an indefinite "Finishing sign-in...".
  const cleanupStart = CALLBACK_SOURCE.lastIndexOf('return () => {');

  assert.notEqual(cleanupStart, -1, 'the effect must clean up after itself');

  // Up to the end of the effect's dependency array.
  const cleanup = CALLBACK_SOURCE.slice(cleanupStart, CALLBACK_SOURCE.indexOf('}, []);', cleanupStart));

  assert.ok(
    !cleanup.includes('redirectedRef.current = true'),
    'cleanup must only release resources - setting the redirect guard there ' +
      'breaks the second StrictMode run and hangs the page'
  );
});

test('the fragment is handed to setSession rather than only waited for', () => {
  // Waiting on getSession()/onAuthStateChange is not reliable for an
  // implicit-fragment link, because the client may clear the fragment during
  // start-up without adopting the tokens. Establishing the session actively is
  // the primary path; the listeners are the fallback.
  assert.ok(
    CALLBACK_SOURCE.includes('setSession('),
    'the callback must call setSession() with the parsed fragment'
  );

  // And the fragment must be parsed before the client exists, or the URL has
  // already been rewritten by the time it is read.
  const fragmentAt = CALLBACK_SOURCE.indexOf('parseFragmentSession(window.location.hash)');
  const clientAt = CALLBACK_SOURCE.indexOf('createClient()');

  assert.notEqual(fragmentAt, -1, 'the fragment must be parsed');
  assert.notEqual(clientAt, -1, 'the client must be created');
  assert.ok(
    fragmentAt < clientAt,
    'the fragment must be parsed BEFORE createClient(), which rewrites the URL'
  );
});

test('the gate flag is opened before navigating away', () => {
  // Without this the gate bounces the destination straight back to /login,
  // which looks exactly like the callback failing.
  assert.ok(
    CALLBACK_SOURCE.includes('markGateOpen()'),
    'the callback must open the client gate before redirecting'
  );
});

// ---------------------------------------------------------------------------
// safeNext - the open-redirect guard
// ---------------------------------------------------------------------------

test('a plain path is allowed through', () => {
  assert.strictEqual(safeNext('/profile/security'), '/profile/security');
  assert.strictEqual(safeNext('/manager/ledger'), '/manager/ledger');
});

test('nothing at all falls back to the security page', () => {
  for (const value of [null, undefined, '']) {
    assert.strictEqual(safeNext(value), DEFAULT_NEXT, String(value));
  }
});

test('a protocol-relative URL is refused', () => {
  // `//evil.com` is a URL to another site, not a path on this one. This is the
  // classic open redirect, and it arrives in a parameter anyone can craft.
  assert.strictEqual(safeNext('//evil.com'), DEFAULT_NEXT);
  assert.strictEqual(safeNext('//evil.com/steal'), DEFAULT_NEXT);
});

test('a scheme is refused', () => {
  for (const value of ['https://evil.com', 'http://evil.com', 'javascript:alert(1)']) {
    assert.strictEqual(safeNext(value), DEFAULT_NEXT, value);
  }
});

test('a backslash-prefixed path is refused', () => {
  // Some browsers read `/\evil.com` as a protocol-relative URL, so it is
  // another way to write the attack above.
  assert.strictEqual(safeNext('/\\evil.com'), DEFAULT_NEXT);
});

test('a relative path with no leading slash is refused', () => {
  // It would resolve against the current URL rather than being a destination
  // this page chose.
  assert.strictEqual(safeNext('profile/security'), DEFAULT_NEXT);
});

// ---------------------------------------------------------------------------
// readCallbackParams
// ---------------------------------------------------------------------------

test('the PKCE code and the destination are read', () => {
  const params = readCallbackParams('?code=abc123&next=%2Fprofile%2Fsecurity');

  assert.strictEqual(params.code, 'abc123');
  assert.strictEqual(params.next, '/profile/security');
  assert.strictEqual(params.errorDescription, null);
});

test('a missing code is null, not an empty string', () => {
  assert.strictEqual(readCallbackParams('?next=%2Fprofile%2Fsecurity').code, null);
});

test('an unsafe destination is replaced before it is ever used', () => {
  const params = readCallbackParams('?next=%2F%2Fevil.com');

  assert.strictEqual(params.next, DEFAULT_NEXT);
});

test('an empty query string yields the defaults', () => {
  const params = readCallbackParams('');

  assert.strictEqual(params.code, null);
  assert.strictEqual(params.next, DEFAULT_NEXT);
  assert.strictEqual(params.errorDescription, null);
});

test("Supabase's own error is surfaced", () => {
  // Supabase reports an expired or already-used link in the query string rather
  // than by failing anything, so it has to be read.
  const params = readCallbackParams('?error=access_denied&error_description=Email+link+is+invalid');

  assert.strictEqual(params.errorDescription, 'Email link is invalid');
});

test('a fragment is ignored, because it is not this function\'s to read', () => {
  // The tokens must be left for the browser client to consume; parsing them
  // here would risk reading them before Supabase has stored them.
  const params = readCallbackParams('#access_token=abc&refresh_token=def&type=recovery');

  assert.strictEqual(params.code, null);
  assert.strictEqual(params.next, DEFAULT_NEXT);
});

// ---------------------------------------------------------------------------
// parseFragmentSession - the tokens, and why they must be read FIRST
// ---------------------------------------------------------------------------

test('the access and refresh tokens are read out of the fragment', () => {
  const session = parseFragmentSession(
    '#access_token=eyJhbGciOi&expires_in=3600&refresh_token=v1abc&token_type=bearer&type=recovery'
  );

  assert.deepStrictEqual(session, {
    accessToken: 'eyJhbGciOi',
    refreshToken: 'v1abc',
    type: 'recovery',
  });
});

test('the link type is carried, because it decides the destination', () => {
  // A recovery or invite link must land on the password form whatever `next`
  // says - that is what the member came to do.
  assert.strictEqual(
    parseFragmentSession('#access_token=a&refresh_token=b&type=recovery').type,
    'recovery'
  );
  assert.strictEqual(
    parseFragmentSession('#access_token=a&refresh_token=b&type=invite').type,
    'invite'
  );
  assert.strictEqual(
    parseFragmentSession('#access_token=a&refresh_token=b').type,
    null
  );
});

test('a fragment with only one of the two tokens yields nothing', () => {
  // setSession needs both; half a session is not a session.
  assert.strictEqual(parseFragmentSession('#access_token=abc'), null);
  assert.strictEqual(parseFragmentSession('#refresh_token=abc'), null);
});

test('no fragment, or an unrelated one, yields nothing', () => {
  for (const hash of ['', '#', '#type=recovery', '#error=access_denied']) {
    assert.strictEqual(parseFragmentSession(hash), null, JSON.stringify(hash));
  }
});

test('the tokens are URL-decoded', () => {
  const session = parseFragmentSession('#access_token=a%2Bb&refresh_token=c%2Fd');

  assert.strictEqual(session.accessToken, 'a+b');
  assert.strictEqual(session.refreshToken, 'c/d');
});

test('hasFragmentSession is exactly "parseFragmentSession found something"', () => {
  // One definition, so the diagnostic and the fallback cannot disagree about
  // whether a fragment carried a session.
  for (const hash of [
    '#access_token=a&refresh_token=b',
    '#access_token=a',
    '#refresh_token=b',
    '',
    '#type=recovery',
  ]) {
    assert.strictEqual(
      hasFragmentSession(hash),
      parseFragmentSession(hash) !== null,
      JSON.stringify(hash)
    );
  }
});

// ---------------------------------------------------------------------------
// hasFragmentSession - the bug, named
// ---------------------------------------------------------------------------

test('a fragment carrying a session is recognised', () => {
  // This is exactly what the failing link looked like. The old server route
  // could never see it, which is why the member was told the link had expired.
  assert.strictEqual(
    hasFragmentSession(
      '#access_token=eyJhbGciOi...&expires_in=3600&refresh_token=v1abc&token_type=bearer&type=recovery'
    ),
    true
  );
});

test('a fragment with only one of the two tokens is not a session', () => {
  assert.strictEqual(hasFragmentSession('#access_token=abc'), false);
  assert.strictEqual(hasFragmentSession('#refresh_token=abc'), false);
});

test('no fragment, or an unrelated one, is not a session', () => {
  for (const hash of ['', '#', '#type=recovery', '#error=access_denied']) {
    assert.strictEqual(hasFragmentSession(hash), false, JSON.stringify(hash));
  }
});

// ---------------------------------------------------------------------------
// The two destinations
// ---------------------------------------------------------------------------

test('success sends the member to the security page', () => {
  assert.strictEqual(
    callbackDestination('https://club.example', '/profile/security'),
    'https://club.example/profile/security'
  );
});

test('failure sends the member back to login with a reason', () => {
  const url = loginErrorUrl('https://club.example');

  assert.ok(url.startsWith('https://club.example/login?error='));
  assert.ok(url.includes(encodeURIComponent(CALLBACK_ERROR_MESSAGE)));
});

test('the failure message does not guess why the link failed', () => {
  // It may have expired, been used, or been opened in a different browser. The
  // member's next step is the same in every case.
  assert.match(CALLBACK_ERROR_MESSAGE, /expired or has already been used/);
  assert.match(CALLBACK_ERROR_MESSAGE, /Request a new one/);
});
