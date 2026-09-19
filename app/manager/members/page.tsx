import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../components/container";
import { MemberLifecycle } from "../../components/member-lifecycle";

export const metadata: Metadata = {
  title: "Member lifecycle",
  description:
    "Archive and restore DBCE Coders Club members without losing their XP or event history.",
};

// Phase 8E: the manager-only member lifecycle page.
//
// ARCHIVE, NOT DELETE. There is no way to permanently remove a member from this
// page, or from anywhere else in the application: XP, attendance and event
// authorship all point at `members.id`, so deleting one would either destroy club
// history or be blocked by a foreign key. Archiving is reversible, and the
// Restore button is on the archived row.
//
// An archived member can still sign in. They are hidden from the working lists
// and refused new XP, which is a different thing from being locked out -
// deactivating (which refuses sign-in) remains a separate action on the member
// directory.
//
// The page itself is not access-controlled - the site's gate is a client-side
// indicator and always has been. The DATA is: /api/manager/members answers 401
// without a session and 403 for anyone outside the two-email manager allowlist.
export default function MemberLifecyclePage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Member lifecycle.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Move members off the working roster without losing anything about
            them. Archiving is reversible, and no XP, attendance or event history
            is ever removed. Members are never deleted.
          </p>

          <Link
            href="/manager"
            className="mt-6 inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            ← DASHBOARD
          </Link>
        </header>

        <MemberLifecycle />
      </Container>
    </main>
  );
}
