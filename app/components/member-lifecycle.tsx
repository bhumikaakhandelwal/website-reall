"use client";

// Phase 8E: the manager-only member lifecycle page.
//
// Two lists - active and archived - and the two buttons that move a member
// between them. There is no delete anywhere on this page, and no way to add one:
// a member is a permanent club record that XP, attendance and event authorship
// all point at.
//
// Presentation and wiring only. The split, the confirmation copy and the client
// calls live in lib/members/lifecycle.ts, because this project has no DOM test
// environment (Node's type stripping does not transform JSX, so a .tsx component
// cannot be imported into a test at all).
//
// Authorization is entirely the route's job, exactly as on /manager and /members.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ARCHIVE_CONSEQUENCE,
  archiveMember,
  canArchive,
  describeArchive,
  restoreMember,
} from "@/lib/members/lifecycle";

type LifecycleMember = {
  memberId: string;
  email: string;
  displayName: string;
  membershipStatus: "pending" | "active" | "inactive";
  joinedAt: string;
  totalXp: number;
  archivedAt: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; active: LifecycleMember[]; archived: LifecycleMember[]; viewerId: string };

const BUTTON_CLASS =
  "border border-border px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

const SKELETON_ROWS = [0, 1, 2];

export function MemberLifecycle() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem("dbce-logged-in");
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setState({ status: "loading" });

      let response: Response | null = null;

      try {
        response = await fetch("/api/manager/members", {
          signal: controller.signal,
        });
      } catch {
        response = null;
      }

      if (controller.signal.aborted) return;

      if (response?.status === 401) {
        handleUnauthorized();
        return;
      }

      if (response?.status === 403) {
        setState({ status: "forbidden" });
        return;
      }

      if (!response?.ok) {
        setState({ status: "error" });
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        active?: unknown;
        archived?: unknown;
        viewerId?: unknown;
      } | null;

      if (!payload || !Array.isArray(payload.active) || !Array.isArray(payload.archived)) {
        setState({ status: "error" });
        return;
      }

      setState({
        status: "ready",
        active: payload.active as LifecycleMember[],
        archived: payload.archived as LifecycleMember[],
        viewerId: typeof payload.viewerId === "string" ? payload.viewerId : "",
      });
    }

    load();

    return () => controller.abort();
  }, [handleUnauthorized, attempt]);

  async function run(
    member: LifecycleMember,
    action: "archive" | "restore"
  ) {
    setBusy(member.memberId);
    setNotice(null);

    const outcome =
      action === "archive"
        ? await archiveMember(member.memberId, member.displayName)
        : await restoreMember(member.memberId, member.displayName);

    setBusy(null);
    setConfirming(null);

    if (outcome.ok) {
      setNotice(outcome.message);
      reload();
      return;
    }

    if (outcome.kind === "unauthorized") {
      handleUnauthorized();
      return;
    }

    setNotice(outcome.message);
  }

  if (state.status === "forbidden") {
    return (
      <section aria-labelledby="lifecycle-forbidden" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Restricted
          </p>

          <h2
            id="lifecycle-forbidden"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The member lifecycle is for XP managers.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Only Basil Shaikh Mohammad and Bhumika Khandelwal may archive or
            restore members.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="lifecycle-error" className="mt-section">
        <div className="rounded-panel border border-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
            Unavailable
          </p>

          <h2
            id="lifecycle-error"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
          >
            The roster could not be loaded.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nothing has changed — the page just could not read the roster this
            time. Try again in a moment.
          </p>

          <button type="button" onClick={reload} className={`mt-6 ${BUTTON_CLASS}`}>
            TRY AGAIN →
          </button>
        </div>
      </section>
    );
  }

  const ready = state.status === "ready" ? state : null;

  function renderMember(member: LifecycleMember, archived: boolean) {
    const isSelf = ready ? !canArchive(member.memberId, ready.viewerId) : false;
    const isBusy = busy === member.memberId;
    const isConfirming = confirming === member.memberId;

    return (
      <li key={member.memberId} className="border-t border-border">
        <div className="flex flex-col gap-3 px-5 py-4 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm text-foreground sm:text-base">
              {member.displayName}
            </span>

            <span className="truncate font-mono text-xs text-muted">
              {member.email}
            </span>
          </div>

          <span className="shrink-0">
            <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent-text">
              {member.totalXp.toLocaleString("en-US")} XP
            </span>
          </span>

          {archived ? (
            <button
              type="button"
              onClick={() => run(member, "restore")}
              disabled={isBusy}
              className={BUTTON_CLASS}
            >
              {isBusy ? "RESTORING..." : "RESTORE"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(isConfirming ? null : member.memberId)}
              disabled={isBusy || isSelf}
              title={isSelf ? "You cannot archive your own account" : undefined}
              className={BUTTON_CLASS}
            >
              ARCHIVE
            </button>
          )}
        </div>

        {isConfirming && (
          <div className="border-t border-border bg-surface px-5 py-4 sm:px-7">
            <p className="text-sm text-foreground">
              {describeArchive(member.displayName)}
            </p>

            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              {ARCHIVE_CONSEQUENCE}
            </p>

            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => run(member, "archive")}
                disabled={isBusy}
                className={BUTTON_CLASS}
              >
                {isBusy ? "ARCHIVING..." : "ARCHIVE"}
              </button>

              <button
                type="button"
                onClick={() => setConfirming(null)}
                className={BUTTON_CLASS}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/manager/members/add"
          className="border border-border px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          ADD MEMBER →
        </Link>

        <Link
          href="/members"
          className="border border-border px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          MEMBER DIRECTORY →
        </Link>
      </div>

      {notice && (
        <p
          role="status"
          className="mt-6 border border-border bg-accent/5 p-4 font-mono text-[11px] leading-5 tracking-[0.06em] text-foreground"
        >
          {notice}
        </p>
      )}

      {/* Active ------------------------------------------------------------ */}
      <section aria-labelledby="lifecycle-active" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="lifecycle-active"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Active members
            {ready !== null && (
              <span className="ml-3 font-mono text-base font-normal tracking-normal text-muted">
                ({ready.active.length})
              </span>
            )}
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Everyone currently on the roster. Archiving hides a member from the
          directory, the attendance picker and new XP — it never removes their
          history, and it never stops them signing in.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <ul aria-busy={ready === null}>
            {ready === null &&
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

            {ready !== null && ready.active.length === 0 && (
              <li className="px-5 py-6 text-sm text-muted sm:px-7">
                No active members.
              </li>
            )}

            {ready !== null &&
              ready.active.map((member) => renderMember(member, false))}
          </ul>
        </div>
      </section>

      {/* Archived ---------------------------------------------------------- */}
      <section aria-labelledby="lifecycle-archived" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="lifecycle-archived"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Archived members
            {ready !== null && (
              <span className="ml-3 font-mono text-base font-normal tracking-normal text-muted">
                ({ready.archived.length})
              </span>
            )}
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Members who have left the working roster. Their XP, attendance and
          event history are all intact, and they are the only place an archived
          member is listed.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <ul aria-busy={ready === null}>
            {ready === null &&
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

            {ready !== null && ready.archived.length === 0 && (
              <li className="px-5 py-6 text-sm text-muted sm:px-7">
                No members have been archived.
              </li>
            )}

            {ready !== null &&
              ready.archived.map((member) => renderMember(member, true))}
          </ul>
        </div>
      </section>
    </>
  );
}
