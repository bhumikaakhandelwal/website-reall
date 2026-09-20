"use client";

// Phase 8D: the manager's Add Member form.
//
// Presentation and wiring only. The validation lives in
// lib/members/onboarding.ts, because this project has no DOM test environment
// (Node's type stripping does not transform JSX, so a .tsx component cannot be
// imported into a test at all).
//
// No password field, and that is the design: the new member chooses their own
// password from the login page. Nothing here generates one, and nothing here
// sends an invitation - the manager adds the member, and the member activates
// themselves when they first try to sign in.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addMember,
  validateNewMember,
  type NewMemberDraft,
} from "@/lib/members/onboarding";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const FIELD_CLASS =
  "h-14 w-full border border-border bg-background px-4 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-accent";

const LABEL_CLASS =
  "mb-2 block font-mono text-xs font-bold tracking-[0.2em] text-foreground";

const BUTTON_CLASS =
  "border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

const EMPTY: NewMemberDraft = { displayName: "", email: "" };

export function AddMemberForm() {
  const router = useRouter();

  const [draft, setDraft] = useState<NewMemberDraft>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const check = validateNewMember(draft);

  function update(field: keyof NewMemberDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus({ kind: "idle" });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setStatus({ kind: "saving" });

    const outcome = await addMember(draft);

    if (outcome.ok) {
      setDraft(EMPTY);
      setStatus({ kind: "done", message: outcome.message });
      return;
    }

    if (outcome.kind === "unauthorized") {
      localStorage.removeItem("dbce-logged-in");
      router.replace("/login");
      return;
    }

    setStatus({ kind: "error", message: outcome.message });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 max-w-xl space-y-6">
      <div>
        <label htmlFor="member-name" className={LABEL_CLASS}>
          FULL NAME
        </label>

        <input
          id="member-name"
          type="text"
          required
          autoComplete="off"
          value={draft.displayName}
          onChange={(event) => update("displayName", event.target.value)}
          placeholder="Aisha Fernandes"
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="member-email" className={LABEL_CLASS}>
          DBCE EMAIL
        </label>

        <input
          id="member-email"
          type="email"
          required
          autoComplete="off"
          spellCheck={false}
          value={draft.email}
          onChange={(event) => update("email", event.target.value)}
          placeholder="2414001@dbcegoa.ac.in"
          className={FIELD_CLASS}
        />
      </div>

      {!check.ok && (draft.displayName.length > 0 || draft.email.length > 0) && (
        <p className="font-mono text-[11px] tracking-[0.06em] text-accent">
          {check.message}
        </p>
      )}

      <button
        type="submit"
        disabled={status.kind === "saving" || !check.ok}
        className={BUTTON_CLASS}
      >
        {status.kind === "saving" ? "ADDING..." : "ADD MEMBER →"}
      </button>

      {status.kind === "done" && (
        <p
          role="status"
          className="border border-border bg-accent/5 p-4 font-mono text-[11px] leading-5 tracking-[0.06em] text-foreground"
        >
          {status.message}
        </p>
      )}

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
