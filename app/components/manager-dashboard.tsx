"use client";

// Phase 5C: the manager dashboard, read from GET /api/manager/dashboard.
//
// Presentation only. Every figure and every label arrives already computed:
// the counts, the month total, the signed XP labels and the formatted
// timestamps are all derived in lib/manager/dashboard.ts, because this project
// has no DOM test environment and a React component cannot be asserted on. This
// file renders what it is given and decides nothing.
//
// Authorization is entirely the route's job, exactly as on /members. This
// component does not decide who may see the dashboard; it only distinguishes a
// 403 ("not a manager") from a real failure, so a normal member gets a plain
// explanation instead of a dashboard full of zeroes.
//
// The page renders inside LoginGate, which already gates the site on the
// client-side session indicator. Like MemberDirectory and LeaderboardBoards,
// this component treats a 401/404 from the API the same way GlobalNavigation
// does: clear the client gate and return to /login.
//
// Visual language is the existing one: the numbered section heading and the
// panel + row list from /leaderboard, the accent XP pill and the stacked
// left-hand cell from /members, and the outline button from the empty states.
// No new tokens, no restyling.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Shape of GET /api/manager/dashboard.
type DashboardCards = {
  totalMembers: number;
  activeMembers: number;
  monthXp: number;
  monthLabel: string;
};

type RecentEntry = {
  entryId: number;
  memberId: string;
  displayName: string;
  xpAmount: number;
  xpLabel: string;
  reason: string;
  timestamp: string;
  createdAt: string;
};

type DashboardPayload = {
  period: { start: string; end: string };
  cards: DashboardCards;
  recent: RecentEntry[];
};

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; payload: DashboardPayload };

const QUICK_ACTIONS = [
  {
    label: "Member Directory",
    href: "/members",
    hint: "The full roster, with level and total XP",
  },
  {
    label: "Leaderboard",
    href: "/leaderboard",
    hint: "This month's three rankings",
  },
  {
    label: "XP System",
    href: "/xp-system",
    hint: "The Handbook's levels and activities",
  },
];

const SKELETON_ROWS = [0, 1, 2, 3, 4];
// Four, because there are four cards. Kept separate from SKELETON_ROWS rather
// than sliced, so changing the card count cannot silently leave a card empty.
const SKELETON_CARDS = [0, 1, 2, 3];

// The XP pill. Positive uses the same accent treatment as the directory's XP
// column; a deduction is deliberately quieter rather than a different colour,
// because the application has no danger token and inventing one would restyle
// the site.
const XP_PILL_POSITIVE =
  "border-accent/40 bg-accent/10 text-accent-text";
const XP_PILL_NEGATIVE = "border-border bg-surface text-muted";

export function ManagerDashboard() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumped by the retry button to re-run the fetch effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setState({ status: "loading" });

      try {
        const response = await fetch("/api/manager/dashboard", {
          signal: controller.signal,
        });

        // The server session is gone (expired or cleared): drop the client
        // gate and send the visitor back to the login screen.
        if (response.status === 401 || response.status === 404) {
          localStorage.removeItem("dbce-logged-in");
          router.replace("/login");
          return;
        }

        // Signed in, but not one of the two XP managers. A distinct state, not
        // a generic error: retrying will never help.
        if (response.status === 403) {
          setState({ status: "forbidden" });
          return;
        }

        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        const payload = (await response.json()) as DashboardPayload;
        setState({ status: "ready", payload });
      } catch {
        // Aborted (unmount or retry) — nothing to report.
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      }
    }

    loadDashboard();

    return () => controller.abort();
  }, [router, attempt]);

  function reload() {
    setAttempt((value) => value + 1);
  }

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="manager-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="manager-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The manager dashboard is for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may view it. If
            you need a figure from it, ask one of them.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="manager-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="manager-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The dashboard could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nothing has changed — the page just could not read the figures this
            time. Try again in a moment.
          </p>

          <button
            type="button"
            onClick={reload}
            className="mt-6 border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent"
          >
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  const payload = state.status === "ready" ? state.payload : null;
  const recent = payload?.recent ?? null;

  // Built here rather than in the API because the hints are presentation. The
  // numbers themselves are the route's.
  const cards = payload
    ? [
        {
          label: "Total Members",
          value: payload.cards.totalMembers.toLocaleString("en-US"),
          hint: "Everyone on the roster",
        },
        {
          label: "Active Members",
          value: payload.cards.activeMembers.toLocaleString("en-US"),
          hint: "Counted for the leaderboards",
        },
        {
          label: "XP Awarded This Month",
          value: payload.cards.monthXp.toLocaleString("en-US"),
          hint: "Net of corrections",
        },
        {
          label: "Current Month",
          value: payload.cards.monthLabel,
          hint: "UTC calendar month",
        },
      ]
    : null;

  return (
    <>
      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading manager dashboard
        </span>
      )}

      {/* Summary cards --------------------------------------------------- */}
      <section aria-labelledby="dashboard-summary" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="dashboard-summary"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            At a glance
          </h2>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards === null &&
            SKELETON_CARDS.map((card) => (
              <div
                key={card}
                aria-hidden="true"
                className="rounded-panel border border-border bg-surface p-6"
              >
                <span className="block h-3 w-24 animate-pulse rounded bg-muted" />
                <span className="mt-4 block h-8 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))}

          {cards !== null &&
            cards.map((card) => (
              <div
                key={card.label}
                className="rounded-panel border border-border bg-surface p-6"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                  {card.label}
                </p>

                <p className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground">
                  {card.value}
                </p>

                <p className="mt-2 text-xs text-muted">{card.hint}</p>
              </div>
            ))}
        </div>
      </section>

      {/* Quick actions --------------------------------------------------- */}
      <section aria-labelledby="dashboard-actions" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="dashboard-actions"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Quick actions
          </h2>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group flex flex-col gap-3 border border-border px-5 py-4 transition-colors hover:border-accent"
            >
              <span className="flex items-center justify-between gap-4 font-mono text-xs tracking-[0.12em] text-foreground transition-colors group-hover:text-accent">
                <span>{action.label.toUpperCase()}</span>
                <span aria-hidden="true">→</span>
              </span>

              <span className="text-xs leading-5 text-muted">
                {action.hint}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent ledger activity ------------------------------------------- */}
      <section aria-labelledby="dashboard-activity" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">03</span>

          <h2
            id="dashboard-activity"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Recent activity
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          The ten most recent XP ledger entries, newest first. A correction is
          appended rather than edited, so both it and the entry it corrects
          appear here.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <div className="flex items-center justify-between gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span className="min-w-0 flex-1">Member and reason</span>
            <span className="shrink-0 text-right">XP and time</span>
          </div>

          <ul aria-busy={recent === null}>
            {recent === null &&
              SKELETON_ROWS.map((row) => (
                <li
                  key={row}
                  aria-hidden="true"
                  className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 sm:px-7"
                >
                  <span className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <span className="h-6 w-20 animate-pulse rounded-full bg-muted" />
                </li>
              ))}

            {recent !== null && recent.length === 0 && (
              <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                No XP has been recorded yet.
              </li>
            )}

            {recent !== null &&
              recent.map((entry) => (
                <li
                  key={entry.entryId}
                  className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 transition-colors hover:bg-accent/5 sm:px-7"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground sm:text-base">
                      {entry.displayName}
                    </span>

                    {/* title so a reason longer than the column is still
                        readable on hover rather than lost to the ellipsis. */}
                    <span
                      className="truncate text-xs text-muted"
                      title={entry.reason}
                    >
                      {entry.reason}
                    </span>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`rounded-full border px-3 py-1 font-mono text-sm font-semibold ${
                        entry.xpAmount > 0
                          ? XP_PILL_POSITIVE
                          : XP_PILL_NEGATIVE
                      }`}
                    >
                      {entry.xpLabel}
                    </span>

                    <time
                      dateTime={entry.createdAt}
                      className="font-mono text-xs text-muted"
                    >
                      {entry.timestamp}
                    </time>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      </section>
    </>
  );
}
