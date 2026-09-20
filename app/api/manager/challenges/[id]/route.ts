// Phase 9: edit or archive one challenge.
//
//   PATCH /api/manager/challenges/[id]   { action: 'update' | 'archive', ... }
//
// Manager-only, via lib/auth/require-manager.ts.
//
// THE SLUG IS NOT EDITABLE. It is the challenge's public address; changing it
// would break every link to it, including ones a member has already submitted
// against. Everything else a manager may fix.
//
// THE XP IS NOT EDITABLE EITHER. A manager changes the ACTIVITY, and the amount
// follows from lib/xp/activities.ts. Letting the reward be typed would let a
// challenge pay a number the Handbook does not list, which is exactly what the
// brief forbids.
//
// There is no DELETE. Archiving hides a challenge from the homepage and stops
// new submissions; the submissions already made against it stay readable.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { archiveChallenge, updateChallenge } from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { XP_ACTIVITY_CODES, getXpActivity } from '@/lib/xp/activities';

const updateSchema = z.strictObject({
  action: z.literal('update'),
  title: z.string().min(1).max(200),
  activityCode: z.string().min(1),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  description: z.string().min(1).max(2000),
  requirements: z.string().min(1).max(4000),
  estimatedHours: z.number().int().positive().max(1000),
  submissionType: z.enum(['github_url', 'text']),
});

const archiveSchema = z.strictObject({ action: z.literal('archive') });

const bodySchema = z.discriminatedUnion('action', [updateSchema, archiveSchema]);

const idSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const parsedId = idSchema.safeParse(id);

    if (!parsedId.success) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const challengeId = parsedId.data;

    if (parsed.data.action === 'archive') {
      const archived = await archiveChallenge(challengeId, auth.authUserId);

      if (!archived) {
        // The guarded UPDATE matched no row: already archived, or no such
        // challenge. Both are reported the same way, because neither is
        // actionable beyond "reload".
        return NextResponse.json(
          { error: 'Challenge is already archived' },
          { status: 409 }
        );
      }

      return NextResponse.json({ ok: true, action: 'archive' });
    }

    if (!XP_ACTIVITY_CODES.includes(parsed.data.activityCode)) {
      return NextResponse.json({ error: 'Not a Handbook activity' }, { status: 400 });
    }

    const activity = getXpActivity(parsed.data.activityCode);

    if (!activity) {
      return NextResponse.json({ error: 'Not a Handbook activity' }, { status: 400 });
    }

    const updated = await updateChallenge(challengeId, {
      title: parsed.data.title.trim(),
      activityCode: activity.code,
      // Resolved from the Handbook, not taken from the request.
      xpReward: activity.xp,
      difficulty: parsed.data.difficulty,
      description: parsed.data.description.trim(),
      requirements: parsed.data.requirements.trim(),
      estimatedHours: parsed.data.estimatedHours,
      submissionType: parsed.data.submissionType,
    });

    if (!updated) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, action: 'update', xpReward: activity.xp });
  } catch (error) {
    console.error('Error in PATCH /api/manager/challenges/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
