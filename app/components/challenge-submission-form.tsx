"use client";

// Phase 9: the challenge submission form.
//
// WHICH FIELD IS ASKED FOR COMES FROM THE CHALLENGE, not from a fixed template.
// `submission_type` decides whether the member is asked for a URL or a written
// answer, and the Handbook ACTIVITY decides what that field is called - because
// "Ship Your First CLI" and "Open-source Patch" both take a GitHub URL and mean
// different things by it. See submissionFieldFor in lib/challenges/challenges.ts.
//
// Presentation and wiring only. The validation and the client call live in that
// module, because this project has no DOM test environment (Node's type
// stripping does not transform JSX, so a .tsx component cannot be imported into
// a test at all).
//
// AFTER SUBMITTING, THIS SAYS NOTHING ABOUT XP. A submission is a claim; XP
// enters the ledger only when a manager approves it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  STATUS_LABELS,
  submissionFieldFor,
  submitChallenge,
  type SubmissionDraft,
} from "@/lib/challenges/challenges";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const FIELD_CLASS =
  "w-full border border-border bg-background px-4 py-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-accent";

const LABEL_CLASS =
  "mb-2 block font-mono text-xs font-bold tracking-[0.2em] text-foreground";

const BUTTON_CLASS =
  "border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

const EMPTY: SubmissionDraft = { githubUrl: "", submissionText: "" };

export function ChallengeSubmissionForm({
  slug,
  submissionType,
  activityCode,
}: {
  slug: string;
  submissionType: "github_url" | "text";
  activityCode: string;
}) {
  const router = useRouter();

  const field = submissionFieldFor(activityCode, submissionType);

  const [draft, setDraft] = useState<SubmissionDraft>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function update(fieldName: keyof SubmissionDraft, value: string) {
    setDraft((current) => ({ ...current, [fieldName]: value }));
    setStatus({ kind: "idle" });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setStatus({ kind: "saving" });

    const outcome = await submitChallenge(slug, draft, submissionType);

    if (outcome.ok) {
      setDraft(EMPTY);
      setStatus({ kind: "done", message: outcome.message });
      router.refresh();
      return;
    }

    if (outcome.kind === "unauthorized") {
      localStorage.removeItem("dbce-logged-in");
      router.replace("/login");
      return;
    }

    setStatus({ kind: "error", message: outcome.message });
  }

  if (status.kind === "done") {
    return (
      <div className="mt-8 max-w-xl border border-border bg-accent/5 p-6">
        <p className="font-mono text-xs font-bold tracking-[0.2em] text-foreground">
          {STATUS_LABELS.pending.toUpperCase()}
        </p>

        <p className="mt-3 text-sm leading-6 text-muted">{status.message}</p>

        <p className="mt-3 text-sm leading-6 text-muted">
          No XP appears until a manager approves it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 max-w-xl space-y-6">
      {/* The primary field. Required, and the only field the challenge cares
          about - everything else is context for the reviewer. */}
      <div>
        <label htmlFor="submission-primary" className={LABEL_CLASS}>
          {field.label.toUpperCase()} *
        </label>

        {field.kind === "github_url" ? (
          <input
            id="submission-primary"
            type="url"
            required
            autoComplete="off"
            spellCheck={false}
            value={draft.githubUrl}
            onChange={(event) => update("githubUrl", event.target.value)}
            placeholder={field.placeholder}
            className={FIELD_CLASS}
          />
        ) : (
          <textarea
            id="submission-primary"
            required
            rows={7}
            value={draft.submissionText}
            onChange={(event) => update("submissionText", event.target.value)}
            placeholder={field.placeholder}
            className={FIELD_CLASS}
          />
        )}

        {field.examples && (
          <ul className="mt-3 space-y-1">
            {field.examples.map((example) => (
              <li
                key={example}
                className="font-mono text-[11px] leading-5 tracking-[0.06em] text-muted"
              >
                • {example}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Notes are only offered where the schema has somewhere to put them.

        A GitHub challenge stores its URL in `github_url` and has `submission_text`
        free for context, so the reviewer gets both. A written challenge stores
        its answer in `submission_text` - the one text column there is - so a
        second free-text box would have to be concatenated into it, and quietly
        merging two inputs into one stored value is worse than asking for one
        thing clearly.
      */}
      {field.kind === "github_url" && (
        <div>
          <label htmlFor="submission-notes" className={LABEL_CLASS}>
            NOTES (OPTIONAL)
          </label>

          <textarea
            id="submission-notes"
            rows={4}
            value={draft.submissionText}
            onChange={(event) => update("submissionText", event.target.value)}
            placeholder="Anything the reviewer should know before they open it."
            className={FIELD_CLASS}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={status.kind === "saving"}
        className={BUTTON_CLASS}
      >
        {status.kind === "saving" ? "SUBMITTING..." : "SUBMIT CHALLENGE →"}
      </button>

      {status.kind === "error" && (
        <p
          role="alert"
          className="border border-border bg-muted/30 p-4 font-mono text-[11px] leading-5 tracking-[0.06em] text-foreground"
        >
          {status.message}
        </p>
      )}
    </form>
  );
}
