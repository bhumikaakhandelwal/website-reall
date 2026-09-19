import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../components/container";
import { SecurityForm } from "../../components/security-form";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Change the password you use to sign in to the DBCE Coders Club.",
};

// Phase 8D: the member's own security page.
//
// Open to every signed-in member - not a manager tool. Supabase Auth owns the
// credential, and this page is the one place a member changes it.
//
// It is also where the emailed links land: /auth/callback exchanges the code and
// forwards here, so a member arriving from an invitation or a reset email is
// signed in and looking at the form they came for.
//
// There is no "current password" field. Supabase's updateUser changes the
// password of the session's own user, so proving the old one again would be
// asking for something the session has already established.
export default function SecurityPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Your account
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Security.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Change the password you sign in with. It is held by Supabase Auth and
            never stored by the club — nobody here can read it.
          </p>
        </header>

        <section aria-labelledby="security-password" className="mt-section">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs text-accent-text">01</span>

            <h2
              id="security-password"
              className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
            >
              Change your password
            </h2>
          </div>

          <SecurityForm />
        </section>

        <section aria-labelledby="security-forgot" className="mt-section">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs text-accent-text">02</span>

            <h2
              id="security-forgot"
              className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
            >
              Forgotten it?
            </h2>
          </div>

          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            Sign out and use <span className="text-foreground">Forgot password</span>{" "}
            on the login page. Supabase will email you a link to choose a new one.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              ← BACK TO LOGIN
            </Link>

            <Link
              href="/"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              HOME
            </Link>
          </div>
        </section>
      </Container>
    </main>
  );
}
