// Handbook XP activities.
//
// SINGLE SOURCE OF TRUTH for XP amounts on the server. Values come from the
// DBCE Coders Club Handbook (AY 2026-27) and are listed in ascending order.
//
// Members never choose an XP amount. A manager selects a handbook activity and
// the server resolves the amount from this list, so a client cannot request an
// arbitrary value.
//
// Note: app/content/xp-content.ts holds a separate, display-only copy of these
// activity names used by the public /xp-system page. That page is frozen
// presentational content and is never used to compute XP.

export type XpActivity = {
  /** Stable machine identifier stored in xp_ledger.activity_code. */
  code: string;
  /** Handbook wording, shown to XP managers. */
  label: string;
  /** Handbook XP value. */
  xp: number;
};

export const XP_ACTIVITIES: readonly XpActivity[] = [
  { code: "membership", label: "Membership", xp: 50 },
  { code: "technical-session", label: "Technical session", xp: 50 },
  { code: "club-coding-problem", label: "Club coding problem", xp: 50 },
  { code: "github-project", label: "GitHub project", xp: 50 },
  { code: "technical-tutorial", label: "Technical tutorial", xp: 50 },
  { code: "open-source-contribution", label: "Open-source contribution", xp: 100 },
  { code: "organizing-club-events", label: "Organizing club events", xp: 100 },
  { code: "internal-coding-contest", label: "Internal coding contest", xp: 100 },
  { code: "top-10-internal", label: "Top 10 internal", xp: 150 },
  { code: "external-contest-hackathon", label: "External coding contest/hackathon", xp: 150 },
  { code: "top-3-internal", label: "Top 3 internal", xp: 200 },
  { code: "conduct-workshop-session", label: "Conduct workshop/session/event", xp: 200 },
  { code: "hackathon-finals", label: "Hackathon finals", xp: 200 },
  { code: "win-hackathon", label: "Win hackathon", xp: 250 },
  { code: "coding-streak-30-days", label: "30-day coding streak", xp: 250 },
];

const ACTIVITY_BY_CODE = new Map(XP_ACTIVITIES.map((a) => [a.code, a]));

export const XP_ACTIVITY_CODES: readonly string[] = XP_ACTIVITIES.map((a) => a.code);

/**
 * Resolves a handbook activity by code.
 * Returns null for anything not in the handbook list.
 */
export function getXpActivity(code: unknown): XpActivity | null {
  if (typeof code !== "string") return null;

  return ACTIVITY_BY_CODE.get(code.trim()) ?? null;
}
