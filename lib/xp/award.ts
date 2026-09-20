// Phase 5B: the award path's reusable logic.
//
// The Award XP panel is a client component, and this project has no DOM test
// environment (no jsdom, no testing-library) — its `npm test` runs plain
// `node --test` against modules, not components. So everything on the award
// path that is worth asserting on lives HERE, as plain functions, and the
// component is left as presentation + wiring.
//
// That is also the pattern the rest of lib/xp/ already follows: the rule lives
// in a module, the UI reads it.
//
// Three responsibilities, each one testable on its own:
//
//   1. filterMembers    - the member selector's search
//   2. resolveActivity  - the dropdown's selection -> handbook XP
//   3. awardXp          - the POST to /api/xp/award, and what each status means
//
// The XP AMOUNT is never computed here. It comes from lib/xp/activities.ts,
// which the server re-resolves authoritatively - this module only echoes it for
// the preview, so a wrong preview can never become a wrong award.

import { XP_ACTIVITIES, getXpActivity } from './activities';

export type AwardableMember = {
  memberId: string;
  displayName: string;
  email: string;
};

/**
 * Filters the roster for the selector by name OR email, case-insensitively.
 *
 * Deliberately the same matching rule the directory table uses, so a manager
 * who finds someone in either place finds them the same way.
 */
export function filterMembers<T extends AwardableMember>(
  members: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();

  if (!needle) return [...members];

  return members.filter(
    (member) =>
      member.displayName.toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle)
  );
}

/**
 * Resolves the selected activity code to its handbook entry.
 *
 * Returns null when nothing is chosen or the code is unknown, so the caller
 * renders "no preview" rather than a misleading 0 XP.
 */
export function resolveActivity(code: string): {
  code: string;
  label: string;
  xp: number;
} | null {
  const activity = getXpActivity(code);

  if (!activity) return null;

  return { code: activity.code, label: activity.label, xp: activity.xp };
}

/** The activity options, in Handbook order, for the dropdown. */
export const ACTIVITY_OPTIONS = XP_ACTIVITIES.map((activity) => ({
  code: activity.code,
  label: activity.label,
  xp: activity.xp,
}));

export type AwardOutcome =
  | { ok: true; kind: 'award'; memberId: string; xpAmount: number; activityCode: string; reason: string }
  | { ok: true; kind: 'correction'; memberId: string; xpAmount: number; reason: string }
  // The server rejected it. `message` is safe to show a manager.
  | { ok: false; kind: 'rejected'; message: string }
  // The signed session is gone, or the actor is no longer a manager.
  | { ok: false; kind: 'unauthorized'; message: string }
  // Could not reach or read the server - retrying may help.
  | { ok: false; kind: 'unavailable'; message: string };

/** The subset of AwardOutcome describing a recorded entry. */
export type RecordedEntry = Extract<AwardOutcome, { ok: true }>;

// ---------------------------------------------------------------------------
// Correction validation
//
// These mirror app/api/xp/award/route.ts's correctionSchema EXACTLY, so the
// panel can explain a mistake before the request is sent instead of surfacing
// the endpoint's generic "Invalid request body". The server stays the
// authority - this is a courtesy, and a test pins the two together so they
// cannot drift.
// ---------------------------------------------------------------------------

/** The endpoint bounds a correction to +/-1000 so a typo cannot wipe an account. */
export const CORRECTION_MIN = -1000;
export const CORRECTION_MAX = 1000;
/** The endpoint stores the reason, so it must fit. */
export const CORRECTION_REASON_MAX = 500;

export type CorrectionDraft = {
  /** Raw text from the amount field. */
  amount: string;
  /** Raw text from the reason field. */
  reason: string;
};

export type CorrectionValidation =
  | { ok: true; correctionXp: number; reason: string }
  | { ok: false; message: string };

/**
 * Validates a correction entry against the endpoint's rules, and applies the
 * deduction sign.
 *
 * Returns the values to send when valid. `correctionXp` is SIGNED: a manager
 * types the magnitude to deduct (`50`) and this returns `-50`, because the
 * panel's whole framing is "deduct this much". Signing it here, once, means no
 * caller can forget and accidentally record an award instead of a deduction.
 *
 * The reason is trimmed (the endpoint trims too, so a whitespace-only reason is
 * genuinely invalid rather than stored as blanks).
 *
 * Zero is rejected here as well as server-side: a correction of 0 is a no-op
 * ledger row, which the Handbook's "fix a mistake" intent never wants.
 */
export function validateCorrection(draft: CorrectionDraft): CorrectionValidation {
  const amountText = draft.amount.trim();
  const reason = draft.reason.trim();

  if (amountText === '') {
    return { ok: false, message: 'Enter an amount to deduct.' };
  }

  // `Number` accepts "1e3", "0x10", "Infinity" and whitespace; none of those is
  // an amount a manager meant to type, so the text must be plain digits.
  if (!/^-?\d+$/.test(amountText)) {
    return { ok: false, message: 'Enter a whole number, for example 50.' };
  }

  const magnitude = Number(amountText);

  if (!Number.isInteger(magnitude)) {
    return { ok: false, message: 'Enter a whole number, for example 50.' };
  }

  if (magnitude === 0) {
    return { ok: false, message: 'A correction cannot be zero.' };
  }

  if (magnitude < CORRECTION_MIN || magnitude > CORRECTION_MAX) {
    return {
      ok: false,
      message: `A correction must be between ${CORRECTION_MIN} and ${CORRECTION_MAX} XP.`,
    };
  }

  if (reason === '') {
    return { ok: false, message: 'A reason is required so the change is traceable.' };
  }

  if (reason.length > CORRECTION_REASON_MAX) {
    return {
      ok: false,
      message: `Keep the reason under ${CORRECTION_REASON_MAX} characters.`,
    };
  }

  // Deduction sign applied here, once. Math.abs first so typing "-50" is
  // idempotent rather than flipping the meaning.
  return {
    ok: true,
    correctionXp: -Math.abs(magnitude),
    reason,
  };
}

/**
 * The signed amount a correction will record, from the raw amount field.
 *
 * The panel asks for "the amount to deduct", so a manager types `50` and this
 * returns `-50`. Mirrors the sign rule in `validateCorrection`.
 */
export function correctionAmount(deduction: string): number {
  const magnitude = Math.abs(Number(deduction.trim()));

  if (!Number.isFinite(magnitude) || magnitude === 0) return 0;

  return -magnitude;
}

/**
 * A human label for a correction's magnitude, for the live preview.
 *
 * Returns null when there is no usable amount yet, so the panel shows "—"
 * rather than "-0 XP" or "NaN XP".
 *
 * The preview deliberately ignores the reason: a manager who has picked an
 * amount but not yet typed why should still see the figure they are about to
 * record.
 */
export function correctionPreview(amount: string): string | null {
  const validated = validateCorrection({ amount, reason: 'preview' });

  if (!validated.ok) return null;

  return `${validated.correctionXp} XP`;
}


// Server wording for the known rejections. Anything else falls back to a
// generic line - never to a raw status.
const REJECTION_MESSAGES: Record<string, string> = {
  'Invalid request body': 'That request was not valid. Check the member and the details, then try again.',
  'Unknown activity code': 'That activity is not in the Handbook list.',
  'Member not found': 'That member no longer exists.',
};

/**
 * The shared response contract for both modes.
 *
 * Award and correction differ only in the body they send; every status means
 * the same thing for both, so this is the one place that interpretation lives.
 * That is what keeps "401 withdraws the form" and "500 is retryable" true of
 * corrections as well as awards, without a second copy of the rules.
 *
 * `successKind` is just the tag put on a 2xx outcome, so the caller can tell
 * which mode produced it.
 */
async function submitXpEntry(
  body: Record<string, unknown>,
  successKind: 'award' | 'correction',
  fetchImpl: typeof fetch
): Promise<AwardOutcome> {
  let response: Response;

  try {
    response = await fetchImpl('/api/xp/award', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      kind: 'unauthorized',
      message:
        response.status === 403
          ? 'You are not authorised to change XP.'
          : 'Your session has ended. Sign in again.',
    };
  }

  // The success shape: 201 { ok, memberId, xpAmount, activityCode, reason }
  if (response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { memberId?: unknown; xpAmount?: unknown; activityCode?: unknown; reason?: unknown }
      | null;

    // A 2xx that does not carry the expected fields means the endpoint and this
    // client disagree. Report it as unavailable rather than claiming success
    // for an entry we cannot describe.
    if (
      !payload ||
      typeof payload.memberId !== 'string' ||
      typeof payload.xpAmount !== 'number' ||
      typeof payload.reason !== 'string'
    ) {
      return {
        ok: false,
        kind: 'unavailable',
        message: 'The server accepted the request but sent back an unexpected reply.',
      };
    }

    // A correction is recorded with activity_code = NULL, so the endpoint
    // answers with a JSON `null` in that field. The award path still requires a
    // real code - a null here would mean the server routed the request
    // differently than it was sent.
    if (successKind === 'award' && typeof payload.activityCode !== 'string') {
      return {
        ok: false,
        kind: 'unavailable',
        message: 'The server accepted the request but sent back an unexpected reply.',
      };
    }

    if (successKind === 'correction') {
      return {
        ok: true,
        kind: 'correction',
        memberId: payload.memberId,
        xpAmount: payload.xpAmount,
        reason: payload.reason,
      };
    }

    return {
      ok: true,
      kind: 'award',
      memberId: payload.memberId,
      xpAmount: payload.xpAmount,
      activityCode: payload.activityCode as string,
      reason: payload.reason,
    };
  }

  // 400 / 404 and anything else non-2xx that is not an auth problem.
  const errorBody = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;

  const serverError =
    typeof errorBody?.error === 'string' ? errorBody.error : null;

  if (response.status === 400 || response.status === 404) {
    return {
      ok: false,
      kind: 'rejected',
      message: (serverError && REJECTION_MESSAGES[serverError]) || 'That entry was rejected.',
    };
  }

  return {
    ok: false,
    kind: 'unavailable',
    message: 'The entry could not be recorded. Try again in a moment.',
  };
}

/**
 * Posts one award to the existing POST /api/xp/award endpoint.
 *
 * Sends exactly `{ memberId, activityCode }` - the shape the endpoint's award
 * path expects. It deliberately does NOT send an amount: the server resolves
 * the XP from lib/xp/activities.ts and rejects a body that tries to supply one
 * (the schema is strict), so sending it would turn a valid award into a 400.
 */
export async function awardXp(
  memberId: string,
  activityCode: string,
  fetchImpl: typeof fetch = fetch
): Promise<AwardOutcome> {
  return submitXpEntry({ memberId, activityCode }, 'award', fetchImpl);
}

/**
 * Posts one corrective entry to the same endpoint.
 *
 * Sends exactly `{ memberId, correctionXp, reason }` - the mirror image of the
 * award body, and again WITHOUT an `activityCode`: the two shapes are a strict
 * union server-side, so sending both keys would fail validation. A correction
 * is an off-Handbook adjustment, recorded with `activity_code = NULL` so the
 * original entry it corrects stays in the audit trail.
 *
 * `correctionXp` is signed: negative reverses an award, positive adds XP that
 * no Handbook activity covers. The panel presents it as a deduction, so callers
 * normally pass a negative number produced by `correctionAmount()`.
 */
export async function correctXp(
  memberId: string,
  correctionXp: number,
  reason: string,
  fetchImpl: typeof fetch = fetch
): Promise<AwardOutcome> {
  return submitXpEntry(
    { memberId, correctionXp, reason },
    'correction',
    fetchImpl
  );
}
