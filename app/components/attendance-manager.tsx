"use client";

// Phase 7B: the attendance page for one event.
//
// Presentation and wiring only. The member search, the awarded/unawarded split,
// the counts and what every response means all live in lib/events/attendance.ts,
// because this project has no DOM test environment (Node's type stripping does
// not transform JSX, so a .tsx component cannot be imported into a test at all).
// This file renders what those functions return and decides nothing.
//
// Authorization is entirely the routes' job, exactly as on /events and
// /members. This component only distinguishes the failures a manager can act on
// from those they cannot: 401 re-gates, 403 and 404 show a plain explanation,
// and everything else is a retryable error.
//
// NOTHING HERE CHOOSES AN XP AMOUNT. The amount is resolved server-side from the
// event's Handbook activity code and arrives in the payload; the award request
// carries no body at all.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activityLabelFor,
  attendanceStats,
  awardAttendance,
  filterMembers,
  formatXpAmount,
  loadAttendance,
  saveAttendance,
  splitAttendance,
  type AttendancePayload,
} from "@/lib/events/attendance";
import { eventTypeLabel, formatEventDate } from "@/lib/events/events";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "ready"; payload: AttendancePayload };

type ActionState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

const FIELD_CLASS =
  "w-full rounded-card border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus-visible:border-accent";

const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.16em] text-muted";

const BUTTON_CLASS =
  "border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground";

const SKELETON_ROWS = [0, 1, 2, 3, 4];

export function AttendanceManager({ eventId }: { eventId: string }) {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  // The members currently checked. Seeded from the saved attendance and then
  // owned by the manager until they save.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ActionState>({ status: "idle" });
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

      const outcome = await loadAttendance(eventId, (input, init) =>
        fetch(input, { ...init, signal: controller.signal })
      );

      if (controller.signal.aborted) return;

      if (outcome.ok) {
        setState({ status: "ready", payload: outcome.payload });
        // Seed the checkboxes from what is saved. A reload after awarding
        // therefore re-seeds with the awarded rows still checked and now
        // locked, which is what "refresh the event after awarding" means.
        setSelected(splitAttendance(outcome.payload.attendance).present);
        return;
      }

      if (outcome.kind === "unauthorized") {
        handleUnauthorized();
        return;
      }

      if (outcome.kind === "forbidden") {
        setState({ status: "forbidden" });
        return;
      }

      if (outcome.kind === "notFound") {
        setState({ status: "notFound" });
        return;
      }

      setState({ status: "error" });
    }

    load();

    return () => controller.abort();
  }, [eventId, handleUnauthorized, attempt]);

  const payload = state.status === "ready" ? state.payload : null;

  const { present, awarded } = useMemo(
    () => splitAttendance(payload?.attendance ?? []),
    [payload]
  );

  const filtered = useMemo(
    () => filterMembers(payload?.members ?? [], query),
    [payload, query]
  );

  const stats = useMemo(
    () => attendanceStats(payload?.attendance ?? []),
    [payload]
  );

  function toggle(memberId: string) {
    // An awarded member cannot be un-recorded: the XP has been given and the
    // ledger points at the attendance row. The route enforces this too; the
    // disabled checkbox is just the honest interface for it.
    if (awarded.has(memberId)) return;

    setSelected((current) => {
      const next = new Set(current);

      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }

      return next;
    });

    setAction({ status: "idle" });
  }

  function selectAllFiltered() {
    setSelected((current) => {
      const next = new Set(current);

      for (const member of filtered) {
        if (!awarded.has(member.memberId)) next.add(member.memberId);
      }

      return next;
    });

    setAction({ status: "idle" });
  }

  function clearFiltered() {
    setSelected((current) => {
      const next = new Set(current);

      for (const member of filtered) {
        if (!awarded.has(member.memberId)) next.delete(member.memberId);
      }

      return next;
    });

    setAction({ status: "idle" });
  }

  async function handleSave() {
    setAction({ status: "busy" });

    const outcome = await saveAttendance(eventId, [...selected]);

    if (outcome.ok) {
      setAction({ status: "done", message: outcome.message });
      reload();
      return;
    }

    if (outcome.kind === "unauthorized") {
      handleUnauthorized();
      return;
    }

    setAction({ status: "error", message: outcome.message });
  }

  async function handleAward() {
    setAction({ status: "busy" });

    const outcome = await awardAttendance(eventId);

    if (outcome.ok) {
      setAction({ status: "done", message: outcome.message });
      // Refresh so the newly awarded members show as locked and the counts move.
      reload();
      return;
    }

    if (outcome.kind === "unauthorized") {
      handleUnauthorized();
      return;
    }

    setAction({ status: "error", message: outcome.message });
  }

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="attendance-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="attendance-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            Attendance is for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may record
            attendance and award it. If you need a figure from it, ask one of
            them.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "notFound") {
    return (
      <section aria-labelledby="attendance-notfound" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Not found
          </p>

          <h2
            id="attendance-notfound"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            That event no longer exists.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            It may have been removed since the register was loaded. Go back to
            the register and pick another.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="attendance-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="attendance-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The attendance register could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nothing has changed — the page just could not read the event this
            time. Try again in a moment.
          </p>

          <button type="button" onClick={reload} className={`mt-6 ${BUTTON_CLASS}`}>
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  const canSave = action.status !== "busy";
  const canAward =
    action.status !== "busy" && Boolean(payload?.awardable) && stats.awaiting > 0;

  return (
    <>
      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading attendance
        </span>
      )}

      {/* The event -------------------------------------------------------- */}
      <section aria-labelledby="attendance-event" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="attendance-event"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            {payload ? payload.event.title : "The event"}
          </h2>
        </div>

        {payload ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs uppercase tracking-[0.08em] text-muted">
              {eventTypeLabel(payload.event.eventType)}
            </span>

            <span className="font-mono text-xs text-muted">
              {formatEventDate(payload.event.eventDate)}
            </span>

            <span
              className={`rounded-full border px-3 py-1 font-mono text-xs ${
                payload.awardable
                  ? "border-accent/40 bg-accent/10 text-accent-text"
                  : "border-border bg-surface text-muted"
              }`}
            >
              {activityLabelFor(payload.event.activityCode)}
              {payload.awardable ? ` — ${formatXpAmount(payload.xpAmount)}` : ""}
            </span>
          </div>
        ) : (
          <span
            aria-hidden="true"
            className="mt-6 block h-6 w-64 animate-pulse rounded-full bg-muted"
          />
        )}

        {payload && !payload.awardable && (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-accent-text">
            This event names an activity that is no longer in the Handbook, so
            it cannot award XP. Attendance can still be recorded.
          </p>
        )}
      </section>

      {/* Who was there ---------------------------------------------------- */}
      <section aria-labelledby="attendance-roster" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="attendance-roster"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Who was there
          </h2>
        </div>

        {/* Search + bulk select */}
        <div className="mt-8 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex w-full flex-col gap-2 sm:max-w-sm">
            <span className={LABEL_CLASS}>Search</span>

            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or email"
              autoComplete="off"
              spellCheck={false}
              className={FIELD_CLASS}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={selectAllFiltered}
              className={BUTTON_CLASS}
            >
              SELECT ALL
            </button>

            <button type="button" onClick={clearFiltered} className={BUTTON_CLASS}>
              CLEAR
            </button>
          </div>
        </div>

        <span
          aria-live="polite"
          className="mt-4 block text-xs font-semibold uppercase tracking-[0.16em] text-muted"
        >
          {payload
            ? `${stats.present} recorded · ${stats.awarded} awarded · ${stats.awaiting} awaiting`
            : "Loading roster"}
        </span>

        <div className="mt-6 overflow-hidden rounded-panel border border-border">
          <div className="flex items-center justify-between gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span className="min-w-0 flex-1">Member</span>
            <span className="shrink-0 text-right">Status</span>
          </div>

          <ul aria-busy={payload === null}>
            {payload === null &&
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

            {payload !== null && filtered.length === 0 && (
              <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                {payload.members.length === 0
                  ? "No members are on the roster yet."
                  : `No members match “${query.trim()}”.`}
              </li>
            )}

            {filtered.map((member) => {
              const isAwarded = awarded.has(member.memberId);
              const isChecked = selected.has(member.memberId);

              return (
                <li key={member.memberId} className="border-t border-border">
                  <label
                    className={`flex items-center gap-4 px-5 py-4 transition-colors sm:px-7 ${
                      isAwarded ? "cursor-default" : "cursor-pointer hover:bg-accent/5"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isAwarded}
                      onChange={() => toggle(member.memberId)}
                      className="h-4 w-4 shrink-0 accent-accent"
                    />

                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-foreground sm:text-base">
                        {member.displayName}
                      </span>
                      <span className="truncate font-mono text-xs text-muted">
                        {member.email}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      {isAwarded ? (
                        <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent-text">
                          Awarded
                        </span>
                      ) : isChecked ? (
                        <span className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-muted">
                          Present
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-muted">—</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {present.size > 0 && (
          <p className="mt-4 text-xs text-muted">
            {present.size} {present.size === 1 ? "member is" : "members are"}{" "}
            recorded. An awarded member cannot be unchecked — reverse the XP with
            a correction instead.
          </p>
        )}
      </section>

      {/* Actions ---------------------------------------------------------- */}
      <section aria-labelledby="attendance-actions" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">03</span>

          <h2
            id="attendance-actions"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Save and award
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Saving records who was present. Awarding writes one XP entry per
          recorded member who has not been awarded yet — it is safe to run more
          than once, and a second run awards nobody.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={BUTTON_CLASS}
          >
            {action.status === "busy" ? "WORKING…" : "SAVE ATTENDANCE"}
          </button>

          <button
            type="button"
            onClick={handleAward}
            disabled={!canAward}
            className={BUTTON_CLASS}
          >
            AWARD ATTENDANCE XP
            {payload?.awardable && stats.awaiting > 0
              ? ` — ${stats.awaiting} × ${formatXpAmount(payload.xpAmount)}`
              : ""}
          </button>
        </div>

        {payload?.awardable && stats.awaiting === 0 && stats.present > 0 && (
          <p className="mt-4 text-xs text-muted">
            Everyone recorded on this event has been awarded. Nothing left to do.
          </p>
        )}

        {action.status === "busy" && (
          <span role="status" className="sr-only">
            Working
          </span>
        )}

        {action.status === "done" && (
          <div
            role="status"
            className="mt-6 rounded-panel border border-border bg-accent/10 px-5 py-5 sm:px-7"
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
              Done
            </p>

            <p className="mt-2 text-sm text-foreground">{action.message}</p>
          </div>
        )}

        {action.status === "error" && (
          <div
            role="alert"
            className="mt-6 rounded-panel border border-border bg-surface px-5 py-5 sm:px-7"
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
              Not saved
            </p>

            <p className="mt-2 text-sm text-foreground">{action.message}</p>
          </div>
        )}
      </section>
    </>
  );
}
