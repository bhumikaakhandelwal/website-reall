// Phase 9: the manager's challenge console.
//
//   GET  /api/manager/challenges   the catalogue and the review queue
//   POST /api/manager/challenges   create a challenge
//
// Manager-only, via lib/auth/require-manager.ts.
//
// THE XP AMOUNT IS NEVER TAKEN FROM THE REQUEST. A manager chooses a HANDBOOK
// ACTIVITY and the server resolves the amount from lib/xp/activities.ts - the
// same rule the Award XP panel follows, and the reason a challenge cannot be
// created that pays a number the Handbook does not list. An `xpReward` in the
// body is ignored rather than trusted.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createChallenge,
  getAllChallenges,
  getChallengeSubmissions,
  getMemberDirectory,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { XP_ACTIVITY_CODES, getXpActivity } from '@/lib/xp/activities';
import { toSlug } from '@/lib/challenges/challenges';

const createSchema = z.strictObject({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  activityCode: z.string().min(1),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  description: z.string().min(1).max(2000),
  requirements: z.string().min(1).max(4000),
  estimatedHours: z.number().int().positive().max(1000),
  submissionType: z.enum(['github_url', 'text']),
});

export async function GET() {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const [challenges, submissions, members] = await Promise.all([
      getAllChallenges(),
      getChallengeSubmissions(),
      // The FULL roster, not the active one: a submission made by a member who
      // has since been archived is still reviewable, and the queue must be able
      // to name them.
      getMemberDirectory(),
    ]);

    if (!challenges || !submissions || !members) {
      console.error('Error in GET /api/manager/challenges: data unavailable');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Names are joined in application code from the roster the directory already
    // reads, so the queue and the directory cannot disagree about what a member
    // is called.
    return NextResponse.json({
      challenges,
      submissions,
      members: members.map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        email: member.email,
      })),
      viewerId: auth.memberId,
    });
  } catch (error) {
    console.error('Error in GET /api/manager/challenges:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // The activity must be a Handbook activity, and the XP comes from it.
    if (!XP_ACTIVITY_CODES.includes(parsed.data.activityCode)) {
      return NextResponse.json(
        { error: 'Not a Handbook activity' },
        { status: 400 }
      );
    }

    const activity = getXpActivity(parsed.data.activityCode);

    if (!activity) {
      return NextResponse.json(
        { error: 'Not a Handbook activity' },
        { status: 400 }
      );
    }

    const slug = toSlug(parsed.data.slug);

    if (slug.length === 0) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
    }

    const created = await createChallenge({
      title: parsed.data.title.trim(),
      slug,
      activityCode: activity.code,
      // From the Handbook, never from the request.
      xpReward: activity.xp,
      difficulty: parsed.data.difficulty,
      description: parsed.data.description.trim(),
      requirements: parsed.data.requirements.trim(),
      estimatedHours: parsed.data.estimatedHours,
      submissionType: parsed.data.submissionType,
    });

    if (!created.ok) {
      if (created.duplicateSlug) {
        return NextResponse.json({ error: 'Slug already used' }, { status: 409 });
      }

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, challengeId: created.challengeId, xpReward: activity.xp },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/manager/challenges:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
