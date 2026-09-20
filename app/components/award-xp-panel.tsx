"use client";

// Phase 5B: the Award XP / Correction panel.
//
// The first UI in this application that WRITES. It is presentation + wiring
// only: the requests it sends, and what each response means, live in
// lib/xp/award.ts (plain functions, covered by tests/award-xp-core.test.mjs),
// because this project has no DOM test environment.
//
// Two modes, one form:
//
//   Award      - pick a Handbook activity; the SERVER resolves the amount.
//   Correction - type an amount to deduct and why; the panel signs it negative.
//
// Both modes share the same member selector and the same submit path, and
// neither ever sends the other's fields: the endpoint's request schema is a
// strict union, so mixing them would be a 400 rather than being ignored.
//
// It is rendered by MemberDirectory only in its "ready" state, which is reached
// only when GET /api/members answered 200 - i.e. only for a manager. A 403
// never renders it. That is presentation, not security: POST /api/xp/award
// re-checks the session and the manager allowlist server-side on every request,
// so hiding the form is a courtesy, not the control.

import { useMemo, useState } from "react";
import {
  ACTIVITY_OPTIONS,
  awardXp,
  correctXp,
  correctionPreview,
  filterMembers,
  resolveActivity,
  validateCorrection,
} from "@/lib/xp/award";

// The subset of the directory row this panel needs.
type AwardableMember = {
  memberId: string;
  displayName: string;
  email: string;
};

type Mode = "award" | "correction";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "success";
      mode: Mode;
      memberName: string;
      xpAmount: number;
      reason: string;
    }
  | { status: "error"; kind: "rejected" | "unavailable"; message: string };

// Matches the directory's own input styling so the two search fields look alike.
const FIELD_CLASS =
  "w-full rounded-card border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus-visible:border-accent";

const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.16em] text-muted";

export function AwardXpPanel({
  members,
  onAwarded,
  onUnauthorized,
}: {
  /** The full roster, from the directory's own fetch. */
  members: readonly AwardableMember[];
  /** Called after a successful entry so the directory can re-read itself. */
  onAwarded: () => void;
  /** Called on a 401/403 so the page can withdraw the panel and re-gate. */
  onUnauthorized: () => void;
}) {
  const [mode, setMode] = useState<Mode>("award");

  // Shared across both modes: the member being acted on.
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  // Award-mode fields.
  const [activityCode, setActivityCode] = useState("");

  // Correction-mode fields.
  const [correctionAmountText, setCorrectionAmountText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const matches = useMemo(
    () => filterMembers(members, memberQuery),
    [members, memberQuery]
  );

  const selectedMember = useMemo(
    () => members.find((member) => member.memberId === selectedMemberId) ?? null,
    [members, selectedMemberId]
  );

  const activityPreview = useMemo(
    () => resolveActivity(activityCode),
    [activityCode]
  );

  const correctionAmountPreview = useMemo(
    () => correctionPreview(correctionAmountText),
    [correctionAmountText]
  );

  // Validate the correction live, so the manager is told what is wrong before
  // pressing the button rather than after a round trip.
  const correctionValidation = useMemo(
    () => validateCorrection({ amount: correctionAmountText, reason: correctionReason }),
    [correctionAmountText, correctionReason]
  );

  // Whether the amount field itself is usable - used to decide whether to show
  // the validation message while the reason is still empty (which is normal
  // mid-typing, not an error to shout about).
  const amountOk = useMemo(
    () => validateCorrection({ amount: correctionAmountText, reason: "x" }).ok,
    [correctionAmountText]
  );

  const canSubmit =
    state.status !== "submitting" &&
    selectedMember !== null &&
    (mode === "award"
      ? activityPreview !== null
      : correctionValidation.ok);

  function handleMemberSelect(member: AwardableMember) {
    setSelectedMemberId(member.memberId);
    // Show the chosen member's name rather than leaving the raw search text,
    // so the selection is unambiguous before an entry is sent.
    setMemberQuery(member.displayName);
    setState({ status: "idle" });
  }

  function clearMember() {
    setSelectedMemberId(null);
    setMemberQuery("");
    setState({ status: "idle" });
  }

  function resetFields() {
    setSelectedMemberId(null);
    setMemberQuery("");
    setActivityCode("");
    setCorrectionAmountText("");
    setCorrectionReason("");
  }

  function switchMode(next: Mode) {
    if (next === mode) return;

    setMode(next);
    // Switching modes must not carry a half-filled form across, or a leftover
    // reason could be submitted with an award.
    setActivityCode("");
    setCorrectionAmountText("");
    setCorrectionReason("");
    setState({ status: "idle" });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedMember) return;

    if (mode === "award") {
      if (!activityPreview) return;

      setState({ status: "submitting" });

      const outcome = await awardXp(selectedMember.memberId, activityPreview.code);

      if (outcome.ok) {
        setState({
          status: "success",
          mode: "award",
          memberName: selectedMember.displayName,
          xpAmount: outcome.xpAmount,
          reason: outcome.reason,
        });

        resetFields();
        onAwarded();
        return;
      }

      if (outcome.kind === "unauthorized") {
        onUnauthorized();
        return;
      }

      setState({ status: "error", kind: outcome.kind, message: outcome.message });
      return;
    }

    // Correction mode. Re-validate at submit time: the amount may have been
    // fine when typed but the reason is only checked here.
    const validated = validateCorrection({
      amount: correctionAmountText,
      reason: correctionReason,
    });

    if (!validated.ok) {
      setState({ status: "error", kind: "rejected", message: validated.message });
      return;
    }

    setState({ status: "submitting" });

    // `validated.correctionXp` is already signed negative for a deduction.
    const outcome = await correctXp(
      selectedMember.memberId,
      validated.correctionXp,
      validated.reason
    );

    if (outcome.ok) {
      setState({
        status: "success",
        mode: "correction",
        memberName: selectedMember.displayName,
        xpAmount: outcome.xpAmount,
        reason: outcome.reason,
      });

      resetFields();
      onAwarded();
      return;
    }

    if (outcome.kind === "unauthorized") {
      onUnauthorized();
      return;
    }

    setState({ status: "error", kind: outcome.kind, message: outcome.message });
  }

  const TABS: { id: Mode; label: string }[] = [
    { id: "award", label: "Award XP" },
    { id: "correction", label: "Correction" },
  ];

  return (
    <section aria-labelledby="award-xp" className="mt-section">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-xs text-accent-text">01</span>

        <h2
          id="award-xp"
          className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl"
        >
          Record XP
        </h2>
      </div>

      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
        {mode === "award"
          ? "Record a Handbook activity for a member. The amount comes from the activity you pick — it is resolved on the server, not sent from here."
          : "Deduct XP to fix a mistake. The original entry is never edited; the correction is appended to the ledger with your reason."}
      </p>

      {/* Mode switch. A segmented control rather than tabs: the two modes are
          alternatives for the same action, not separate sections of a page. */}
      <div
        role="tablist"
        aria-label="Record type"
        className="mt-6 inline-flex rounded-card border border-border"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            onClick={() => switchMode(tab.id)}
            className={`font-mono text-xs tracking-[0.12em] transition-colors first:rounded-l-card last:rounded-r-card ${
              mode === tab.id
                ? "bg-accent text-white"
                : "text-muted hover:text-accent-text"
            } px-5 py-3`}
          >
            {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-6 overflow-hidden rounded-panel border border-border"
      >
        <div className="flex items-center justify-between bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:px-7">
          <span>Member</span>
          <span>{mode === "award" ? "Activity" : "Correction"}</span>
        </div>

        <div className="flex flex-col gap-6 border-t border-border px-5 py-6 sm:px-7 lg:flex-row lg:items-start lg:gap-8">
          {/* Member selector — shared by both modes ------------------------- */}
          <div className="min-w-0 flex-1">
            <label className="flex flex-col gap-2">
              <span className={LABEL_CLASS}>Search member</span>

              <input
                type="search"
                value={memberQuery}
                onChange={(event) => {
                  setMemberQuery(event.target.value);
                  // Editing the text invalidates a previous selection.
                  setSelectedMemberId(null);
                }}
                placeholder="Name or email"
                autoComplete="off"
                spellCheck={false}
                className={FIELD_CLASS}
              />
            </label>

            {/* The candidate list. Hidden once a member is chosen, so the
                selection cannot be changed by accident after reading it. */}
            {selectedMember === null && (
              <ul className="mt-3 max-h-56 overflow-y-auto rounded-panel border border-border">
                {matches.length === 0 && (
                  <li className="px-4 py-3 text-sm text-muted">
                    {members.length === 0
                      ? "No members are on the roster yet."
                      : "No members match that search."}
                  </li>
                )}

                {matches.map((member) => (
                  <li
                    key={member.memberId}
                    className="border-t border-border first:border-t-0"
                  >
                    <button
                      type="button"
                      onClick={() => handleMemberSelect(member)}
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">
                          {member.displayName}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted">
                          {member.email}
                        </span>
                      </span>

                      <span className="shrink-0 font-mono text-xs text-accent-text">
                        SELECT
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedMember !== null && (
              <div className="mt-3 flex items-center justify-between gap-4 rounded-panel border border-accent/40 bg-accent/10 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {selectedMember.displayName}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted">
                    {selectedMember.email}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={clearMember}
                  className="shrink-0 font-mono text-xs tracking-[0.12em] text-muted transition-colors hover:text-accent-text"
                >
                  CLEAR
                </button>
              </div>
            )}
          </div>

          {/* Mode-specific fields ------------------------------------------ */}
          {mode === "award" ? (
            <div className="min-w-0 flex-1">
              <label className="flex flex-col gap-2">
                <span className={LABEL_CLASS}>Handbook activity</span>

                <select
                  value={activityCode}
                  onChange={(event) => {
                    setActivityCode(event.target.value);
                    setState({ status: "idle" });
                  }}
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

              {/* Preview. The figure is shown, never submitted. */}
              <div className="mt-3 flex items-center justify-between gap-4 rounded-panel border border-border bg-surface px-4 py-3">
                <span className={LABEL_CLASS}>XP to award</span>

                {activityPreview ? (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm font-semibold text-accent-text">
                    +{activityPreview.xp} XP
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
                {state.status === "submitting" ? "RECORDING…" : "AWARD XP →"}
              </button>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <label className="flex flex-col gap-2">
                <span className={LABEL_CLASS}>Amount to deduct</span>

                <input
                  type="number"
                  inputMode="numeric"
                  value={correctionAmountText}
                  onChange={(event) => {
                    setCorrectionAmountText(event.target.value);
                    setState({ status: "idle" });
                  }}
                  placeholder="50"
                  autoComplete="off"
                  className={FIELD_CLASS}
                />
              </label>

              {/* Preview. Signed here so the manager sees the deduction, not
                  just the magnitude they typed. */}
              <div className="mt-3 flex items-center justify-between gap-4 rounded-panel border border-border bg-surface px-4 py-3">
                <span className={LABEL_CLASS}>XP to record</span>

                {correctionAmountPreview ? (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm font-semibold text-accent-text">
                    {correctionAmountPreview}
                  </span>
                ) : (
                  <span className="font-mono text-xs text-muted">—</span>
                )}
              </div>

              <label className="mt-4 flex flex-col gap-2">
                <span className={LABEL_CLASS}>Reason (required)</span>

                <textarea
                  value={correctionReason}
                  onChange={(event) => {
                    setCorrectionReason(event.target.value);
                    setState({ status: "idle" });
                  }}
                  rows={2}
                  placeholder="Why this entry is being corrected"
                  className={`${FIELD_CLASS} resize-none`}
                />
              </label>

              {/* Show the validation problem once an amount has been entered -
                  an empty reason is not worth flagging before the manager has
                  had a chance to type it. */}
              {amountOk && !correctionValidation.ok && (
                <p className="mt-2 text-xs text-accent-text">
                  {correctionValidation.message}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-6 w-full border border-border px-5 py-3 font-mono text-xs tracking-[0.12em] transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
              >
                {state.status === "submitting"
                  ? "RECORDING…"
                  : "RECORD CORRECTION →"}
              </button>
            </div>
          )}
        </div>

        {/* Confirmation / error ------------------------------------------- */}
        {state.status === "submitting" && (
          <span role="status" className="sr-only">
            Recording entry
          </span>
        )}

        {state.status === "success" && (
          <div
            role="status"
            className="border-t border-border bg-accent/10 px-5 py-5 sm:px-7"
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
              {state.mode === "award" ? "Awarded" : "Corrected"}
            </p>

            <p className="mt-2 text-sm text-foreground">
              {state.mode === "award" ? (
                <>
                  <span className="font-semibold">+{state.xpAmount} XP</span>{" "}
                  awarded to {state.memberName} for {state.reason}.
                </>
              ) : (
                <>
                  <span className="font-semibold">
                    {state.xpAmount} XP
                  </span>{" "}
                  recorded for {state.memberName} — {state.reason}.
                </>
              )}{" "}
              The directory below has been refreshed.
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div
            role="alert"
            className="border-t border-border bg-surface px-5 py-5 sm:px-7"
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-text">
              {state.kind === "rejected" ? "Not recorded" : "Unavailable"}
            </p>

            <p className="mt-2 text-sm text-foreground">{state.message}</p>

            {state.kind === "unavailable" && (
              <p className="mt-2 text-xs text-muted">
                Nothing was saved — nothing has changed. Try again.
              </p>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
