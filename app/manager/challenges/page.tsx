import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../components/container";
import { ChallengeManager } from "../../components/challenge-manager";

export const metadata: Metadata = {
  title: "Challenges",
  description:
    "The DBCE Coders Club challenge console — review submissions and manage the catalogue.",
};

// Phase 9: the manager-only challenge console.
//
// THE REVIEW QUEUE LIVES HERE, and approving is the only action in the whole
// application that awards XP for a challenge. It does so through a database
// function that refuses a submission which is no longer pending, so a second
// click cannot award twice.
//
// The page itself is not access-controlled - the site's gate is a client-side
// indicator and always has been. The DATA is: /api/manager/challenges answers 401
// without a session and 403 for anyone outside the two-email manager allowlist.
export default function ManagerChallengesPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Challenges.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Review what members have submitted and manage the catalogue. No XP is
            ever awarded automatically — an approval writes it, once, and the
            ledger is never edited afterwards.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/manager"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              ← DASHBOARD
            </Link>

            <Link
              href="/"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              VIEW PUBLIC CARDS →
            </Link>
          </div>
        </header>

        <ChallengeManager />
      </Container>
    </main>
  );
}
