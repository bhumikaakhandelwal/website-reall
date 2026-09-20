"use client";

// Phase 8D: the landing point for every emailed auth link.
//
// Activation, password recovery and a manager's reset all send the member here,
// and this page turns the link into a session and forwards them on.
//
// WHY IT IS A CLIENT PAGE: the session arrives in the URL FRAGMENT, and a
// fragment is never sent to the server. The first version was a server route
// handler, which read `?code=`, found nothing, and told the member their link
// had expired.
//
// WHY IT ACTS RATHER THAN WAITS: an earlier version only WAITED - for
// `getSession()` to start returning something, or for an auth event to fire.
// Neither is reliable for an implicit-fragment link, because the browser client
// may clear the fragment during start-up without adopting the tokens. The
// fragment is therefore parsed BEFORE the client exists and handed straight to
// `setSession()`, which is the primary path. The listeners remain as a fallback.
//
// THE STUCK-SPINNER BUG, AND WHY THE GUARD BELOW LOOKS THE WAY IT DOES:
// React StrictMode (on by default in the App Router) runs effects twice in
// development - set up, tear down, set up again. An earlier version of this
// page set the redirect guard in the CLEANUP as well as on a redirect, so the
// tear-down marked the page as "already redirected", the second set-up returned
// early, and NOTHING ran: no listener, no session check, and no timeout. The
// page sat on "Finishing sign-in..." forever. The guard now means exactly one
// thing - a redirect has happened - and cleanup only releases resources.
//
// The decisions live in lib/auth/callback.ts, because this project has no DOM
// test environment (Node's type stripping does not transform JSX, so a .tsx
// component cannot be imported into a test at all).

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { markGateOpen } from "@/lib/auth/gate";
import {
  DEFAULT_NEXT,
  callbackDestination,
  loginErrorUrl,
  parseFragmentSession,
  readCallbackParams,
} from "@/lib/auth/callback";

/**
 * How long to wait for a session to appear.
 *
 * Bounds the wait so a link that genuinely carried nothing cannot leave the
 * member on a spinner forever.
 */
const SETTLE_TIMEOUT_MS = 8000;

export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(false);

  // Means ONE thing: a redirect has been issued. It is deliberately NOT set by
  // the effect's cleanup - see the note at the top of this file.
  const redirectedRef = useRef(false);

  useEffect(() => {
    const origin = window.location.origin;

    const params = readCallbackParams(window.location.search);

    // READ THE FRAGMENT BEFORE THE CLIENT EXISTS. Creating the browser client
    // rewrites the URL, so this is the last moment the tokens are guaranteed to
    // be readable.
    const fragment = parseFragmentSession(window.location.hash);

    const destination = callbackDestination(origin, params.next);
    const securityPage = callbackDestination(origin, DEFAULT_NEXT);
    const failure = loginErrorUrl(origin);

    const seen: string[] = [];

    const cleanup: {
      timeout?: ReturnType<typeof setTimeout>;
      unsubscribe?: () => void;
    } = {};

    const supabase = createClient();

    function navigate(url: string) {
      if (cleanup.timeout) clearTimeout(cleanup.timeout);

      cleanup.unsubscribe?.();

      // replace, not assign: the URL may still carry tokens, and leaving them
      // in the history would keep them in the address bar behind the member.
      window.location.replace(url);
    }

    function succeed(url = destination) {
      if (redirectedRef.current) return;

      redirectedRef.current = true;

      // THE CLIENT GATE FLAG. Without it `LoginGate` bounces the very page this
      // redirects to, because arriving from an email link never touches the
      // login form.
      markGateOpen();

      navigate(url);
    }

    function fail() {
      if (redirectedRef.current) return;

      redirectedRef.current = true;

      setFailed(true);
      navigate(failure);
    }

    // Fallback only. Subscribed before any await so an event cannot be missed,
    // but the fragment path below does not depend on it.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      seen.push(event);

      if (event === "PASSWORD_RECOVERY") {
        succeed(securityPage);
        return;
      }

      if (session) succeed();
    });

    cleanup.unsubscribe = () => data.subscription.unsubscribe();

    async function run() {
      // Supabase positively reported that the link failed - which is not the
      // same as a token being absent, so it is acted on rather than waited out.
      if (params.errorDescription) {
        console.error("Supabase rejected the auth link:", params.errorDescription);
        fail();
        return;
      }

      // ---- PRIMARY: the implicit-flow fragment --------------------------
      //
      // Handed to setSession() rather than left to automatic detection, which
      // is not reliable here: the client may clear the fragment during start-up
      // without adopting the tokens.
      if (fragment) {
        const { error } = await supabase.auth.setSession({
          access_token: fragment.accessToken,
          refresh_token: fragment.refreshToken,
        });

        if (error) {
          console.error("Error setting the session from the URL fragment:", error);
        } else {
          const { data: afterSet } = await supabase.auth.getSession();

          // The diagnostic that says whether setSession() actually worked.
          console.log({
            hadAccessToken: true,
            hadRefreshToken: true,
            type: fragment.type,
            sessionAfterSetSession: afterSet.session !== null,
            authEvents: seen,
          });

          if (afterSet.session) {
            // A recovery link must land on the password form whatever `next`
            // says, because setting a password is what the member came to do.
            succeed(
              fragment.type === "recovery" || fragment.type === "invite"
                ? securityPage
                : destination
            );
            return;
          }
        }
      }

      // ---- PKCE ---------------------------------------------------------
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);

        if (error) {
          // Logged, not fatal: the listener and the timeout still get their
          // chance.
          console.error("Error exchanging auth code for session:", error);
        } else {
          succeed();
          return;
        }
      }

      // ---- Anything already established ---------------------------------
      const { data: existing } = await supabase.auth.getSession();

      if (existing.session) {
        succeed();
        return;
      }

      // Nothing yet. The listener or the timeout decides.
    }

    run();

    cleanup.timeout = setTimeout(() => {
      console.log({
        hadAccessToken: fragment !== null,
        hadRefreshToken: fragment !== null,
        type: fragment?.type ?? null,
        sessionAfterSetSession: false,
        authEvents: seen,
      });

      console.error("Auth callback timed out waiting for a session.", {
        hadCode: params.code !== null,
        hadFragment: fragment !== null,
        events: seen,
        errorDescription: params.errorDescription,
      });

      fail();
    }, SETTLE_TIMEOUT_MS);

    // Releases resources only. It must NOT touch redirectedRef: StrictMode tears
    // the effect down between its two runs, and marking a redirect there stopped
    // the second run from doing anything at all.
    return () => {
      if (cleanup.timeout) clearTimeout(cleanup.timeout);

      cleanup.unsubscribe?.();
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-md border border-border p-8">
        <p className="font-mono text-xs font-bold tracking-[0.2em] text-foreground">
          {failed ? "LINK NOT USED" : "FINISHING SIGN-IN"}
        </p>

        <p className="mt-4 font-mono text-[11px] leading-6 tracking-[0.06em] text-muted-foreground">
          {failed
            ? "Taking you back to the login page so you can request a new link."
            : "Setting up your session. This takes a moment."}
        </p>

        {!failed && (
          <p
            role="status"
            className="mt-6 font-mono text-[11px] tracking-[0.06em] text-muted-foreground"
          >
            PLEASE WAIT...
          </p>
        )}
      </div>
    </main>
  );
}
