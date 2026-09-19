import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../../components/container";
import { AddMemberForm } from "../../../components/add-member-form";

export const metadata: Metadata = {
  title: "Add a member",
  description: "Add a member to the DBCE Coders Club roster.",
};

// Phase 8D: the manager-only Add Member page.
//
// NO INVITATION IS SENT. The manager adds the member to the roster, and the
// member creates their own password the first time they try to sign in - the
// same first-time flow the 42 existing members use. That is why this page has no
// password field and no "send invite" button: there is nothing to send.
//
// The page itself is not access-controlled - the site's gate is a client-side
// indicator and always has been. The DATA is: POST /api/manager/members answers
// 401 without a session and 403 for anyone outside the two-email manager
// allowlist.
export default function AddMemberPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Add a member.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Add someone to the roster and award them Membership XP. No email is
            sent — they create their own password the first time they sign in.
          </p>

          <Link
            href="/members"
            className="mt-6 inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            ← MEMBER DIRECTORY
          </Link>
        </header>

        <section aria-labelledby="add-member-form" className="mt-section">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs text-accent-text">01</span>

            <h2
              id="add-member-form"
              className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
            >
              Their details
            </h2>
          </div>

          <AddMemberForm />
        </section>

        <section aria-labelledby="add-member-what-next" className="mt-section">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-xs text-accent-text">02</span>

            <h2
              id="add-member-what-next"
              className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
            >
              What happens next
            </h2>
          </div>

          <ol className="mt-6 max-w-2xl space-y-3 text-base leading-7 text-muted">
            <li>
              <span className="text-foreground">1.</span> The member is on the
              roster and holds Membership XP immediately.
            </li>
            <li>
              <span className="text-foreground">2.</span> They go to the login
              page and enter their DBCE email.
            </li>
            <li>
              <span className="text-foreground">3.</span> The page recognises the
              membership and offers them{" "}
              <span className="text-foreground">create your password</span>.
            </li>
            <li>
              <span className="text-foreground">4.</span> They choose their own
              password from the emailed link, then sign in.
            </li>
          </ol>
        </section>
      </Container>
    </main>
  );
}
