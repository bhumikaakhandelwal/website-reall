// Phase 9: challenges.
//
// THE CORE RULE, enforced here and in the database: SUBMITTING GRANTS NOTHING.
// XP enters the immutable ledger only when a manager approves, exactly once.
// Nothing in this module writes XP, and there is no code path from a submission
// to the ledger except approve_challenge_submission.
//
// The decisions live here rather than in the components, because this project
// has no DOM test environment (Node's type stripping does not transform JSX, so
// a .tsx component cannot be imported into a test at all).

import { XP_ACTIVITIES, getXpActivity } from '@/lib/xp/activities';

export type ChallengeStatus = 'pending' | 'approved' | 'rejected';

export type SubmissionDraft = {
  githubUrl: string;
  submissionText: string;
};

/** The longest a submission note may be. Long enough for a real write-up. */
export const MAX_SUBMISSION_TEXT = 4000;

/** The longest manager feedback may be. */
export const MAX_FEEDBACK = 1000;

// ---------------------------------------------------------------------------
// Handbook verification
// ---------------------------------------------------------------------------

/**
 * The XP the Handbook gives an activity, or null if it is not a Handbook
 * activity.
 *
 * The seeded challenges are pinned to this, so a challenge cannot pay an amount
 * the Handbook does not list. `lib/xp/activities.ts` is the single source of
 * truth; the migration restates the numbers because SQL cannot import
 * TypeScript, and a test asserts the two agree.
 */
export function handbookXpFor(activityCode: string): number | null {
  return getXpActivity(activityCode)?.xp ?? null;
}

/** Whether a challenge's XP matches the Handbook value for its activity. */
export function xpMatchesHandbook(
  activityCode: string,
  xpReward: number
): boolean {
  return handbookXpFor(activityCode) === xpReward;
}

/** Every XP value the Handbook lists. Used to prove nothing else is seeded. */
export function handbookXpValues(): number[] {
  return [...new Set(XP_ACTIVITIES.map((activity) => activity.xp))].sort(
    (a, b) => a - b
  );
}

/**
 * A URL-safe slug.
 *
 * The slug is the public address of a challenge, so it is derived from the
 * title and then fixed for the life of the challenge - the edit route
 * deliberately does not accept a new one, because changing it would break every
 * link to it.
 */
export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// Which evidence a challenge asks for
// ---------------------------------------------------------------------------

/**
 * What the challenge page asks the member for.
 *
 * THE COLUMN DECIDES THE FIELD, and the ACTIVITY decides the wording. That split
 * is deliberate:
 *
 *   * `submission_type` says which evidence the challenge accepts, and therefore
 *     which column stores it - `github_url` or `submission_text`. It is the
 *     database's answer and the form does not second-guess it.
 *   * the Handbook ACTIVITY says what to CALL that evidence. Two challenges can
 *     both accept a GitHub URL and mean different things by it: "Ship Your First
 *     CLI" wants a repository you published, "Open-source Patch" wants a pull
 *     request you landed. Asking for a "Repository URL" on the second would be
 *     asking for the wrong thing, and a member would submit their fork.
 *
 * Deriving the label from the activity rather than adding a column keeps this a
 * code change: the wording follows the Handbook, which is where it came from.
 */
export type SubmissionField = {
  /** Which column stores the value. Mirrors `submission_type`. */
  kind: 'github_url' | 'text';
  label: string;
  placeholder: string;
  /** The kinds of proof a text challenge accepts, or null for a GitHub one. */
  examples: string[] | null;
};

/** The evidence a written challenge accepts, from the Handbook's own wording. */
export const SUBMISSION_EXAMPLES = [
  'LeetCode profile link',
  'HackerRank profile',
  'Screenshot link',
  'Explanation of your solution',
];

/**
 * Resolves the field a challenge asks for.
 *
 * A `text` challenge NEVER asks for a GitHub URL, whatever its activity - the
 * whole reason the column exists is that some Handbook activities are proved by
 * something other than a repository.
 */
export function submissionFieldFor(
  activityCode: string,
  submissionType: 'github_url' | 'text'
): SubmissionField {
  if (submissionType === 'text') {
    return {
      kind: 'text',
      label: 'Solution / Proof',
      placeholder:
        'A LeetCode or HackerRank profile link, a screenshot link, or an explanation of your solution.',
      examples: SUBMISSION_EXAMPLES,
    };
  }

  // An open-source contribution is proved by a merged pull request, not by a
  // repository of your own.
  if (activityCode === 'open-source-contribution') {
    return {
      kind: 'github_url',
      label: 'GitHub Pull Request URL',
      placeholder: 'https://github.com/owner/repo/pull/123',
      examples: null,
    };
  }

  return {
    kind: 'github_url',
    label: 'GitHub Repository URL',
    placeholder: 'https://github.com/you/your-project',
    examples: null,
  };
}

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

export type SubmissionValidation =
  | { ok: true; githubUrl: string | null; submissionText: string | null }
  | { ok: false; field: 'githubUrl' | 'submissionText'; message: string };

/**
 * A GitHub URL must point at github.com over http(s).
 *
 * Deliberately strict about the host: the whole point of the field is that a
 * manager can open it, and a `javascript:` or data URL dressed up as a
 * submission is not something a reviewer should ever be handed.
 */
export function isGithubUrl(value: string): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  const host = url.hostname.toLowerCase();

  return host === 'github.com' || host.endsWith('.github.com');
}

/**
 * Validates a submission against the challenge's `submission_type`.
 *
 * A `github_url` challenge requires a GitHub URL. A `text` challenge requires a
 * written answer. The unused field is discarded rather than stored, so a
 * submission never carries half-finished input the member did not mean to send.
 */
export function validateSubmission(
  type: 'github_url' | 'text',
  draft: SubmissionDraft
): SubmissionValidation {
  const githubUrl = typeof draft.githubUrl === 'string' ? draft.githubUrl.trim() : '';
  const submissionText =
    typeof draft.submissionText === 'string' ? draft.submissionText.trim() : '';

  if (type === 'github_url') {
    if (githubUrl.length === 0) {
      return { ok: false, field: 'githubUrl', message: 'Give the repository URL.' };
    }

    if (!isGithubUrl(githubUrl)) {
      return {
        ok: false,
        field: 'githubUrl',
        message: 'That must be a github.com URL.',
      };
    }

    return { ok: true, githubUrl, submissionText: submissionText || null };
  }

  if (submissionText.length === 0) {
    return {
      ok: false,
      field: 'submissionText',
      message: 'Write what you did before submitting.',
    };
  }

  if (submissionText.length > MAX_SUBMISSION_TEXT) {
    return {
      ok: false,
      field: 'submissionText',
      message: `Keep it to ${MAX_SUBMISSION_TEXT} characters or fewer.`,
    };
  }

  return { ok: true, githubUrl: null, submissionText };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<ChallengeStatus, string> = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** True when the member may submit again: nothing open, nothing approved. */
export function canSubmit(submissions: readonly { status: ChallengeStatus }[]): boolean {
  return !submissions.some(
    (submission) => submission.status === 'pending' || submission.status === 'approved'
  );
}

/**
 * Why a member cannot submit, or null when they can.
 *
 * Distinguishes the two reasons because they call for different things: an
 * open submission needs waiting, an approved one needs nothing at all.
 */
export function submissionBlockedReason(
  submissions: readonly { status: ChallengeStatus }[]
): string | null {
  if (submissions.some((submission) => submission.status === 'pending')) {
    return 'You already have a submission waiting for review. A manager will look at it soon.';
  }

  if (submissions.some((submission) => submission.status === 'approved')) {
    return 'You have already earned this challenge.';
  }

  return null;
}

/**
 * The ledger reason for an approved challenge.
 *
 * Composed from the HANDBOOK ACTIVITY LABEL and the challenge title, so an
 * approved entry reads as what it was earned for rather than as "Challenge".
 * Example: "GitHub project — Ship Your First CLI".
 *
 * The XP amount is NOT passed to the database function - it reads the challenge
 * own xp_reward - so this is display text only.
 */
export function approvalReason(activityCode: string, challengeTitle: string): string {
  const label = getXpActivity(activityCode)?.label ?? activityCode;

  return `${label} — ${challengeTitle}`;
}

/** Groups submissions by status, preserving the order given within each. */
export function groupByStatus<T extends { status: ChallengeStatus }>(
  submissions: readonly T[]
): Record<ChallengeStatus, T[]> {
  const groups: Record<ChallengeStatus, T[]> = {
    pending: [],
    approved: [],
    rejected: [],
  };

  for (const submission of submissions) {
    groups[submission.status].push(submission);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// The client calls
// ---------------------------------------------------------------------------

export type ChallengeOutcome =
  | { ok: true; message: string }
  | {
      ok: false;
      kind: 'invalid' | 'conflict' | 'unauthorized' | 'forbidden' | 'notFound' | 'unavailable';
      message: string;
    };

const UNAVAILABLE = 'The server could not be reached. Try again in a moment.';
const SERVER_ERROR =
  'The server could not complete that. Try again, and check the server log if it keeps failing.';

/**
 * Reports a response, keeping "the server said no" apart from "the server is
 * unreachable" - the two have different causes and this message is the only
 * clue the reader has.
 */
async function readOutcome(
  response: Response,
  fallback: string
): Promise<ChallengeOutcome> {
  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    return { ok: false, kind: 'forbidden', message: 'Only XP managers can do that.' };
  }

  if (response.status === 404) {
    return { ok: false, kind: 'notFound', message: 'That no longer exists.' };
  }

  if (response.status === 409) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    return {
      ok: false,
      kind: 'conflict',
      message: payload?.error === 'Already pending'
        ? 'You already have a submission waiting for review.'
        : payload?.error === 'Already reviewed'
          ? 'That submission has already been reviewed.'
          : 'That has already been done.',
    };
  }

  if (response.status >= 500) {
    return { ok: false, kind: 'unavailable', message: SERVER_ERROR };
  }

  if (!response.ok) {
    return { ok: false, kind: 'invalid', message: fallback };
  }

  return { ok: true, message: fallback };
}

/**
 * Submits a challenge.
 *
 * The response says NOTHING about XP, because nothing has been earned yet. A
 * submission is a claim awaiting review.
 */
export async function submitChallenge(
  slug: string,
  draft: SubmissionDraft,
  submissionType: 'github_url' | 'text',
  fetchImpl: typeof fetch = fetch
): Promise<ChallengeOutcome> {
  const checked = validateSubmission(submissionType, draft);

  if (!checked.ok) {
    return { ok: false, kind: 'invalid', message: checked.message };
  }

  let response: Response;

  try {
    response = await fetchImpl(`/api/challenges/${slug}/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        githubUrl: checked.githubUrl,
        submissionText: checked.submissionText,
      }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  const outcome = await readOutcome(
    response,
    'Submitted. A manager will review it — no XP is awarded until they do.'
  );

  if (!outcome.ok && outcome.kind === 'unavailable') {
    // A 5xx on a submission is not "unreachable".
    return { ok: false, kind: 'unavailable', message: SERVER_ERROR };
  }

  return outcome;
}

/** A manager's decision on one submission. */
export async function reviewSubmission(
  submissionId: string,
  decision: 'approve' | 'reject',
  feedback: string,
  fetchImpl: typeof fetch = fetch
): Promise<ChallengeOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(`/api/manager/challenges/submissions/${submissionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, feedback }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return readOutcome(
    response,
    decision === 'approve'
      ? 'Approved. The XP is in the ledger.'
      : 'Rejected. The member can resubmit.'
  );
}
