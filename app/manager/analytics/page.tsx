import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../../components/container";
import { EventAnalytics } from "../../components/event-analytics";

export const metadata: Metadata = {
  title: "Event analytics",
  description:
    "The DBCE Coders Club event analytics — how many events the club has run, how many members attended, and the XP that attendance awarded.",
};

// Phase 8B: the manager-only event analytics page.
//
// Like every other page here, it is not access-controlled itself — the site's
// gate is a client-side indicator and always has been. The DATA is what is
// protected: /api/manager/analytics answers 401 without a session and 403 for
// anyone outside the two-email manager allowlist, so a normal member sees the
// "Managers only" state rather than the club's figures.
//
// READ-ONLY. There is nothing to save on this page, and the route behind it
// issues no writes.
//
// Visual language is the existing one (/manager, /events, /members): same header
// treatment, same numbered section headings, same panel + row list. No new
// tokens, no restyling.
//
// The global navigation deliberately does NOT link here, matching /manager and
// /events: adding an entry would change Bhumika's navigation, which is frozen.
// The page is reached from the manager dashboard's quick actions and by URL.
export default function EventAnalyticsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Analytics.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            How much the club has run, and how many members turned up. Every
            figure is read from the event register and the attendance already
            recorded against it — nothing here is entered by hand. Visible to XP
            managers only.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/events"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              ← THE REGISTER
            </Link>

            <Link
              href="/manager"
              className="inline-block border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
            >
              ← DASHBOARD
            </Link>
          </div>
        </header>

        <EventAnalytics />
      </Container>
    </main>
  );
}
