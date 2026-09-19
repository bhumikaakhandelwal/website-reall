"use client";

// Phase 8D: the manager's actions on one row of the member directory.
//
// Send Password Reset Email, Deactivate, Reactivate - and never a delete. The
// brief is explicit that members are not removed, and the database agrees: XP,
// attendance and event authorship all point at `members.id`.
//
// The row reloads after a successful action rather than guessing at the new
// state. The directory already knows how to render a status badge, and letting
// it re-read is one round trip instead of a second, weaker copy of the truth
// kept in this component.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "deactivate" | "reactivate" | "send-reset";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const BUTTON_CLASS =
  "border border-border px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

export function MemberActions({
  memberId,
  membershipStatus,
}: {
  memberId: string;
  membershipStatus: "pending" | "active" | "inactive";
}) {
  const router = useRouter();

  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function run(action: Action) {
    setStatus({ kind: "busy" });

    let response: Response | null = null;

    try {
      response = await fetch(`/api/manager/members/${memberId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server." });
      return;
    }

    if (response.status === 401) {
      localStorage.removeItem("dbce-logged-in");
      router.replace("/login");
      return;
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      setStatus({
        kind: "error",
        message:
          payload?.error === "You cannot deactivate your own account"
            ? "You cannot deactivate your own account."
            : "That action did not go through.",
      });

      return;
    }

    setStatus({
      kind: "done",
      message:
        action === "send-reset"
          ? "Reset email sent."
          : action === "deactivate"
            ? "Deactivated."
            : "Reactivated.",
    });

    // Re-read the directory so the status badge is the server's answer.
    window.location.reload();
  }

  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => run("send-reset")}
        disabled={status.kind === "busy"}
        className={BUTTON_CLASS}
      >
        RESET
      </button>

      {membershipStatus === "inactive" ? (
        <button
          type="button"
          onClick={() => run("reactivate")}
          disabled={status.kind === "busy"}
          className={BUTTON_CLASS}
        >
          REACTIVATE
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run("deactivate")}
          disabled={status.kind === "busy"}
          className={BUTTON_CLASS}
        >
          DEACTIVATE
        </button>
      )}

      {status.kind === "done" && (
        <span role="status" className="font-mono text-[10px] text-muted">
          {status.message}
        </span>
      )}

      {status.kind === "error" && (
        <span role="alert" className="font-mono text-[10px] text-accent">
          {status.message}
        </span>
      )}
    </span>
  );
}
