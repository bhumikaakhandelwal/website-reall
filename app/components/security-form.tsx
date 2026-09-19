"use client";

// Phase 8D: the change-password form.
//
// Presentation and wiring only. The rules live in lib/profile/security.ts,
// because this project has no DOM test environment (Node's type stripping does
// not transform JSX, so a .tsx component cannot be imported into a test at all).
//
// The password never touches this application's own storage: it is posted to
// /api/profile/password, which hands it to Supabase's password API. Nothing here
// hashes, compares or keeps it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MIN_PASSWORD_LENGTH,
  changePassword,
  validatePasswordChange,
  type PasswordDraft,
} from "@/lib/profile/security";

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

const EMPTY: PasswordDraft = { password: "", confirm: "" };

export function SecurityForm() {
  const router = useRouter();

  const [draft, setDraft] = useState<PasswordDraft>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const check = validatePasswordChange(draft);

  function update(field: keyof PasswordDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus({ kind: "idle" });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setStatus({ kind: "saving" });

    const outcome = await changePassword(draft);

    if (outcome.ok) {
      setDraft(EMPTY);
      setStatus({ kind: "done", message: outcome.message });
      return;
    }

    if (outcome.kind === "unauthorized") {
      // The session is gone. Drop the client gate and go back to the login
      // page, exactly as the other pages do.
      localStorage.removeItem("dbce-logged-in");
      router.replace("/login");
      return;
    }

    setStatus({ kind: "error", message: outcome.message });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 max-w-xl space-y-6">
      <div>
        <label htmlFor="new-password" className={LABEL_CLASS}>
          NEW PASSWORD
        </label>

        <input
          id="new-password"
          type="password"
          required
          autoComplete="new-password"
          value={draft.password}
          onChange={(event) => update("password", event.target.value)}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="confirm-password" className={LABEL_CLASS}>
          CONFIRM NEW PASSWORD
        </label>

        <input
          id="confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={draft.confirm}
          onChange={(event) => update("confirm", event.target.value)}
          placeholder="Type it again"
          className={FIELD_CLASS}
        />
      </div>

      {!check.ok && draft.password.length > 0 && (
        <p className="font-mono text-[11px] tracking-[0.06em] text-accent">
          {check.message}
        </p>
      )}

      <button
        type="submit"
        disabled={status.kind === "saving" || !check.ok}
        className={BUTTON_CLASS}
      >
        {status.kind === "saving" ? "SAVING..." : "CHANGE PASSWORD →"}
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
