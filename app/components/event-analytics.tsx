"use client";

// Phase 8B: the manager-only event analytics, read from /api/manager/analytics.
//
// Presentation and wiring only. Every figure is computed server-side by
// lib/events/analytics.ts and arrives ready to render, because this project has
// no DOM test environment (Node's type stripping does not transform JSX, so a
// .tsx component cannot be imported into a test at all). The arithmetic is
// asserted on in that module; this file formats and lays it out.
//
// Authorization is entirely the route's job, exactly as on /manager and /events.
// This component only distinguishes the failures a manager can act on: 401
// re-gates, 403 shows a plain explanation, and everything else is retryable.
//
// READ-ONLY. There is no form, no action and no write anywhere on this page.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatAverage,
  loadAnalytics,
  type EventAnalytics as Analytics,
} from "@/lib/events/analytics";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; analytics: Analytics };

const BUTTON_CLASS =
  "border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent";

const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.16em] text-muted";

const SKELETON_CARDS = [0, 1, 2, 3];
const SKELETON_ROWS = [0, 1, 2];

export function EventAnalytics() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem("dbce-logged-in");
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setState({ status: "loading" });

      const outcome = await loadAnalytics((input, init) =>
        fetch(input, { ...init, signal: controller.signal })
      );

      if (controller.signal.aborted) return;

      if (outcome.ok) {
        setState({ status: "ready", analytics: outcome.analytics });
        return;
      }

      if (outcome.kind === "unauthorized") {
        handleUnauthorized();
        return;
      }

      setState({ status: outcome.kind === "forbidden" ? "forbidden" : "error" });
    }

    load();

    return () => controller.abort();
  }, [handleUnauthorized, attempt]);

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="analytics-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="analytics-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            Event analytics are for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may view them. If
            you need a figure from here, ask one of them.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="analytics-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="analytics-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The analytics could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nothing has changed — the page just could not read the figures this
            time. Try again in a moment.
          </p>

          <button type="button" onClick={reload} className={`mt-6 ${BUTTON_CLASS}`}>
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  const analytics = state.status === "ready" ? state.analytics : null;

  const cards = analytics
    ? [
        {
          label: "Total events",
          value: analytics.totalEvents.toLocaleString("en-US"),
          hint: "Everything on the register, archived included",
        },
        {
          label: "Total attendance records",
          value: analytics.totalAttendance.toLocaleString("en-US"),
          hint: "One per member per event they were recorded at",
        },
        {
          label: "Average attendance",
          value: formatAverage(analytics.averageAttendance),
          hint: "Members per event, across every event",
        },
        {
          label: "XP awarded through attendance",
          value: analytics.xpThroughAttendance.toLocaleString("en-US"),
          hint: "Awarded against recorded attendance only",
        },
      ]
    : null;

  // The trend bar is scaled against the busiest month, so the tallest bar is
  // always full width whatever the numbers are.
  const busiestMonth = analytics
    ? analytics.trend.reduce((max, point) => Math.max(max, point.attendance), 0)
    : 0;

  return (
    <>
      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading analytics
        </span>
      )}

      {/* At a glance ------------------------------------------------------- */}
      <section aria-labelledby="analytics-summary" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="analytics-summary"
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
                <p className={LABEL_CLASS}>{card.label}</p>

                <p className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground">
                  {card.value}
                </p>

                <p className="mt-2 text-xs text-muted">{card.hint}</p>
              </div>
            ))}
        </div>

        {analytics !== null && analytics.totalEvents === 0 && (
          <p className="mt-6 max-w-2xl text-sm leading-6 text-muted">
            No events have been recorded yet, so there is nothing to measure.
            Record one on the register and the figures here will follow it.
          </p>
        )}
      </section>

      {/* Highest-attended -------------------------------------------------- */}
      <section aria-labelledby="analytics-highest" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="analytics-highest"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Best attended
          </h2>
        </div>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          {analytics === null && (
            <div
              aria-hidden="true"
              className="flex items-center justify-between gap-4 px-5 py-6 sm:px-7"
            >
              <span className="h-4 w-40 animate-pulse rounded bg-muted" />
              <span className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          )}

          {analytics !== null && analytics.highestAttended === null && (
            <p className="px-5 py-6 text-sm text-muted sm:px-7">
              No attendance has been recorded yet, so there is no best-attended
              event.
            </p>
          )}

          {analytics !== null && analytics.highestAttended !== null && (
            <div className="flex flex-col gap-3 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base text-foreground sm:text-lg">
                  {analytics.highestAttended.title}
                </span>

                <span className="text-xs text-muted">
                  The most members recorded at any one event
                </span>
              </div>

              <span className="shrink-0">
                <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm font-semibold text-accent-text">
                  {analytics.highestAttended.attendanceCount.toLocaleString("en-US")}{" "}
                  attended
                </span>
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Attendance by month ---------------------------------------------- */}
      <section aria-labelledby="analytics-trend" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">03</span>

          <h2
            id="analytics-trend"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Attendance by month
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Grouped by the month each event was held in, oldest first. A month with
          an event that nobody attended shows as zero rather than being left out.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <ul aria-busy={analytics === null}>
            {analytics === null &&
              SKELETON_ROWS.map((row) => (
                <li
                  key={row}
                  aria-hidden="true"
                  className="border-t border-border px-5 py-4 sm:px-7"
                >
                  <span className="block h-4 w-32 animate-pulse rounded bg-muted" />
                </li>
              ))}

            {analytics !== null && analytics.trend.length === 0 && (
              <li className="px-5 py-6 text-sm text-muted sm:px-7">
                No events have been recorded yet.
              </li>
            )}

            {analytics !== null &&
              analytics.trend.map((point) => (
                <li
                  key={point.month}
                  className="flex items-center gap-4 border-t border-border px-5 py-4 sm:px-7"
                >
                  <span className="w-24 shrink-0 font-mono text-xs text-muted">
                    {point.label}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block h-2 overflow-hidden rounded-full bg-surface">
                      <span
                        className="block h-2 rounded-full bg-accent/50"
                        style={{
                          width: `${
                            busiestMonth === 0
                              ? 0
                              : Math.round((point.attendance / busiestMonth) * 100)
                          }%`,
                        }}
                      />
                    </span>
                  </span>

                  <span className="w-16 shrink-0 text-right font-mono text-sm text-foreground">
                    {point.attendance.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </section>

      {/* Event types ------------------------------------------------------ */}
      <section aria-labelledby="analytics-types" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">04</span>

          <h2
            id="analytics-types"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Event types
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Which kinds of event the club runs, and how they draw. Types with no
          events are left out rather than listed as zeroes.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <div className="flex items-center justify-between gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span className="min-w-0 flex-1">Type</span>
            <span className="w-20 shrink-0 text-right">Events</span>
            <span className="hidden w-28 shrink-0 text-right sm:block">
              Attendance
            </span>
            <span className="hidden w-24 shrink-0 text-right md:block">XP</span>
          </div>

          <ul aria-busy={analytics === null}>
            {analytics === null &&
              SKELETON_ROWS.map((row) => (
                <li
                  key={row}
                  aria-hidden="true"
                  className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 sm:px-7"
                >
                  <span className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <span className="h-6 w-16 animate-pulse rounded-full bg-muted" />
                </li>
              ))}

            {analytics !== null && analytics.breakdown.length === 0 && (
              <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                No events have been recorded yet.
              </li>
            )}

            {analytics !== null &&
              analytics.breakdown.map((row) => (
                <li
                  key={row.eventType}
                  className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 sm:px-7"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground sm:text-base">
                    {row.label}
                  </span>

                  <span className="w-20 shrink-0 text-right font-mono text-sm text-foreground">
                    {row.events.toLocaleString("en-US")}
                  </span>

                  <span className="hidden w-28 shrink-0 text-right font-mono text-sm text-muted sm:block">
                    {row.attendance.toLocaleString("en-US")}
                  </span>

                  <span className="hidden w-24 shrink-0 text-right md:block">
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent-text">
                      {row.xp.toLocaleString("en-US")}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </section>
    </>
  );
}
