// Level calculation.
//
// The seven level definitions live in the `levels` database table (the single
// source of truth, seeded from the Handbook). This module only derives which
// level a total XP falls into - it does not define the levels themselves and
// must never be given a second hardcoded copy of them.
//
// Handbook interpretation, with `xp_required` as the minimum XP to reach a
// level:
//
//   0-499    -> Level 1 Rookie
//   500-999  -> Level 2 Novice Coder
//   1000-1999 -> Level 3 Code Explorer
//   2000-2999 -> Level 4 Code Warrior
//   3000-3999 -> Level 5 Coding Champion
//   4000-4999 -> Level 6 Code Master
//   5000+     -> Level 7 Coding Legend

export type LevelDefinition = {
  id: number;
  title: string;
  /** Minimum XP required to reach this level. */
  xp_required: number;
  sort_order: number;
};

export type LevelProgress = {
  /** Level number (the `levels.id`). */
  level: number;
  title: string;
  /** XP needed for the next level, or null when already at the highest level. */
  nextLevelXp: number | null;
};

/**
 * Derives the level for a total XP amount.
 *
 * Uses the highest level whose `xp_required` threshold has been reached. A
 * negative total (possible if corrective entries overshoot an award) falls back
 * to the lowest level rather than failing.
 *
 * Throws if no levels are supplied - that means the `levels` table was not
 * seeded, which is a configuration error rather than something to guess at.
 */
export function resolveLevel(
  totalXp: number,
  levels: readonly LevelDefinition[]
): LevelProgress {
  if (levels.length === 0) {
    throw new Error('No level definitions available - is the levels table seeded?');
  }

  const ordered = [...levels].sort(
    (a, b) => a.xp_required - b.xp_required || a.sort_order - b.sort_order
  );

  // Highest level whose threshold has been reached. Falls back to the lowest
  // level for negative totals, where no threshold matches.
  let index = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    if (totalXp >= ordered[i].xp_required) {
      index = i;
    }
  }

  const current = ordered[index];
  const next = ordered[index + 1];

  return {
    level: current.id,
    title: current.title,
    nextLevelXp: next ? next.xp_required : null,
  };
}
