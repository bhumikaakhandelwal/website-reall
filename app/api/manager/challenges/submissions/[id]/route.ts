// Phase 9: review a challenge submission.
//
//   POST /api/manager/challenges/submissions/[id]   { decision, feedback }
//
// Manager-only, via lib/auth/require-manager.ts.
//
// THIS IS THE ONLY PLACE A CHALLENGE AWARDS XP. Approving calls
// approve_challenge_submission, which locks the submission, refuses unless it
// is still pending, inserts exactly one ledger row using the CHALLENGE'S OWN
// Handbook xp_reward, stores that row's id on the submission, and stamps the
// reviewer and the time - all in one transaction.
//
// IDEMPOTENT BY CONSTRUCTION. The function returns no rows when the submission
// has already been decided, so clicking Approve twice writes nothing: no second
// ledger row, no second XP, and no change to who reviewed it. That is reported
// as a 409 rather than a 500, because it is a normal thing to happen.
//
// The XP amount is never passed from here. A manager approves an ACTIVITY, and
// the amount comes from the challenge row.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  approveChallengeSubmission,
  getAllChallenges,
  getChallengeSubmissions,
  rejectChallengeSubmission,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { MAX_FEEDBACK, approvalReason } from '@/lib/challenges/challenges';

const bodySchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  feedback: z.string().max(MAX_FEEDBACK).optional().default(''),
});

const idSchema = z.string().uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const parsedId = idSchema.safeParse(id);

    if (!parsedId.success) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const submissionId = parsedId.data;
    const feedback = parsed.data.feedback.trim();

    if (parsed.data.decision === 'reject') {
      const result = await rejectChallengeSubmission(
        submissionId,
        auth.authUserId,
        feedback === '' ? null : feedback
      );

      if (result.ok) {
        return NextResponse.json({ ok: true, decision: 'reject', xpAwarded: 0 });
      }

      if (result.outcome === 'not_found') {
        return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
      }

      if (result.outcome === 'already_reviewed') {
        return NextResponse.json({ error: 'Already reviewed' }, { status: 409 });
      }

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Approving. The reason is a display string composed from the Handbook
    // activity's label and the challenge's title - "GitHub project — Ship Your
    // First CLI" - so an approved entry reads as what it was earned for rather
    // than as "Challenge".
    //
    // Both are read here rather than passed to the database, because the
    // Handbook activity labels live in TypeScript and are deliberately not
    // duplicated in SQL.
    //
    // getAllChallenges, not getChallenges: a submission made against a challenge
    // that has SINCE been archived is still reviewable. Archiving hides a
    // challenge from the homepage; it does not invalidate work already done
    // against it.
    const [submissions, challenges] = await Promise.all([
      getChallengeSubmissions(),
      getAllChallenges(),
    ]);

    if (!submissions || !challenges) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const submission = submissions.find((row) => row.submissionId === submissionId);

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const challenge = challenges.find(
      (row) => row.challengeId === submission.challengeId
    );

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    const reason = approvalReason(challenge.activityCode, challenge.title);

    const result = await approveChallengeSubmission(
      submissionId,
      auth.authUserId,
      reason
    );

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        decision: 'approve',
        xpAwarded: challenge.xpReward,
        ledgerId: result.ledgerId,
      });
    }

    if (result.outcome === 'not_found') {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // The submission was already decided. Nothing was written, which is exactly
    // the guarantee this route exists to provide.
    if (result.outcome === 'already_reviewed') {
      return NextResponse.json({ error: 'Already reviewed' }, { status: 409 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } catch (error) {
    console.error(
      'Error in POST /api/manager/challenges/submissions/[id]:',
      error
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
