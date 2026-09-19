// Phase 8D: first-time self-activation.
//
// A member who exists in `members` but has no Supabase Auth account cannot sign
// in yet. The login page offers them a way to create their password, and that
// decision - which of four states an email is in, and what to say about it - is
// made here rather than in the component, because this project has no DOM test
// environment (Node's type stripping does not transform JSX, so a .tsx component
// cannot be imported into a test at all).
//
// NO ACCOUNT IS CREATED IN THIS MODULE. It decides, and asks the API; the API
// calls Supabase. In particular nothing here generates, receives or stores a
// password: the member chooses their own from the email the API sends.
//
// NO MASS EMAIL. Activation is always triggered by the member typing their own
// address on the login page. Nothing walks the roster.

import { isWellFormedEmail, normalizeEmail } from '@/lib/onboarding/roster';

/**
 * What the login page should do with an address someone typed.
 *
 * The four states are mutually exclusive and the order they are tested in is
 * deliberate - see resolveActivationStatus.
 */
export type ActivationStatus =
  /** Not in `members`. Not a club member, so nothing to activate. */
  | 'not-a-member'
  /** A member with no auth account: offer to create their password. */
  | 'needs-activation'
  /** A member who already has an account: they should just sign in. */
  | 'has-account'
  /** A member whose membership is inactive: refused, and told why. */
  | 'deactivated';

export type MemberActivationFacts = {
  /** Whether the email is in the `members` table at all. */
  memberExists: boolean;
  /** That member's membership_status, or null when they do not exist. */
  membershipStatus: string | null;
  /** Whether `members.auth_user_id` is set for them. */
  hasAuthAccount: boolean;
};

/**
 * Decides which of the four states a member is in.
 *
 * ORDER MATTERS, and two of the orderings are deliberate:
 *
 *   * A NON-MEMBER IS CHECKED FIRST, so an unknown address can never be told
 *     anything about activation. Only members already on the roster may
 *     activate themselves - that is the phase's central rule, and this is where
 *     it is enforced on the client side.
 *
 *   * A DEACTIVATED MEMBER IS CHECKED BEFORE the account check. Someone whose
 *     membership is inactive must not be handed a new way in, whether or not
 *     they happen to have an account already. Deactivation has to mean
 *     something at the door, not only after it.
 */
export function resolveActivationStatus(
  facts: MemberActivationFacts
): ActivationStatus {
  if (!facts.memberExists) return 'not-a-member';

  if (facts.membershipStatus === 'inactive') return 'deactivated';

  return facts.hasAuthAccount ? 'has-account' : 'needs-activation';
}

/**
 * The sentence to show for each state.
 *
 * Kept here so the four states cannot drift apart from their wording, and so
 * the copy is asserted on rather than retyped in a component.
 */
export const ACTIVATION_COPY: Record<ActivationStatus, string> = {
  'not-a-member':
    'That email is not on the approved members list. Ask a club manager to add you.',
  'needs-activation':
    'First time here? We found your club membership. Create your password.',
  'has-account': 'You already have an account — sign in with your password below.',
  deactivated:
    'Your club membership is inactive, so a password cannot be set up. Ask a club manager to reactivate you.',
};

/** True when the login page should offer the "create your password" flow. */
export function canSelfActivate(status: ActivationStatus): boolean {
  return status === 'needs-activation';
}

export type ActivationFailure = {
  ok: false;
  kind: 'invalid' | 'rejected' | 'unavailable';
  message: string;
};

export type CheckEmailOutcome =
  | { ok: true; status: ActivationStatus; message: string }
  | ActivationFailure;

export type ActivationRequestOutcome =
  | { ok: true; message: string }
  | ActivationFailure;

const UNAVAILABLE = 'The server could not be reached. Try again in a moment.';

/**
 * Asks the API which state an address is in.
 *
 * The address is normalized and shape-checked first, so a typo is caught here
 * rather than becoming a round trip that reports "not a member" for what is
 * really a malformed address - a message that would send someone to ask a
 * manager about a membership they already have.
 */
export async function checkEmail(
  rawEmail: string,
  fetchImpl: typeof fetch = fetch
): Promise<CheckEmailOutcome> {
  const email = normalizeEmail(rawEmail);

  if (!isWellFormedEmail(email)) {
    return {
      ok: false,
      kind: 'invalid',
      message: 'That does not look like a valid email address.',
    };
  }

  let response: Response;

  try {
    response = await fetchImpl('/api/auth/activation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (response.status === 400) {
    return {
      ok: false,
      kind: 'invalid',
      message: 'That does not look like a valid email address.',
    };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  const payload = (await response.json().catch(() => null)) as {
    status?: unknown;
  } | null;

  const status = payload?.status;

  if (
    status !== 'not-a-member' &&
    status !== 'needs-activation' &&
    status !== 'has-account' &&
    status !== 'deactivated'
  ) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return { ok: true, status, message: ACTIVATION_COPY[status] };
}

/**
 * Asks the API to send the setup email for a member who has not activated.
 *
 * The success message is deliberately identical whether the account was created
 * just now or already existed: the member's next step is the same either way -
 * open the email - and the page should not invite them to reason about which
 * case they were in.
 */
export async function requestActivation(
  rawEmail: string,
  fetchImpl: typeof fetch = fetch
): Promise<ActivationRequestOutcome> {
  const email = normalizeEmail(rawEmail);

  if (!isWellFormedEmail(email)) {
    return {
      ok: false,
      kind: 'invalid',
      message: 'That does not look like a valid email address.',
    };
  }

  let response: Response;

  try {
    response = await fetchImpl('/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (response.status === 400) {
    return {
      ok: false,
      kind: 'invalid',
      message: 'That does not look like a valid email address.',
    };
  }

  if (response.status === 403) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    return {
      ok: false,
      kind: 'rejected',
      message:
        payload?.error === 'Membership is inactive'
          ? ACTIVATION_COPY.deactivated
          : ACTIVATION_COPY['not-a-member'],
    };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return {
    ok: true,
    message:
      'Check your inbox — we have sent a link to that address. Open it to choose your password, then come back and sign in.',
  };
}
