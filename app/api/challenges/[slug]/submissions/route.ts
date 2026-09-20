// Phase 9: submit a challenge.
//
//   POST /api/challenges/[slug]/submissions
//
// Any signed-in member may submit. There is no manager check, because taking a
// challenge is what members do.
//
// THIS GRANTS NO XP. It writes one row to `challenge_submissions` with status
// 'pending' and touches `xp_ledger` not at all. XP is awarded only by a manager
// approving the submission, through approve_challenge_submission - which is the
// only code in the application that can write a challenge award.
//
// The one-pending-per-challenge rule is enforced by a partial unique index in
// the database, not by a check here, so two rapid clicks cannot both succeed.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createChallengeSubmission,
  getChallengeBySlug,
  getMemberSubmissions,
} from '@/lib/db/queries';
import { requireMember } from '@/lib/auth/require-manager';
import {
  canSubmit,
  submissionBlockedReason,
  validateSubmission,
} from '@/lib/challenges/challenges';

const bodySchema = z.strictObject({
  githubUrl: z.string().nullable(),
  submissionText: z.string().nullable(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const auth = await requireMember();

    if (!auth.ok) return auth.response;

    const { slug } = await context.params;

    const challenge = await getChallengeBySlug(slug);

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // An archived challenge is read-only: its page stays readable, and the
    // submissions already made against it stay readable, but no new attempt can
    // be started against something the club has retired.
    if (challenge.archivedAt !== null) {
      return NextResponse.json({ error: 'Challenge is archived' }, { status: 409 });
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const checked = validateSubmission(challenge.submissionType, {
      githubUrl: parsed.data.githubUrl ?? '',
      submissionText: parsed.data.submissionText ?? '',
    });

    if (!checked.ok) {
      return NextResponse.json({ error: checked.message }, { status: 400 });
    }

    // Read the member's own history first, so the common refusals get a sentence
    // that explains them. The database index is still the enforcement; this is
    // only the better message.
    const existing = await getMemberSubmissions(auth.member.memberId);

    if (existing === null) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const mine = existing.filter(
      (submission) => submission.challengeId === challenge.challengeId
    );

    if (!canSubmit(mine)) {
      return NextResponse.json(
        { error: submissionBlockedReason(mine) ?? 'Already pending' },
        { status: 409 }
      );
    }

    const created = await createChallengeSubmission({
      challengeId: challenge.challengeId,
      memberId: auth.member.memberId,
      githubUrl: checked.githubUrl,
      submissionText: checked.submissionText,
    });

    if (!created.ok) {
      // The index caught a race the read above did not.
      if (created.alreadyPending) {
        return NextResponse.json({ error: 'Already pending' }, { status: 409 });
      }

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, submissionId: created.submissionId, status: 'pending' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/challenges/[slug]/submissions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
