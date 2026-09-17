import type { Metadata } from "next";
import { Container } from "../components/container";
import { LeaderboardBoards } from "../components/leaderboard-boards";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The DBCE Coders Club monthly leaderboards — overall XP, hackathon, and open-source contribution rankings.",
};

// Phase 4: the page global navigation has always linked to. The visual language
// is the one already used by the other inner pages (/hackathon, /xp-system):
// same header treatment, same panel + row list used for tabular data on
// /xp-system. All data comes from GET /api/leaderboard.
export default function LeaderboardPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Monthly ranking
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Leaderboard.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Three boards, one every month: overall XP, hackathon performance,
            and open-source contribution. Each ranking is calculated from the XP
            ledger, so it reflects exactly what has been recorded.
          </p>
        </header>

        <LeaderboardBoards />
      </Container>
    </main>
  );
}
