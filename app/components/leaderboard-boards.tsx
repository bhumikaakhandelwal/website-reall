"use client";

// Phase 4: the three monthly leaderboards, read from GET /api/leaderboard.
//
// Presentation only — the ranking is computed server-side from xp_ledger.
// Which board is which lives in lib/xp/leaderboards.ts; the titles and
// descriptions come from the shared frozen content (app/content/xp-content.ts)
// so this page and /xp-system cannot describe the same three boards
// differently.
//
// The page renders inside LoginGate, which already gates the site on the
// client-side session indicator. This component additionally treats a 401/404
// from the API the same way GlobalNavigation does: clear the client gate and
// return to /login.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Reveal } from "./reveal";
import { leaderboardTypes } from "../content/xp-content";

// Shape of GET /api/leaderboard.
type LeaderboardEntry = {
  rank: number;
  memberId: string;
  displayName: string;
  xp: number;
};

type LeaderboardBoard = {
  id: string;
  entries: LeaderboardEntry[];
};

type LeaderboardPayload = {
  period: { start: string; end: string };
  boards: LeaderboardBoard[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; payload: LeaderboardPayload };

const SKELETON_ROWS = [0, 1, 2];

// Explicit locale and UTC: the month boundary comes from the server in UTC, and
// the label must not shift with the visitor's locale or timezone.
function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function LeaderboardBoards() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped by the retry button to re-run the fetch effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLeaderboards() {
      setState({ status: "loading" });

      try {
        const response = await fetch("/api/leaderboard", {
          signal: controller.signal,
        });

        // The server session is gone (expired or cleared): drop the client
        // gate and send the visitor back to the login screen.
        if (response.status === 401 || response.status === 404) {
          localStorage.removeItem("dbce-logged-in");
          router.replace("/login");
          return;
        }

        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        const payload = (await response.json()) as LeaderboardPayload;
        setState({ status: "ready", payload });
      } catch {
        // Aborted (unmount or retry) — nothing to report.
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      }
    }

    loadLeaderboards();

    return () => controller.abort();
  }, [router, attempt]);

  if (state.status === "error") {
    return (
      <section aria-labelledby="leaderboard-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="leaderboard-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The leaderboards could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            The rankings are unchanged — the page just could not read them this
            time. Try again in a moment.
          </p>

          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-6 border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent"
          >
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  const periodLabel =
    state.status === "ready" ? formatMonth(state.payload.period.start) : null;

  return (
    <>
      {/* Period bar */}
      <div className="mt-section flex items-center justify-between gap-4 border-b border-border pb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        <span>Monthly ranking</span>

        {periodLabel ? (
          <span className="text-accent-text">{periodLabel}</span>
        ) : (
          <span
            aria-hidden="true"
            className="block h-4 w-32 animate-pulse rounded bg-muted"
          />
        )}
      </div>

      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading leaderboards
        </span>
      )}

      {leaderboardTypes.map((board, index) => {
        // null means "not loaded yet" (skeletons); an empty array means the
        // board loaded and nobody has qualifying XP this month.
        const entries: LeaderboardEntry[] | null =
          state.status === "ready"
            ? state.payload.boards.find((candidate) => candidate.id === board.id)
                ?.entries ?? []
            : null;

        return (
          <section
            key={board.id}
            aria-labelledby={`leaderboard-${board.id}`}
            className="mt-section"
          >
            <Reveal>
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-xs text-accent-text">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <h2
                  id={`leaderboard-${board.id}`}
                  className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
                >
                  {board.title}
                </h2>
              </div>

              <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
                {board.description}
              </p>
            </Reveal>

            <div className="mt-8 overflow-hidden rounded-panel border border-border">
              <div className="flex items-center justify-between bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
                <span>Member</span>
                <span>XP earned</span>
              </div>

              <ul aria-busy={entries === null}>
                {entries === null &&
                  SKELETON_ROWS.map((row) => (
                    <li
                      key={row}
                      aria-hidden="true"
                      className="flex items-center justify-between border-t border-border px-5 py-4 sm:px-7"
                    >
                      <span className="h-4 w-40 animate-pulse rounded bg-muted" />
                      <span className="h-6 w-20 animate-pulse rounded-full bg-muted" />
                    </li>
                  ))}

                {entries !== null && entries.length === 0 && (
                  <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                    No qualifying XP has been recorded for{" "}
                    {periodLabel ?? "this month"} yet.
                  </li>
                )}

                {entries !== null &&
                  entries.map((entry) => (
                    <li
                      key={entry.memberId}
                      className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 transition-colors hover:bg-accent/5 sm:px-7"
                    >
                      <div className="flex min-w-0 items-center gap-5">
                        <span
                          className={`font-mono text-xs ${
                            entry.rank === 1
                              ? "font-semibold text-accent-text"
                              : "text-muted"
                          }`}
                        >
                          {String(entry.rank).padStart(2, "0")}
                        </span>

                        <span className="truncate text-sm text-foreground sm:text-base">
                          {entry.displayName}
                        </span>
                      </div>

                      <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm font-semibold text-accent-text">
                        {entry.xp.toLocaleString()} XP
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </section>
        );
      })}
    </>
  );
}
