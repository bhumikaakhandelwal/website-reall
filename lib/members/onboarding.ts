// Phase 8D: manager-driven member onboarding.
//
// The manager enters a name and an email; the application creates the `members`
// row and awards Membership XP. It deliberately does NOT create a Supabase Auth
// account and does NOT send an invitation - the new member activates themselves
// from the login page, exactly like the 42 members who came before them. That
// is what keeps onboarding from sending an email nobody asked for.
//
// The validation lives here rather than in the component, because this project
// has no DOM test environment (Node's type stripping does not transform JSX, so
// a .tsx component cannot be imported into a test at all).
//
// The name and email rules are IMPORTED from lib/onboarding/roster.ts rather
// than restated. A hand-typed member and an imported one must be accepted by the
// same rules, or the roster importer and this form would disagree about what a
// valid member looks like.

import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  isWellFormedEmail,
  normalizeEmail,
  normalizeName,
} from '@/lib/onboarding/roster';

export type NewMemberDraft = {
  displayName: string;
  email: string;
};

export type NewMemberField = 'displayName' | 'email';

export type NewMemberValidation =
  | { ok: true; displayName: string; email: string }
  | { ok: false; field: NewMemberField; message: string };

/**
 * Validates a manager-entered member and returns the NORMALIZED values to
 * submit.
 *
 * Returns the first problem with the field it belongs to, so the form can put
 * the message next to the input that caused it. Two fields are corrected one at
 * a time; naming the field is more useful than listing everything.
 *
 * Duplicate emails are NOT checked here. `members.email` is UNIQUE, so the
 * database is the authority, and checking here would be a second, weaker answer
 * that could disagree with it - the API maps the conflict to a clear message
 * instead.
 */
export function validateNewMember(draft: NewMemberDraft): NewMemberValidation {
  const displayName = typeof draft.displayName === 'string' ? normalizeName(draft.displayName) : '';

  if (displayName.length === 0) {
    return { ok: false, field: 'displayName', message: 'Give the member a full name.' };
  }

  if (displayName.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      field: 'displayName',
      message: `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`,
    };
  }

  const email = typeof draft.email === 'string' ? normalizeEmail(draft.email) : '';

  if (email.length === 0) {
    return { ok: false, field: 'email', message: 'Give the member a DBCE email address.' };
  }

  if (email.length > MAX_EMAIL_LENGTH) {
    return {
      ok: false,
      field: 'email',
      message: `Keep the email to ${MAX_EMAIL_LENGTH} characters or fewer.`,
    };
  }

  if (!isWellFormedEmail(email)) {
    return { ok: false, field: 'email', message: 'That does not look like a valid email address.' };
  }

  return { ok: true, displayName, email };
}

export type AddMemberOutcome =
  | { ok: true; message: string }
  | { ok: false; kind: 'invalid' | 'duplicate' | 'unauthorized' | 'forbidden' | 'unavailable'; message: string };

const UNAVAILABLE = 'The server could not be reached. Try again in a moment.';

/**
 * Adds the member.
 *
 * Sends only the name and the email. Nothing about XP, status or dates is sent:
 * the membership XP is awarded by the server from the same constants the roster
 * import uses, and a client must not be able to choose an amount.
 */
export async function addMember(
  draft: NewMemberDraft,
  fetchImpl: typeof fetch = fetch
): Promise<AddMemberOutcome> {
  const checked = validateNewMember(draft);

  if (!checked.ok) {
    return { ok: false, kind: 'invalid', message: checked.message };
  }

  let response: Response;

  try {
    response = await fetchImpl('/api/manager/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: checked.displayName,
        email: checked.email,
      }),
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    return {
      ok: false,
      kind: 'forbidden',
      message: 'Only XP managers can add members.',
    };
  }

  if (response.status === 409) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    // Phase 8E: an archived member is not a plain duplicate. Re-adding them
    // would fail on the UNIQUE email index anyway, and the useful thing to say
    // is where they actually are.
    if (payload?.error === 'Member is archived') {
      return {
        ok: false,
        kind: 'duplicate',
        message: `${checked.email} belongs to an archived member. Restore them from the member lifecycle page instead of adding them again.`,
      };
    }

    return {
      ok: false,
      kind: 'duplicate',
      message: `${checked.email} is already on the members list.`,
    };
  }

  if (response.status === 400) {
    return { ok: false, kind: 'invalid', message: 'That member was not accepted. Check the details.' };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  // The member row is created before the XP is awarded, so a failed award is
  // reported in the payload rather than as an error - the member exists either
  // way, and saying otherwise would send the manager looking for someone who is
  // already on the list.
  const payload = (await response.json().catch(() => null)) as {
    xpAwarded?: unknown;
  } | null;

  const activated = `They can create their own password from the login page — no email has been sent to them.`;

  if (payload?.xpAwarded === false) {
    return {
      ok: true,
      message: `${checked.displayName} was added, but the Membership XP was NOT awarded. Award it from the member directory. ${activated}`,
    };
  }

  return {
    ok: true,
    message: `${checked.displayName} was added and awarded Membership XP. ${activated}`,
  };
}
