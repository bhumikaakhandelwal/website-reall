"use client";

// Phase 8C: the manager-only XP ledger explorer, read from /api/manager/ledger.
//
// Presentation and wiring only. The enrichment and all four filters live in
// lib/manager/ledger.ts, because this project has no DOM test environment (Node's
// type stripping does not transform JSX, so a .tsx component cannot be imported
// into a test at all). This file renders what those functions return and decides
// nothing.
//
// Filtering happens HERE, over the whole ledger, rather than as a server round
// trip per keystroke - the same choice the member directory makes, and for the
// same reason: the ledger is a few hundred rows and a request per keystroke would
// buy nothing.
//
// Authorization is entirely the route's job, exactly as on /manager and /events.
// This component only distinguishes the failures a manager can act on: 401
// re-gates, 403 shows a plain explanation, and everything else is retryable.
//
// READ-ONLY. There is no form, no action and no write anywhere on this page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_LEDGER_FILTERS,
  activityOptions,
  filterLedgerEntries,
  loadLedger,
  summariseLedger,
  type LedgerEntry,
  type LedgerEntryKind,
  type LedgerFilters,
} from "@/lib/manager/ledger";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; entries: LedgerEntry[] };

const FIELD_CLASS =
  "w-full rounded-card border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus-visible:border-accent";

const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.16em] text-muted";

const BUTTON_CLASS =
  "border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent";

const SKELETON_ROWS = [0, 1, 2, 3, 4];

// A positive entry uses the same accent treatment as the XP pill everywhere
// else; a deduction is deliberately quieter rather than a different colour,
// because the application has no danger token and inventing one would restyle
// the site.
const XP_PILL_POSITIVE = "border-accent/40 bg-accent/10 text-accent-text";
const XP_PILL_NEGATIVE = "border-border bg-surface text-muted";

const KIND_OPTIONS: { value: LedgerEntryKind; label: string }[] = [
  { value: "all", label: "Awards and corrections" },
  { value: "award", label: "Awards only" },
  { value: "correction", label: "Corrections only" },
];

/** True when any filter is narrowing the list. */
function isFiltered(filters: LedgerFilters): boolean {
  return (
    filters.memberQuery.trim() !== "" ||
    filters.activityCode !== "" ||
    filters.kind !== "all" ||
    filters.from !== "" ||
    filters.to !== ""
  );
}

export function XpLedgerExplorer() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filters, setFilters] = useState<LedgerFilters>(EMPTY_LEDGER_FILTERS);
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

      const outcome = await loadLedger((input, init) =>
        fetch(input, { ...init, signal: controller.signal })
      );

      if (controller.signal.aborted) return;

      if (outcome.ok) {
        setState({ status: "ready", entries: outcome.entries });
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

  const entries = state.status === "ready" ? state.entries : null;

  const options = useMemo(() => activityOptions(entries ?? []), [entries]);

  const filtered = useMemo(
    () => (entries === null ? null : filterLedgerEntries(entries, filters)),
    [entries, filters]
  );

  const summary = useMemo(
    () =>
      filtered === null
        ? null
        : summariseLedger(filtered, entries?.length ?? 0),
    [filtered, entries]
  );

  function update<K extends keyof LedgerFilters>(field: K, value: LedgerFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="ledger-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="ledger-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The XP ledger is for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may read it. If you
            need a figure from it, ask one of them.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="ledger-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="ledger-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The ledger could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nothing has changed — the page just could not read the entries this
            time. Try again in a moment.
          </p>

          <button type="button" onClick={reload} className={`mt-6 ${BUTTON_CLASS}`}>
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading the XP ledger
        </span>
      )}

      {/* Filters ----------------------------------------------------------- */}
      <section aria-labelledby="ledger-filters" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="ledger-filters"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Narrow it down
          </h2>
        </div>

        <div className="mt-8 grid gap-4 border-b border-border pb-6 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-2">
            <span className={LABEL_CLASS}>Member</span>

            <input
              type="search"
              value={filters.memberQuery}
              onChange={(event) => update("memberQuery", event.target.value)}
              placeholder="Name or email"
              autoComplete="off"
              spellCheck={false}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-2">
            <span className={LABEL_CLASS}>Activity</span>

            <select
              value={filters.activityCode}
              onChange={(event) => update("activityCode", event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">Every activity</option>

              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-2">
            <span className={LABEL_CLASS}>Entry</span>

            <select
              value={filters.kind}
              onChange={(event) =>
                update("kind", event.target.value as LedgerEntryKind)
              }
              className={FIELD_CLASS}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex min-w-0 flex-col gap-2">
            <span className={LABEL_CLASS}>Date range</span>

            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="sr-only">From date</span>

                <input
                  type="date"
                  value={filters.from}
                  onChange={(event) => update("from", event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>

              <span aria-hidden="true" className="text-xs text-muted">
                –
              </span>

              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="sr-only">To date</span>

                <input
                  type="date"
                  value={filters.to}
                  onChange={(event) => update("to", event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <span
            aria-live="polite"
            className="text-xs font-semibold uppercase tracking-[0.16em] text-muted"
          >
            {summary === null
              ? "Loading ledger"
              : summary.shown === summary.total
                ? `${summary.total} ${summary.total === 1 ? "entry" : "entries"}`
                : `${summary.shown} of ${summary.total} entries`}
          </span>

          {isFiltered(filters) && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_LEDGER_FILTERS)}
              className={BUTTON_CLASS}
            >
              CLEAR FILTERS
            </button>
          )}
        </div>

        {summary !== null && summary.shown > 0 && (
          <p className="mt-3 text-xs text-muted">
            {summary.awards} {summary.awards === 1 ? "award" : "awards"} ·{" "}
            {summary.corrections}{" "}
            {summary.corrections === 1 ? "correction" : "corrections"} · net{" "}
            <span className="font-mono">
              {summary.netXp > 0 ? "+" : ""}
              {summary.netXp.toLocaleString("en-US")} XP
            </span>
          </p>
        )}
      </section>

      {/* The ledger -------------------------------------------------------- */}
      <section aria-labelledby="ledger-entries" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="ledger-entries"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Every entry
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Newest first. A correction is a separate entry that reverses an earlier
          one, so both appear — the audit trail is append-only and nothing is ever
          edited out of it.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <div className="flex items-center justify-between gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span className="min-w-0 flex-1">Member and reason</span>
            <span className="shrink-0 text-right">XP and when</span>
          </div>

          <ul aria-busy={filtered === null}>
            {filtered === null &&
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

            {filtered !== null && filtered.length === 0 && (
              <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                {entries !== null && entries.length === 0
                  ? "No XP has been recorded yet."
                  : "No entries match these filters."}
              </li>
            )}

            {filtered !== null &&
              filtered.map((entry) => (
                <li
                  key={entry.entryId}
                  className="flex items-start justify-between gap-4 border-t border-border px-5 py-4 transition-colors hover:bg-accent/5 sm:px-7"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm text-foreground sm:text-base">
                      {entry.displayName}
                    </span>

                    <span className="truncate text-xs text-muted">
                      {entry.activityLabel} · {entry.reason}
                    </span>

                    {entry.eventTitle && (
                      <span className="truncate text-xs text-muted">
                        Event: {entry.eventTitle}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full border px-3 py-1 font-mono text-sm font-semibold ${
                        entry.xpAmount > 0 ? XP_PILL_POSITIVE : XP_PILL_NEGATIVE
                      }`}
                    >
                      {entry.xpLabel}
                    </span>

                    {/* The activity CODE, which is what the ledger stores. The
                        label above is the Handbook wording for the same thing. */}
                    <span className="font-mono text-xs text-muted">
                      {entry.activityCode ?? "—"}
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
