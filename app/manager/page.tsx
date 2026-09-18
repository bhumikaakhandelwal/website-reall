import type { Metadata } from "next";
import { Container } from "../components/container";
import { ManagerDashboard } from "../components/manager-dashboard";

export const metadata: Metadata = {
  title: "Manager Dashboard",
  description:
    "The DBCE Coders Club manager dashboard — roster size, XP recorded this month, and the most recent XP ledger activity.",
};

// Phase 5C: the manager-only dashboard.
//
// Like /members, the page itself is not access-controlled — it renders for
// anyone who can reach it, because the site's gate is a client-side indicator
// and always has been. The DATA is what is protected: GET
// /api/manager/dashboard answers 401 without a session and 403 for anyone
// outside the two-email manager allowlist, so a normal member sees the
// "Managers only" state rather than any figures.
//
// Visual language is the existing one (/members, /leaderboard): same header
// treatment, same numbered section headings, same panel + row list. No new
// tokens, no restyling.
//
// The global navigation deliberately does NOT link here, matching /members:
// adding an entry would change Bhumika's navigation, which is frozen. The URL
// is reached directly, or from the quick actions once a manager is on it.
export default function ManagerPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Dashboard.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            The club at a glance: how many members are on the roster, how much
            XP has been recorded this month, and the most recent entries in the
            ledger. Visible to XP managers only.
          </p>
        </header>

        <ManagerDashboard />
      </Container>
    </main>
  );
}
