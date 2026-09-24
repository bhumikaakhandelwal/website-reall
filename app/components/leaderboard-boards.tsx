"use client";

import { formatIstMonth } from "@/lib/dates";
import { useEffect, useState } from "react";

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
  period: {
    start: string;
    end: string;
  };
  boards: LeaderboardBoard[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; payload: LeaderboardPayload };

const SKELETON_ROWS = [0, 1, 2];

// Explicit locale and UTC.
// The month boundary comes from the server in UTC,
// and the label must not shift with the visitor's locale or timezone.
function formatMonth(iso: string): string {
  return formatIstMonth(iso);
}

export function LeaderboardBoards() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

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

        /*
         * ==========================================
         * INAUGURATION MODE
         * ==========================================
         *
         * The website is currently accessible without
         * logging in.
         *
         * Therefore, DO NOT redirect to /login here.
         *
         * If the API still returns 401/404, simply show
         * the normal error state instead of sending the
         * visitor back to the login page.
         */
        if (response.status === 401 || response.status === 404) {
          setState({ status: "error" });
          return;
        }

        /*
         * Any other unsuccessful response.
         */
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        /*
         * Successfully received leaderboard data.
         */
        const payload =
          (await response.json()) as LeaderboardPayload;

        setState({
          status: "ready",
          payload,
        });
      } catch {
        /*
         * Aborted because the component was unmounted
         * or the user clicked retry.
         */
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      }
    }

    loadLeaderboards();

    return () => {
      controller.abort();
    };
  }, [attempt]);

  /*
   * ==========================================
   * ERROR STATE
   * ==========================================
   */

  if (state.status === "error") {
    return (
      <section
        aria-labelledby="leaderboard-error"
        className="mt-section"
      >
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
            The rankings are unchanged — the page just could not
            read them this time. Try again in a moment.
          </p>

          <button
            type="button"
            onClick={() =>
              setAttempt((value) => value + 1)
            }
            className="
              mt-6
              border
              border-border
              px-5
              py-3
              font-mono
              text-xs
              tracking-[0.12em]
              transition-colors
              hover:border-accent
              hover:text-accent
            "
          >
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  /*
   * ==========================================
   * MONTH LABEL
   * ==========================================
   */

  const periodLabel =
    state.status === "ready"
      ? formatMonth(state.payload.period.start)
      : null;

  return (
    <>
      {/* ========================================
          PERIOD BAR
      ========================================= */}

      <div
        className="
          mt-section
          flex
          items-center
          justify-between
          gap-4
          border-b
          border-border
          pb-4
          text-xs
          font-semibold
          uppercase
          tracking-[0.16em]
          text-muted
        "
      >
        <span>Monthly ranking</span>

        {periodLabel ? (
          <span className="text-accent-text">
            {periodLabel}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="
              block
              h-4
              w-32
              animate-pulse
              rounded
              bg-muted
            "
          />
        )}
      </div>

      {/* ========================================
          LOADING STATUS
      ========================================= */}

      {state.status === "loading" && (
        <span
          role="status"
          className="sr-only"
        >
          Loading leaderboards
        </span>
      )}

      {/* ========================================
          THREE LEADERBOARDS
      ========================================= */}

      {leaderboardTypes.map((board, index) => {
        /*
         * null = still loading
         * []   = loaded but nobody has XP
         * array = actual leaderboard entries
         */
        const entries: LeaderboardEntry[] | null =
          state.status === "ready"
            ? state.payload.boards.find(
                (candidate) =>
                  candidate.id === board.id
              )?.entries ?? []
            : null;

        return (
          <section
            key={board.id}
            aria-labelledby={`leaderboard-${board.id}`}
            className="mt-section"
          >
            {/* ====================================
                TITLE
            ===================================== */}

            <Reveal>
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-xs text-accent-text">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <h2
                  id={`leaderboard-${board.id}`}
                  className="
                    text-3xl
                    font-semibold
                    tracking-[-0.045em]
                    text-foreground
                    sm:text-4xl
                  "
                >
                  {board.title}
                </h2>
              </div>

              <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
                {board.description}
              </p>
            </Reveal>

            {/* ====================================
                LEADERBOARD TABLE
            ===================================== */}

            <div className="mt-8 overflow-hidden rounded-panel border border-border">
              {/* Header */}

              <div
                className="
                  flex
                  items-center
                  justify-between
                  bg-surface
                  px-5
                  py-3
                  text-xs
                  font-semibold
                  uppercase
                  tracking-[0.1em]
                  text-muted
                  sm:px-7
                "
              >
                <span>Member</span>
                <span>XP earned</span>
              </div>

              <ul aria-busy={entries === null}>
                {/* =================================
                    SKELETON LOADING ROWS
                ================================== */}

                {entries === null &&
                  SKELETON_ROWS.map((row) => (
                    <li
                      key={row}
                      aria-hidden="true"
                      className="
                        flex
                        items-center
                        justify-between
                        border-t
                        border-border
                        px-5
                        py-4
                        sm:px-7
                      "
                    >
                      <span
                        className="
                          h-4
                          w-40
                          animate-pulse
                          rounded
                          bg-muted
                        "
                      />

                      <span
                        className="
                          h-6
                          w-20
                          animate-pulse
                          rounded-full
                          bg-muted
                        "
                      />
                    </li>
                  ))}

                {/* =================================
                    EMPTY LEADERBOARD
                ================================== */}

                {entries !== null &&
                  entries.length === 0 && (
                    <li
                      className="
                        border-t
                        border-border
                        px-5
                        py-6
                        text-sm
                        text-muted
                        sm:px-7
                      "
                    >
                      No qualifying XP has been
                      recorded for{" "}
                      {periodLabel ?? "this month"} yet.
                    </li>
                  )}

                {/* =================================
                    LEADERBOARD ENTRIES
                ================================== */}

                {entries !== null &&
                  entries.map((entry) => (
                    <li
                      key={entry.memberId}
                      className="
                        flex
                        items-center
                        justify-between
                        gap-4
                        border-t
                        border-border
                        px-5
                        py-4
                        transition-colors
                        hover:bg-accent/5
                        sm:px-7
                      "
                    >
                      <div
                        className="
                          flex
                          min-w-0
                          items-center
                          gap-5
                        "
                      >
                        {/* Rank */}

                        <span
                          className={`font-mono text-xs ${
                            entry.rank === 1
                              ? "font-semibold text-accent-text"
                              : "text-muted"
                          }`}
                        >
                          {String(entry.rank).padStart(
                            2,
                            "0"
                          )}
                        </span>

                        {/* Member name */}

                        <span
                          className="
                            truncate
                            text-sm
                            text-foreground
                            sm:text-base
                          "
                        >
                          {entry.displayName}
                        </span>
                      </div>

                      {/* XP */}

                      <span
                        className="
                          shrink-0
                          rounded-full
                          border
                          border-accent/40
                          bg-accent/10
                          px-3
                          py-1
                          font-mono
                          text-sm
                          font-semibold
                          text-accent-text
                        "
                      >
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