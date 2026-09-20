-- Phase 9 patch: correct the seeded submission_type for 30-Day Coding Streak.
--
-- WHY A MIGRATION IS GENUINELY REQUIRED
--
-- The Phase 9 migration seeded this challenge as `github_url`, which was wrong.
-- The Handbook asks for a 30-day streak on LeetCode or HackerRank, so the
-- evidence is a profile link or a written explanation - not a repository. The
-- submission form is rendered FROM this column (that is the whole point of the
-- column), so as long as the stored value is wrong, the page asks for the wrong
-- thing.
--
-- The row is already in the database, so no amount of application code can
-- correct it: the value has to be changed where it lives. That is what makes
-- this a real migration rather than a code change.
--
-- WHAT IT DOES NOT DO
--   * no XP value is touched. The streak still pays the Handbook's 250.
--   * no new column, no new table, no constraint change.
--   * no other challenge is modified.
--   * no submissions are touched - this changes what the form ASKS FOR, not
--     anything already submitted or approved.
--
-- IDEMPOTENT: the WHERE clause means a second run matches nothing, and a
-- database created fresh from 20260920000002 ends up in the same state as one
-- that has had this applied to it.

UPDATE public.challenges
   SET submission_type = 'text'
 WHERE slug = '30-day-coding-streak'
   AND submission_type <> 'text';

COMMENT ON COLUMN public.challenges.submission_type IS
    'Phase 9: which evidence the challenge asks for, and therefore which submission field stores it - github_url or text. Drives the form the challenge page renders.';
