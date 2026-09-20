import type { Metadata } from "next";
import { Container } from "../components/container";
import { EventManager } from "../components/event-manager";

export const metadata: Metadata = {
  title: "Events",
  description:
    "The DBCE Coders Club event register — record a club event and the Handbook activity it awards.",
};

// Phase 7A: the manager-only event register.
//
// Like /members and /manager, the page itself is not access-controlled — it
// renders for anyone who can reach it, because the site's gate is a client-side
// indicator and always has been. The DATA is what is protected: /api/events
// answers 401 without a session and 403 for anyone outside the two-email manager
// allowlist, so a normal member sees the "Managers only" state.
//
// Visual language is the existing one (/members, /manager, /leaderboard): same
// header treatment, same numbered section headings, same panel + row list. No
// new tokens, no restyling.
//
// The global navigation deliberately does NOT link here, matching /members and
// /manager: adding an entry would change Bhumika's navigation, which is frozen.
// The URL is reached directly.
//
// Attendance is prepared but not yet usable: the attendance table exists (Phase
// 7A migration) so that recording who attended, and awarding them, can be built
// on top of it without a schema change. Nothing on this page records attendance
// or awards XP yet.
export default function EventsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Events.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            The club&rsquo;s event register. Record an event and the Handbook
            activity it awards, ready for attendance to be taken against it.
            Visible to XP managers only.
          </p>
        </header>

        <EventManager />
      </Container>
    </main>
  );
}
