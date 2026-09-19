import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../components/container";
import { XpLedgerExplorer } from "../../components/xp-ledger-explorer";

export const metadata: Metadata = {
  title: "XP ledger",
  description:
    "The DBCE Coders Club XP ledger — every entry in the audit trail, with the member, the activity, the reason and the event it came from.",
};

// Phase 8C: the manager-only XP ledger explorer.
//
// Like every other page here, it is not access-controlled itself — the site's
// gate is a client-side indicator and always has been. The DATA is what is
// protected: /api/manager/ledger answers 401 without a session and 403 for
// anyone outside the two-email manager allowlist, so a normal member sees the
// "Managers only" state rather than the club's ledger.
//
// READ-ONLY. There is nothing to save on this page, and the route behind it
// issues no writes. The ledger is an append-only audit trail: reversing an entry
// is a correction — a new negative row — not an edit, and that happens through
// the Award XP panel on /members, never here.
//
// Visual language is the existing one (/manager, /events, /members): same header
// treatment, same numbered section headings, same panel + row list. No new
// tokens, no restyling.
//
// The global navigation deliberately does NOT link here, matching /manager,
// /events and /manager/analytics: adding an entry would change Bhumika's
// navigation, which is frozen. The page is reached from the manager dashboard's
// quick actions and by URL.
export default function XpLedgerPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Ledger.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Every entry in the XP audit trail, newest first — who earned it, what
            for, and which event it came from. Nothing here can be changed:
            correcting a mistake means appending a new entry, not editing an old
            one. Visible to XP managers only.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/manager"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              ← DASHBOARD
            </Link>

            <Link
              href="/members"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              AWARD XP →
            </Link>
          </div>
        </header>

        <XpLedgerExplorer />
      </Container>
    </main>
  );
}
