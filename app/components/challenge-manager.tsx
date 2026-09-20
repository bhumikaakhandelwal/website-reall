"use client";

// Phase 9: the manager's challenge console - the review queue and the catalogue.
//
// Presentation and wiring only. The decisions live in
// lib/challenges/challenges.ts, because this project has no DOM test environment
// (Node's type stripping does not transform JSX, so a .tsx component cannot be
// imported into a test at all).
//
// APPROVING IS THE ONLY THING HERE THAT AWARDS XP, and it does so exactly once:
// the route calls a database function that refuses a submission which is no
// longer pending, so a double-click cannot produce a second award. The button
// says so while it works, and the response is reported as it comes back.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STATUS_LABELS,
  groupByStatus,
  reviewSubmission,
} from "@/lib/challenges/challenges";
import { XP_ACTIVITIES } from "@/lib/xp/activities";

type Challenge = {
  challengeId: string;
  title: string;
  slug: string;
  activityCode: string;
  xpReward: number;
  difficulty: "beginner" | "intermediate" | "advanced";
  description: string;
  requirements: string;
  estimatedHours: number;
  submissionType: "github_url" | "text";
  archivedAt: string | null;
};

type Submission = {
  submissionId: string;
  challengeId: string;
  memberId: string;
  githubUrl: string | null;
  submissionText: string | null;
  status: "pending" | "approved" | "rejected";
  managerFeedback: string | null;
  reviewedAt: string | null;
  xpLedgerId: number | null;
  createdAt: string;
};

type RosterMember = { memberId: string; displayName: string; email: string };

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | {
      status: "ready";
      challenges: Challenge[];
      submissions: Submission[];
      members: RosterMember[];
    };

const FIELD_CLASS =
  "w-full border border-border bg-background px-4 py-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-accent";

const LABEL_CLASS =
  "mb-2 block font-mono text-xs font-bold tracking-[0.2em] text-foreground";

const BUTTON_CLASS =
  "border border-border px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

function when(value: string): string {
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

export function ChallengeManager() {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [draft, setDraft] = useState({
    title: "",
    activityCode: XP_ACTIVITIES[0]?.code ?? "",
    difficulty: "beginner" as Challenge["difficulty"],
    description: "",
    requirements: "",
    estimatedHours: 4,
    submissionType: "github_url" as Challenge["submissionType"],
  });

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
        response = await fetch("/api/manager/challenges", {
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
        challenges?: unknown;
        submissions?: unknown;
        members?: unknown;
      } | null;

      if (
        !payload ||
        !Array.isArray(payload.challenges) ||
        !Array.isArray(payload.submissions) ||
        !Array.isArray(payload.members)
      ) {
        setState({ status: "error" });
        return;
      }

      setState({
        status: "ready",
        challenges: payload.challenges as Challenge[],
        submissions: payload.submissions as Submission[],
        members: payload.members as RosterMember[],
      });
    }

    load();

    return () => controller.abort();
  }, [handleUnauthorized, attempt]);

  async function decide(submission: Submission, decision: "approve" | "reject") {
    setBusy(submission.submissionId);
    setNotice(null);

    const outcome = await reviewSubmission(submission.submissionId, decision, feedback);

    setBusy(null);

    if (outcome.ok) {
      setOpen(null);
      setFeedback("");
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

  async function archive(challenge: Challenge) {
    setBusy(challenge.challengeId);
    setNotice(null);

    let response: Response | null = null;

    try {
      response = await fetch(`/api/manager/challenges/${challenge.challengeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
    } catch {
      response = null;
    }

    setBusy(null);

    if (response?.status === 401) {
      handleUnauthorized();
      return;
    }

    if (!response?.ok) {
      setNotice("That challenge could not be archived.");
      return;
    }

    setNotice(`${challenge.title} archived.`);
    reload();
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();

    setBusy("create");
    setNotice(null);

    let response: Response | null = null;

    try {
      response = await fetch("/api/manager/challenges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, slug: draft.title }),
      });
    } catch {
      response = null;
    }

    setBusy(null);

    if (response?.status === 401) {
      handleUnauthorized();
      return;
    }

    if (response?.status === 409) {
      setNotice("A challenge with that name already exists.");
      return;
    }

    if (!response?.ok) {
      setNotice("That challenge was not accepted. Check every field.");
      return;
    }

    const payload = (await response.json().catch(() => null)) as {
      xpReward?: number;
    } | null;

    setNotice(
      `Created. It pays ${payload?.xpReward ?? "the Handbook"} XP, from its activity.`
    );
    setDraft((current) => ({ ...current, title: "", description: "", requirements: "" }));
    reload();
  }

  if (state.status === "forbidden") {
    return (
      <p className="mt-8 rounded-panel border border-border bg-surface p-6 text-sm text-muted">
        The challenge console is for XP managers.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mt-8 rounded-panel border border-border bg-surface p-6">
        <p className="text-sm text-muted">
          The challenges could not be loaded. Try again in a moment.
        </p>

        <button type="button" onClick={reload} className={`mt-4 ${BUTTON_CLASS}`}>
          TRY AGAIN →
        </button>
      </div>
    );
  }

  const ready = state.status === "ready" ? state : null;
  const groups = ready ? groupByStatus(ready.submissions) : null;

  const nameOf = (memberId: string) =>
    ready?.members.find((member) => member.memberId === memberId)?.displayName ??
    "Unknown member";

  const titleOf = (challengeId: string) =>
    ready?.challenges.find((challenge) => challenge.challengeId === challengeId)
      ?.title ?? "Unknown challenge";

  const xpOf = (challengeId: string) =>
    ready?.challenges.find((challenge) => challenge.challengeId === challengeId)
      ?.xpReward ?? 0;

  const selectedActivity =
    XP_ACTIVITIES.find((activity) => activity.code === draft.activityCode) ??
    XP_ACTIVITIES[0];

  return (
    <>
      {notice && (
        <p
          role="status"
          className="mt-6 border border-border bg-accent/5 p-4 font-mono text-[11px] leading-5 tracking-[0.06em] text-foreground"
        >
          {notice}
        </p>
      )}

      {/* Review queue ----------------------------------------------------- */}
      <section aria-labelledby="challenge-queue" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">01</span>

          <h2
            id="challenge-queue"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Review queue
            {groups !== null && (
              <span className="ml-3 font-mono text-base font-normal tracking-normal text-muted">
                ({groups.pending.length})
              </span>
            )}
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Approving writes the challenge&apos;s Handbook XP to the ledger, once.
          Approving the same submission twice cannot award it twice.
        </p>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <div className="flex items-center gap-4 bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
            <span className="min-w-0 flex-1">Member</span>
            <span className="hidden min-w-0 flex-1 sm:block">Challenge</span>
            <span className="w-32 shrink-0 text-right">Status</span>
          </div>

          <ul aria-busy={ready === null}>
            {ready === null && (
              <li className="border-t border-border px-5 py-4 sm:px-7">
                <span className="block h-4 w-40 animate-pulse rounded bg-muted" />
              </li>
            )}

            {groups !== null && ready !== null && ready.submissions.length === 0 && (
              <li className="border-t border-border px-5 py-6 text-sm text-muted sm:px-7">
                Nothing has been submitted yet.
              </li>
            )}

            {groups !== null &&
              [...groups.pending, ...groups.approved, ...groups.rejected].map(
                (submission) => {
                  const isOpen = open === submission.submissionId;
                  const isBusy = busy === submission.submissionId;

                  return (
                    <li key={submission.submissionId} className="border-t border-border">
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(isOpen ? null : submission.submissionId);
                          setFeedback("");
                        }}
                        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-accent/5 sm:px-7"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {nameOf(submission.memberId)}
                        </span>

                        <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted sm:block">
                          {titleOf(submission.challengeId)}
                        </span>

                        <span className="w-32 shrink-0 text-right font-mono text-xs uppercase tracking-[0.08em] text-muted">
                          {submission.status === "pending"
                            ? "Pending"
                            : STATUS_LABELS[submission.status]}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-border bg-surface px-5 py-5 sm:px-7">
                          <dl className="grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="font-mono text-[10px] tracking-[0.1em] text-muted">
                                CHALLENGE
                              </dt>
                              <dd className="mt-1 text-foreground">
                                {titleOf(submission.challengeId)}
                              </dd>
                            </div>

                            <div>
                              <dt className="font-mono text-[10px] tracking-[0.1em] text-muted">
                                SUBMITTED
                              </dt>
                              <dd className="mt-1 font-mono text-xs text-foreground">
                                {when(submission.createdAt)} UTC
                              </dd>
                            </div>

                            {submission.githubUrl ? (
                              <div className="sm:col-span-2">
                                <dt className="font-mono text-[10px] tracking-[0.1em] text-muted">
                                  GITHUB URL
                                </dt>
                                <dd className="mt-1 break-all font-mono text-xs text-foreground">
                                  <a
                                    href={submission.githubUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="underline"
                                  >
                                    {submission.githubUrl}
                                  </a>
                                </dd>
                              </div>
                            ) : null}

                            {submission.submissionText ? (
                              <div className="sm:col-span-2">
                                <dt className="font-mono text-[10px] tracking-[0.1em] text-muted">
                                  NOTES
                                </dt>
                                <dd className="mt-1 whitespace-pre-line text-sm leading-6 text-foreground">
                                  {submission.submissionText}
                                </dd>
                              </div>
                            ) : null}

                            {submission.managerFeedback ? (
                              <div className="sm:col-span-2">
                                <dt className="font-mono text-[10px] tracking-[0.1em] text-muted">
                                  FEEDBACK
                                </dt>
                                <dd className="mt-1 text-sm leading-6 text-foreground">
                                  {submission.managerFeedback}
                                </dd>
                              </div>
                            ) : null}
                          </dl>

                          {submission.status === "pending" ? (
                            <>
                              <label className="mt-5 block">
                                <span className={LABEL_CLASS}>
                                  FEEDBACK (OPTIONAL ON APPROVE, USEFUL ON REJECT)
                                </span>

                                <textarea
                                  rows={3}
                                  value={feedback}
                                  onChange={(event) => setFeedback(event.target.value)}
                                  placeholder="Add tests and a README, then resubmit."
                                  className={FIELD_CLASS}
                                />
                              </label>

                              <div className="mt-4 flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => decide(submission, "approve")}
                                  disabled={isBusy}
                                  className={BUTTON_CLASS}
                                >
                                  {isBusy
                                    ? "WORKING..."
                                    : `APPROVE (+${xpOf(submission.challengeId)} XP)`}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => decide(submission, "reject")}
                                  disabled={isBusy}
                                  className={BUTTON_CLASS}
                                >
                                  REJECT
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="mt-5 font-mono text-[11px] tracking-[0.06em] text-muted">
                              {submission.xpLedgerId !== null
                                ? `LEDGER ENTRY #${submission.xpLedgerId}`
                                : "NO XP AWARDED"}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                }
              )}
          </ul>
        </div>
      </section>

      {/* Catalogue -------------------------------------------------------- */}
      <section aria-labelledby="challenge-catalogue" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">02</span>

          <h2
            id="challenge-catalogue"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Catalogue
          </h2>
        </div>

        <div className="mt-8 overflow-hidden rounded-panel border border-border">
          <ul aria-busy={ready === null}>
            {ready !== null &&
              ready.challenges.map((challenge) => (
                <li
                  key={challenge.challengeId}
                  className="flex flex-col gap-3 border-t border-border px-5 py-4 first:border-t-0 sm:px-7 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {challenge.title}
                      {challenge.archivedAt !== null ? " (archived)" : ""}
                    </span>

                    <span className="truncate font-mono text-xs text-muted">
                      {challenge.activityCode} · {challenge.difficulty}
                    </span>
                  </div>

                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent-text">
                    {challenge.xpReward} XP
                  </span>

                  {challenge.archivedAt === null ? (
                    <button
                      type="button"
                      onClick={() => archive(challenge)}
                      disabled={busy === challenge.challengeId}
                      className={BUTTON_CLASS}
                    >
                      ARCHIVE
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] tracking-[0.1em] text-muted">
                      ARCHIVED
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      </section>

      {/* Create ----------------------------------------------------------- */}
      <section aria-labelledby="challenge-create" className="mt-section">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-accent-text">03</span>

          <h2
            id="challenge-create"
            className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl"
          >
            Add a challenge
          </h2>
        </div>

        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          The XP is not typed here. Choose the Handbook activity and the amount
          follows from it — a challenge cannot pay a number the Handbook does not
          list.
        </p>

        <form onSubmit={create} className="mt-8 max-w-xl space-y-5">
          <div>
            <label htmlFor="challenge-title" className={LABEL_CLASS}>
              TITLE
            </label>

            <input
              id="challenge-title"
              type="text"
              required
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Ship Your First CLI"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="challenge-activity" className={LABEL_CLASS}>
              HANDBOOK ACTIVITY
            </label>

            <select
              id="challenge-activity"
              value={draft.activityCode}
              onChange={(event) =>
                setDraft((current) => ({ ...current, activityCode: event.target.value }))
              }
              className={FIELD_CLASS}
            >
              {XP_ACTIVITIES.map((activity) => (
                <option key={activity.code} value={activity.code}>
                  {activity.label} ({activity.xp} XP)
                </option>
              ))}
            </select>

            <p className="mt-2 font-mono text-xs text-accent-text">
              PAYS {selectedActivity?.xp ?? 0} XP
            </p>
          </div>

          <div>
            <label htmlFor="challenge-difficulty" className={LABEL_CLASS}>
              DIFFICULTY
            </label>

            <select
              id="challenge-difficulty"
              value={draft.difficulty}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  difficulty: event.target.value as Challenge["difficulty"],
                }))
              }
              className={FIELD_CLASS}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div>
            <label htmlFor="challenge-description" className={LABEL_CLASS}>
              DESCRIPTION
            </label>

            <textarea
              id="challenge-description"
              required
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="challenge-requirements" className={LABEL_CLASS}>
              WHAT COUNTS AS DONE
            </label>

            <textarea
              id="challenge-requirements"
              required
              rows={3}
              value={draft.requirements}
              onChange={(event) =>
                setDraft((current) => ({ ...current, requirements: event.target.value }))
              }
              className={FIELD_CLASS}
            />
          </div>

          <div className="flex flex-wrap gap-5">
            <div className="w-32">
              <label htmlFor="challenge-hours" className={LABEL_CLASS}>
                HOURS
              </label>

              <input
                id="challenge-hours"
                type="number"
                min={1}
                required
                value={draft.estimatedHours}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    estimatedHours: Number(event.target.value) || 1,
                  }))
                }
                className={FIELD_CLASS}
              />
            </div>

            <div className="min-w-48 flex-1">
              <label htmlFor="challenge-type" className={LABEL_CLASS}>
                SUBMISSION TYPE
              </label>

              <select
                id="challenge-type"
                value={draft.submissionType}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    submissionType: event.target.value as Challenge["submissionType"],
                  }))
                }
                className={FIELD_CLASS}
              >
                <option value="github_url">GitHub URL</option>
                <option value="text">Written answer</option>
              </select>
            </div>
          </div>

          <button type="submit" disabled={busy === "create"} className={BUTTON_CLASS}>
            {busy === "create" ? "CREATING..." : "CREATE CHALLENGE →"}
          </button>
        </form>
      </section>
    </>
  );
}
