"use client";

// Phase 7A: the manager-only event register, read from /api/events.
//
// Presentation plus wiring only. The draft validation, the request bodies and
// what each response means all live in lib/events/events.ts, because this
// project has no DOM test environment (Node's type stripping does not transform
// JSX, so a .tsx component cannot be imported into a test at all). This file
// renders what those functions return and decides nothing.
//
// Authorization is entirely the route's job, exactly as on /members and
// /manager. This component does not decide who may see the register; it only
// distinguishes a 403 ("not a manager") from a real failure, so a normal member
// gets a plain explanation instead of an empty table.
//
// The page renders inside LoginGate, which already gates the site on the
// client-side session indicator. Like the other manager components, this one
// treats a 401/403 from the API the same way GlobalNavigation does: clear the
// client gate and return to /login.
//
// NOT HERE: attendance and bulk award. This phase creates events and lists
// them. The attendance table exists so that recording who attended can be added
// without a schema change.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACTIVITY_OPTIONS,
  EVENT_TYPES,
  activityXpPreview,
  eventTypeLabel,
  fetchEvents,
  formatEventDate,
  submitEvent,
  validateEventDraft,
  type EventDraft,
  type EventRecord,
} from "@/lib/events/events";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; events: EventRecord[] };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; title: string; activityLabel: string; xpLabel: string }
  | { status: "error"; message: string };

const EMPTY_DRAFT: EventDraft = {
  title: "",
  eventType: "",
  eventDate: "",
  activityCode: "",
};

const SKELETON_ROWS = [0, 1, 2];

// Matches the Award XP panel's field styling so the two forms look alike.
const FIELD_CLASS =
  "w-full rounded-card border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus-visible:border-accent";

const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.16em] text-muted";

export function EventManager() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<EventDraft>(EMPTY_DRAFT);
  // A field's message is only worth showing once the manager has touched it -
  // an untouched form is not full of errors.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  // Bumped by the retry button, and after a successful create, to re-run the
  // fetch effect below.
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  // A 401/403 means this session can no longer act. Drop the client gate and
  // return to the login screen, exactly as a missing session does.
  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem("dbce-logged-in");
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setState({ status: "loading" });

      const outcome = await fetchEvents(
        // Respect the abort signal while keeping the injectable-fetch contract
        // that lib/events/events.ts is tested against.
        (input, init) => fetch(input, { ...init, signal: controller.signal })
      );

      if (controller.signal.aborted) return;

      if (outcome.ok) {
        setState({ status: "ready", events: outcome.events });
        return;
      }

      if (outcome.kind === "unauthorized") {
        handleUnauthorized();
        return;
      }

      // "Not a manager" is a distinct state, not a generic error: retrying will
      // never help it, whereas the error state is worth retrying.
      setState({
        status: outcome.kind === "forbidden" ? "forbidden" : "error",
      });
    }

    load();

    return () => controller.abort();
  }, [handleUnauthorized, attempt]);

  const validation = useMemo(() => validateEventDraft(draft), [draft]);
  const xpPreview = useMemo(
    () => activityXpPreview(draft.activityCode),
    [draft.activityCode]
  );

  function update(field: keyof EventDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
    setSubmitState({ status: "idle" });
  }

  const canSubmit = submitState.status !== "submitting" && validation.ok;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const checked = validateEventDraft(draft);

    if (!checked.ok) {
      setSubmitState({ status: "error", message: checked.message });
      return;
    }

    setSubmitState({ status: "submitting" });

    const outcome = await submitEvent(draft);

    if (outcome.ok) {
      const activity = ACTIVITY_OPTIONS.find(
        (option) => option.code === checked.activityCode
      );

      setSubmitState({
        status: "success",
        title: checked.title,
        activityLabel: activity?.label ?? checked.activityCode,
        xpLabel: `+${activity?.xp ?? 0} XP`,
      });
      setDraft(EMPTY_DRAFT);
      setTouched(new Set());
      reload();
      return;
    }

    if (outcome.kind === "unauthorized") {
      handleUnauthorized();
      return;
    }

    setSubmitState({ status: "error", message: outcome.message });
  }

  /** The message for one field, or null. */
  function fieldError(field: string): string | null {
    if (!touched.has(field) || validation.ok) return null;

    return validation.field === field ? validation.message : null;
  }

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="events-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="events-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The event register is for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may view and
            record events. If you need a figure from it, ask one of them.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="events-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="events-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The event register could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nothing has changed — the page just could not read the events this
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

  const events = state.status === "ready" ? state.events : null;

  return (
    <>
      {state.status === "loading" && (
        <span role="status" className="sr-only">
          Loading events
        </span>
      )}

      {/* Create event ----------------------------------------------------- */}
      <section aria-labelledby="events-create" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="events-create"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Record an event
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Name the event and the Handbook activity it awards. The XP amount is
          resolved from that activity when attendance is awarded — it is not
          chosen here, and no XP is recorded by creating an event.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 overflow-hidden rounded-panel border border-border"
        >
          <div className="flex items-center justify-between bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span>Event</span>
            <span>Awards</span>
          </div>

          <div className="flex flex-col gap-6 border-t border-border px-5 py-6 sm:px-7 lg:flex-row lg:items-start lg:gap-8">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className={LABEL_CLASS}>Title</span>

                <input
                  type="text"
                  value={draft.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="Intro to Git workshop"
                  autoComplete="off"
                  className={FIELD_CLASS}
                />

                {fieldError("title") && (
                  <span className="text-xs text-accent-text">
                    {fieldError("title")}
                  </span>
                )}
              </label>

              <div className="flex flex-col gap-4 sm:flex-row">
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className={LABEL_CLASS}>Type</span>

                  <select
                    value={draft.eventType}
                    onChange={(event) => update("eventType", event.target.value)}
                    className={FIELD_CLASS}
                  >
                    <option value="">Select a type</option>

                    {EVENT_TYPES.map((type) => (
                      <option key={type.code} value={type.code}>
                        {type.label}
                      </option>
                    ))}
                  </select>

                  {fieldError("eventType") && (
                    <span className="text-xs text-accent-text">
                      {fieldError("eventType")}
                    </span>
                  )}
                </label>

                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className={LABEL_CLASS}>Date</span>

                  <input
                    type="date"
                    value={draft.eventDate}
                    onChange={(event) => update("eventDate", event.target.value)}
                    className={FIELD_CLASS}
                  />

                  {fieldError("eventDate") && (
                    <span className="text-xs text-accent-text">
                      {fieldError("eventDate")}
                    </span>
                  )}
                </label>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <label className="flex flex-col gap-2">
                <span className={LABEL_CLASS}>Handbook activity</span>

                <select
                  value={draft.activityCode}
                  onChange={(event) => update("activityCode", event.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">Select an activity</option>

                  {ACTIVITY_OPTIONS.map((activity) => (
                    <option key={activity.code} value={activity.code}>
                      {activity.label} — {activity.xp} XP
                    </option>
                  ))}
                </select>
              </label>

              {fieldError("activityCode") && (
                <p className="mt-2 text-xs text-accent-text">
                  {fieldError("activityCode")}
                </p>
              )}

              {/* Preview. Display only - the amount is resolved server-side
                  when attendance is awarded, never sent from here. */}
              <div className="mt-3 flex items-center justify-between gap-4 rounded-panel border border-border bg-surface px-4 py-3">
                <span className={LABEL_CLASS}>Attendance will award</span>

                {xpPreview ? (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm font-semibold text-accent-text">
                    {xpPreview}
                  </span>
                ) : (
                  <span className="font-mono text-xs text-muted">—</span>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-6 w-full border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
              >
                {submitState.status === "submitting"
                  ? "SAVING…"
                  : "CREATE EVENT →"}
              </button>
            </div>
          </div>

          {submitState.status === "submitting" && (
            <span role="status" className="sr-only">
              Saving event
            </span>
          )}

          {submitState.status === "success" && (
            <div
              role="status"
              className="border-t border-border bg-accent/10 px-5 py-5 sm:px-7"
            >
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
                Recorded
              </p>

              <p className="mt-2 text-sm text-foreground">
                <span className="font-semibold">{submitState.title}</span> added
                to the register. Attendance will award{" "}
                {submitState.activityLabel} — {submitState.xpLabel}. The list
                below has been refreshed.
              </p>
            </div>
          )}

          {submitState.status === "error" && (
            <div
              role="alert"
              className="border-t border-border bg-surface px-5 py-5 sm:px-7"
            >
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
                Not recorded
              </p>

              <p className="mt-2 text-sm text-foreground">
                {submitState.message}
              </p>
            </div>
          )}
        </form>
      </section>

      {/* Event list ------------------------------------------------------- */}
      <section aria-labelledby="events-list" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="events-list"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            The register
          </h2>
        </div>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <div className="flex items-center justify-between gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span className="min-w-0 flex-1">Event</span>
            <span className="hidden w-40 shrink-0 text-right md:block">
              Awards
            </span>
            <span className="w-28 shrink-0 text-right sm:w-36">Date</span>
          </div>

          <ul aria-busy={events === null}>
            {events === null &&
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

            {events !== null && events.length === 0 && (
              <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                No events have been recorded yet.
              </li>
            )}

            {events !== null &&
              events.map((record) => (
                <li
                  key={record.id}
                  className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 transition-colors hover:bg-accent/5 sm:px-7"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground sm:text-base">
                      {record.title}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {eventTypeLabel(record.eventType)}
                    </span>
                  </div>

                  <span className="hidden w-40 shrink-0 text-right md:block">
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent-text">
                      {record.activityCode}
                    </span>
                  </span>

                  <time
                    dateTime={record.eventDate}
                    className="w-28 shrink-0 text-right font-mono text-xs text-muted sm:w-36"
                  >
                    {formatEventDate(record.eventDate)}
                  </time>
                </li>
              ))}
          </ul>
        </div>
      </section>
    </>
  );
}
