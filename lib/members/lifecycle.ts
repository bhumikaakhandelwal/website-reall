// Phase 8E: the member lifecycle (archive / restore).
//
// Mirrors lib/events/lifecycle.ts from Phase 8A deliberately: a nullable
// timestamp is the whole state, the split into two lists is a pure function, and
// the copy the manager reads lives next to the rule it explains.
//
// The decisions live here rather than in the components, because this project
// has no DOM test environment (Node's type stripping does not transform JSX, so
// a .tsx component cannot be imported into a test at all).
//
// THERE IS NO DELETE, HERE OR ANYWHERE. A member is a permanent club record that
// XP, attendance and event authorship all point at. Archiving hides them from
// the working lists and stops them earning; restoring brings them back. Neither
// touches a single historical row.

/** The minimum a row needs to be classified. */
type Archivable = { archivedAt: string | null };

/** Whether this member is archived. One rule, asked in one place. */
export function isArchived(member: Archivable): boolean {
  return member.archivedAt !== null;
}

/** Whether this member is on the working lists. */
export function isActive(member: Archivable): boolean {
  return member.archivedAt === null;
}

export type MemberGroups<T> = {
  active: T[];
  archived: T[];
};

/**
 * Splits the roster into its two halves.
 *
 * Order is preserved exactly as the database returned it (display name, then
 * id), so the two sections read the same way the directory does. The split
 * happens in application code rather than in SQL so that BOTH lists come from
 * the ONE roster read - which is what stops /manager/members and /members
 * disagreeing about who is on the roster.
 */
export function splitByArchive<T extends Archivable>(
  members: readonly T[]
): MemberGroups<T> {
  const groups: MemberGroups<T> = { active: [], archived: [] };

  for (const member of members) {
    if (isArchived(member)) {
      groups.archived.push(member);
    } else {
      groups.active.push(member);
    }
  }

  return groups;
}

/** The active roster, from a roster read. */
export function activeMembers<T extends Archivable>(
  members: readonly T[]
): T[] {
  return members.filter(isActive);
}

/** The archived roster, from a roster read. */
export function archivedMembers<T extends Archivable>(
  members: readonly T[]
): T[] {
  return members.filter(isArchived);
}

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

/**
 * The confirmation shown before archiving.
 *
 * Names the member and states the two consequences plainly - gone from the
 * working lists, history kept - because "archive" could reasonably be read as
 * either. Reversible is not mentioned because the Restore button is right there
 * on the archived row.
 */
export function describeArchive(displayName: string): string {
  return `Archive ${displayName}?`;
}

export const ARCHIVE_CONSEQUENCE =
  'They will disappear from the active member list and future attendance, but all XP and event history will be preserved.';

export function describeRestore(displayName: string): string {
  return `${displayName} is back on the active member list.`;
}

/** The sentence shown when an archived member is refused something. */
export const ARCHIVED_REFUSAL =
  'That member is archived, so they cannot receive new XP or be added to attendance. Restore them first.';

// ---------------------------------------------------------------------------
// The client calls
// ---------------------------------------------------------------------------

export type LifecycleOutcome =
  | { ok: true; message: string }
  | {
      ok: false;
      kind: 'conflict' | 'unauthorized' | 'forbidden' | 'notFound' | 'unavailable';
      message: string;
    };

const UNAVAILABLE = 'The server could not be reached. Try again in a moment.';

async function lifecycleRequest(
  memberId: string,
  action: 'archive' | 'restore',
  displayName: string,
  fetchImpl: typeof fetch
): Promise<LifecycleOutcome> {
  let response: Response;

  try {
    response = await fetchImpl(`/api/manager/members/${memberId}/${action}`, {
      method: 'PATCH',
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  if (response.status === 401) {
    return { ok: false, kind: 'unauthorized', message: 'Your session has ended.' };
  }

  if (response.status === 403) {
    return { ok: false, kind: 'forbidden', message: 'Only XP managers can do that.' };
  }

  if (response.status === 404) {
    return { ok: false, kind: 'notFound', message: 'That member no longer exists.' };
  }

  if (response.status === 409) {
    return {
      ok: false,
      kind: 'conflict',
      message:
        action === 'archive'
          ? `${displayName} is already archived.`
          : `${displayName} is already active.`,
    };
  }

  // A 5xx is NOT "the server could not be reached", and reporting it as such
  // sent the first debugging round looking at the network when the fault was a
  // rejected database write. The two are kept apart so the message points at the
  // right thing.
  if (response.status >= 500) {
    return {
      ok: false,
      kind: 'unavailable',
      message: 'The server could not complete that. Try again, and check the server log if it keeps failing.',
    };
  }

  if (!response.ok) {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return {
    ok: true,
    message: action === 'archive' ? `Archived ${displayName}.` : describeRestore(displayName),
  };
}

/** Archives a member. */
export function archiveMember(
  memberId: string,
  displayName: string,
  fetchImpl: typeof fetch = fetch
): Promise<LifecycleOutcome> {
  return lifecycleRequest(memberId, 'archive', displayName, fetchImpl);
}

/** Restores a member. */
export function restoreMember(
  memberId: string,
  displayName: string,
  fetchImpl: typeof fetch = fetch
): Promise<LifecycleOutcome> {
  return lifecycleRequest(memberId, 'restore', displayName, fetchImpl);
}

/** The manager's own id, so the page can refuse to archive itself. */
export function canArchive(
  memberId: string,
  viewerMemberId: string | null
): boolean {
  return memberId !== viewerMemberId;
}
