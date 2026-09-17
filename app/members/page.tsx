import type { Metadata } from "next";
import { Container } from "../components/container";
import { MemberDirectory } from "../components/member-directory";

export const metadata: Metadata = {
  title: "Member Directory",
  description:
    "The DBCE Coders Club member directory — XP manager view of every member, their level, total XP, and membership status.",
};

// Phase 5A: the manager-only member directory.
//
// The page itself is not access-controlled — it renders for anyone who can
// reach it, exactly like every other page here, because the site's gate is a
// client-side indicator and always has been. The DATA is what is protected:
// GET /api/members answers 401 without a session and 403 for anyone outside
// the two-email manager allowlist, so a normal member sees the "Managers only"
// state below rather than a roster.
//
// Visual language is the existing one (/leaderboard, /xp-system): same header
// treatment, same panel + row list used for tabular data. No new tokens, no
// restyling.
export default function MembersPage() {
  return (
    <main id="main-content" tabIndex={-1} className="px-page py-section">
      <Container>
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Manager tools
          </p>

          <h1 className="mt-5 text-display font-semibold leading-display tracking-[-0.055em] text-foreground">
            Members.
          </h1>

          <p className="mt-7 text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Every member on the roster, with the level and total XP calculated
            from the XP ledger. Visible to XP managers only.
          </p>
        </header>

        <MemberDirectory />
      </Container>
    </main>
  );
}
