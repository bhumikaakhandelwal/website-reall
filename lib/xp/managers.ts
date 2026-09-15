// XP manager authorization.
//
// Phase 3 policy: exactly TWO people may create XP ledger entries. Everyone
// else - including other council members - is read-only with respect to XP.
//
// This is deliberately NOT a general role system. There is no role column on
// members and no "isAdmin" flag exposed to the frontend. The allowlist lives
// here, in one place, and authorization is always evaluated server-side from
// the authenticated member's own email address.
//
// The emails are the DBCE college email ids that already identify these two
// members in the `members` table. No database UUID is hardcoded.

export const XP_MANAGER_EMAILS: readonly string[] = [
  '2414011@dbcegoa.ac.in', // Basil Shaikh Mohammad
  '2414012@dbcegoa.ac.in', // Bhumika Khandelwal
];

/**
 * True only for the two authorised XP managers.
 *
 * Accepts the email of the member resolved from the signed session cookie.
 * Never call this with a client-supplied value.
 */
export function isXpManager(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;

  return XP_MANAGER_EMAILS.includes(email.trim().toLowerCase());
}
