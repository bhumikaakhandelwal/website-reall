"use client";

// Phase 5A: the manager-only member directory, read from GET /api/members.
//
// Presentation plus one piece of client logic: the name/email filter. Filtering
// happens here, over the whole roster, rather than as a server round-trip per
// keystroke - the roster is a few dozen rows and the API deliberately has no
// search parameter.
//
// Authorization is entirely the route's job. This component does not decide who
// may see the roster; it only distinguishes a 403 ("not a manager") from a real
// failure, so a normal member gets a plain explanation instead of a broken
// table.
//
// The page renders inside LoginGate, which already gates the site on the
// client-side session indicator. Like LeaderboardBoards, this component treats
// a 401/404 from the API the same way GlobalNavigation does: clear the client
// gate and return to /login.
//
// Phase 5B adds the Award XP panel above the table. It is rendered only in the
// "ready" state - which is reached only when this fetch answered 200, i.e. only
// for a manager - so a 403 never shows it. The panel calls back into
// `loadDirectory` after a successful award so the new total and level appear
// immediately, rather than the manager having to reload the page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AwardXpPanel } from "./award-xp-panel";

// Shape of GET /api/members.
type DirectoryEntry = {
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: "pending" | "active" | "inactive";
  joinedAt: string;
  totalXp: number;
  level: number;
  levelName: string;
};

type DirectoryPayload = {
  entries: DirectoryEntry[];
};

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; entries: DirectoryEntry[] };

const SKELETON_ROWS = [0, 1, 2, 3, 4];

// Explicit locale and UTC: `created_at` is a TIMESTAMPTZ written by the
// database in UTC, and a join date must not shift a day with the visitor's
// timezone.
function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Display-only. The stored value stays the enum the database enforces; this
// only capitalises it for the table.
function formatStatus(status: DirectoryEntry["membershipStatus"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const STATUS_STYLES: Record<DirectoryEntry["membershipStatus"], string> = {
  active: "border-accent/40 bg-accent/10 text-accent-text",
  pending: "border-border bg-surface text-muted",
  inactive: "border-border text-muted",
};

export function MemberDirectory() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  // Bumped by the retry button, and by the award panel after a successful
  // award, to re-run the fetch effect below.
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  // A 401/403 from the award panel means this session can no longer act. Drop
  // the client gate and withdraw the panel, exactly as a missing session does.
  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem("dbce-logged-in");
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDirectory() {
      setState({ status: "loading" });

      try {
        const response = await fetch("/api/members", {
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

        const payload = (await response.json()) as DirectoryPayload;
        setState({ status: "ready", entries: payload.entries ?? [] });
      } catch {
        // Aborted (unmount or retry) — nothing to report.
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      }
    }

    loadDirectory();

    return () => controller.abort();
  }, [router, attempt]);

  const entries = state.status === "ready" ? state.entries : null;

  // Name OR email, case-insensitive, over the whole roster.
  const filtered = useMemo(() => {
    if (!entries) return null;

    const needle = query.trim().toLowerCase();

    if (!needle) return entries;

    return entries.filter(
      (entry) =>
        entry.displayName.toLowerCase().includes(needle) ||
        entry.email.toLowerCase().includes(needle)
    );
  }, [entries, query]);

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="members-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="members-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The member directory is for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may view the
            roster. If you need a figure from it, ask one of them.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="members-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="members-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The directory could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            The roster is unchanged — the page just could not read it this time.
            Try again in a moment.
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

  const total = entries?.length ?? null;

  return (
    <>
      {/* Phase 5B: managers only. Reached only when GET /api/members answered
          200; a 403 returns the "forbidden" panel above and never gets here.
          `entries` is the same roster the table below shows, so the selector
          and the table can never disagree. */}
      {entries !== null && (
        <AwardXpPanel
          members={entries}
          onAwarded={reload}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {/* Search bar */}
      <div className="mt-section flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex w-full flex-col gap-2 sm:max-w-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Search
          </span>

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or email"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-card border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus-visible:border-accent"
          />
        </label>

        <span
          aria-live="polite"
          className="text-xs font-semibold uppercase tracking-[0.16em] text-muted"
        >
          {filtered === null
            ? "Loading roster"
            : query.trim()
              ? `${filtered.length} of ${total} members`
              : `${total} ${total === 1 ? "member" : "members"}`}
        </span>
      </div>

      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading member directory
        </span>
      )}

      <div className="mt-8 overflow-hidden rounded-panel border border-border">
        {/* Column header. The XP column is dropped before the date column on
            narrow screens, where five columns would not fit. */}
        <div className="flex items-center justify-between gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
          <span className="min-w-0 flex-1">Member</span>
          <span className="hidden w-28 shrink-0 text-right md:block">Level</span>
          <span className="w-24 shrink-0 text-right sm:w-28">Total XP</span>
          <span className="hidden w-24 shrink-0 text-right sm:block">
            Status
          </span>
          <span className="hidden w-28 shrink-0 text-right lg:block">
            Joined
          </span>
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
              {total === 0
                ? "No members are on the roster yet."
                : `No members match “${query.trim()}”.`}
            </li>
          )}

          {filtered !== null &&
            filtered.map((entry) => (
              <li
                key={entry.memberId}
                className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 transition-colors hover:bg-accent/5 sm:px-7"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground sm:text-base">
                    {entry.displayName}
                  </span>
                  <span className="truncate font-mono text-xs text-muted">
                    {entry.email}
                  </span>
                </div>

                <span className="hidden w-28 shrink-0 text-right font-mono text-xs text-accent-text md:block">
                  {String(entry.level).padStart(2, "0")}
                </span>

                <span className="w-24 shrink-0 text-right sm:w-28">
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm font-semibold text-accent-text">
                    {entry.totalXp.toLocaleString()} XP
                  </span>
                </span>

                <span className="hidden w-24 shrink-0 text-right sm:block">
                  <span
                    className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.08em] ${
                      STATUS_STYLES[entry.membershipStatus]
                    }`}
                  >
                    {formatStatus(entry.membershipStatus)}
                  </span>
                </span>

                <span className="hidden w-28 shrink-0 text-right font-mono text-xs text-muted lg:block">
                  {formatJoined(entry.joinedAt)}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </>
  );
}
