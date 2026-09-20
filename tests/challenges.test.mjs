// Phase 9: challenges.
//
// The rules this file exists to pin:
//
//   * SUBMITTING GRANTS NOTHING. A submission writes one row and no XP.
//   * APPROVING GRANTS EXACTLY ONCE. A second approval writes nothing.
//   * THE XP IS THE HANDBOOK'S. Neither a member nor a manager can choose it.
//   * ONLY MANAGERS REVIEW. Members submit; nobody approves their own work.
//
// The pure logic is asserted directly (this project has no DOM test environment
// - Node's type stripping does not transform JSX, so a .tsx component cannot be
// imported into a test at all), and the routes are driven for real against
// in-memory doubles.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';
import { resetAdminState } from './doubles/supabase-admin.ts';
import { resetServerAuthState } from './doubles/supabase-server.ts';

import {
  STATUS_LABELS,
  SUBMISSION_EXAMPLES,
  submissionFieldFor,
  approvalReason,
  canSubmit,
  groupByStatus,
  handbookXpValues,
  isGithubUrl,
  submissionBlockedReason,
  submitChallenge,
  reviewSubmission,
  toSlug,
  validateSubmission,
  xpMatchesHandbook,
} from '@/lib/challenges/challenges';
import { getXpActivity } from '@/lib/xp/activities';
import { POST as submitRoute } from '@/app/api/challenges/[slug]/submissions/route';
import { POST as reviewRoute } from '@/app/api/manager/challenges/submissions/[id]/route';
import {
  GET as managerReadRoute,
  POST as createChallengeRoute,
} from '@/app/api/manager/challenges/route';
import { PATCH as challengePatchRoute } from '@/app/api/manager/challenges/[id]/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const CHALLENGE_ID = '55555555-5555-4555-8555-555555555555';
const SUBMISSION_ID = '66666666-6666-4666-8666-666666666666';
const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const BASIL = {
  id: BASIL_ID,
  email: '2414011@dbcegoa.ac.in',
  display_name: 'Basil Shaikh Mohammad',
  membership_status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const ORDINARY = {
  ...BASIL,
  id: MEMBER_ID,
  email: 'ordinary-member@dbcegoa.ac.in',
  display_name: 'Ordinary Member',
};

/** A challenge row, as the database returns it. */
function challengeRow(overrides = {}) {
  return {
    challengeId: CHALLENGE_ID,
    title: 'Ship Your First CLI',
    slug: 'ship-your-first-cli',
    activityCode: 'github-project',
    xpReward: 50,
    difficulty: 'beginner',
    description: 'Build a CLI and publish it.',
    requirements: 'A public repository with a README.',
    estimatedHours: 6,
    submissionType: 'github_url',
    archivedAt: null,
    createdAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

/** A submission row, as the database returns it. */
function submissionRow(overrides = {}) {
  return {
    submissionId: SUBMISSION_ID,
    challengeId: CHALLENGE_ID,
    memberId: MEMBER_ID,
    githubUrl: 'https://github.com/member/cli',
    submissionText: null,
    status: 'pending',
    managerFeedback: null,
    reviewedAt: null,
    xpLedgerId: null,
    createdAt: '2026-09-20T10:00:00Z',
    ...overrides,
  };
}

function reset() {
  resetDbState();
  resetAdminState();
  resetServerAuthState();
  authState.memberId = null;
}

function signInAs(profile) {
  authState.memberId = profile ? profile.id : null;
}

function signInAsManager(profile = BASIL) {
  signInAs(profile);
  dbState.profile = profile;
}

/**
 * Route context for `[slug]` routes.
 *
 * The manager routes take `[id]` instead, and a context carrying the wrong key
 * yields `undefined` - which reads as a 404 and looks like a routing bug rather
 * than a test bug. Two helpers, so the right key is always the obvious one.
 */
function context(slug) {
  return { params: Promise.resolve({ slug }) };
}

function idContext(id) {
  return { params: Promise.resolve({ id }) };
}

function request(method, body) {
  return new Request('http://localhost/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function fetchStub(status, body) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

// ---------------------------------------------------------------------------
// Handbook values
// ---------------------------------------------------------------------------

test('the Handbook XP values the seed uses are the Handbook values', () => {
  for (const [code, xp] of [
    ['github-project', 50],
    ['club-coding-problem', 50],
    ['open-source-contribution', 100],
    ['coding-streak-30-days', 250],
  ]) {
    assert.strictEqual(getXpActivity(code).xp, xp, code);
    assert.strictEqual(xpMatchesHandbook(code, xp), true, code);
  }
});

test('a value the Handbook does not list is not a Handbook value', () => {
  // The placeholder cards used 150 / 400 / 900. None of those is the Handbook
  // value for these activities.
  for (const invented of [150, 400, 900]) {
    assert.strictEqual(xpMatchesHandbook('github-project', invented), false);
  }
});

test('an unknown activity has no Handbook value at all', () => {
  assert.strictEqual(xpMatchesHandbook('not-an-activity', 50), false);
});

test('handbookXpValues lists every distinct Handbook amount', () => {
  const values = handbookXpValues();

  for (const expected of [50, 100, 150, 200, 250]) {
    assert.ok(values.includes(expected), `${expected} must be a Handbook value`);
  }
});

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

test('a GitHub URL must be github.com over http(s)', () => {
  assert.strictEqual(isGithubUrl('https://github.com/a/b'), true);
  assert.strictEqual(isGithubUrl('http://github.com/a/b'), true);
  assert.strictEqual(isGithubUrl('https://gist.github.com/a'), true);

  // The host matters: a manager is going to open this.
  assert.strictEqual(isGithubUrl('https://gitlab.com/a/b'), false);
  assert.strictEqual(isGithubUrl('https://github.com.evil.com/a'), false);
  assert.strictEqual(isGithubUrl('javascript:alert(1)'), false);
  assert.strictEqual(isGithubUrl('not a url'), false);
  assert.strictEqual(isGithubUrl(''), false);
});

test('a github_url challenge requires a GitHub URL', () => {
  assert.strictEqual(
    validateSubmission('github_url', { githubUrl: '', submissionText: 'notes' }).ok,
    false
  );
  assert.strictEqual(
    validateSubmission('github_url', {
      githubUrl: 'https://gitlab.com/a',
      submissionText: '',
    }).ok,
    false
  );
});

test('a github_url challenge accepts a URL and keeps optional notes', () => {
  const result = validateSubmission('github_url', {
    githubUrl: ' https://github.com/a/b ',
    submissionText: ' notes ',
  });

  assert.deepStrictEqual(result, {
    ok: true,
    githubUrl: 'https://github.com/a/b',
    submissionText: 'notes',
  });
});

test('a text challenge requires a written answer', () => {
  assert.strictEqual(
    validateSubmission('text', { githubUrl: '', submissionText: '' }).ok,
    false
  );

  const result = validateSubmission('text', {
    githubUrl: 'https://github.com/ignored',
    submissionText: 'What I did',
  });

  // The unused field is discarded rather than stored.
  assert.deepStrictEqual(result, {
    ok: true,
    githubUrl: null,
    submissionText: 'What I did',
  });
});

test('an over-long answer is rejected', () => {
  const result = validateSubmission('text', {
    githubUrl: '',
    submissionText: 'x'.repeat(4001),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.field, 'submissionText');
});

// ---------------------------------------------------------------------------
// Status rules
// ---------------------------------------------------------------------------

test('a member may submit when nothing is open and nothing is approved', () => {
  assert.strictEqual(canSubmit([]), true);
  assert.strictEqual(canSubmit([{ status: 'rejected' }]), true);
});

test('a member may not submit twice over', () => {
  assert.strictEqual(canSubmit([{ status: 'pending' }]), false);
  assert.strictEqual(canSubmit([{ status: 'approved' }]), false);
});

test('resubmitting after a rejection is allowed', () => {
  // The partial unique index only constrains PENDING rows, so this is the rule
  // the database enforces too.
  assert.strictEqual(canSubmit([{ status: 'rejected' }]), true);
  assert.strictEqual(canSubmit([{ status: 'rejected' }, { status: 'rejected' }]), true);
});

test('the blocked reason distinguishes waiting from already earned', () => {
  assert.match(submissionBlockedReason([{ status: 'pending' }]), /waiting for review/);
  assert.match(submissionBlockedReason([{ status: 'approved' }]), /already earned/);
  assert.strictEqual(submissionBlockedReason([{ status: 'rejected' }]), null);
  assert.strictEqual(submissionBlockedReason([]), null);
});

test('the status labels are the ones the member sees', () => {
  assert.strictEqual(STATUS_LABELS.pending, 'Pending Review');
  assert.strictEqual(STATUS_LABELS.approved, 'Approved');
  assert.strictEqual(STATUS_LABELS.rejected, 'Rejected');
});

test('grouping keeps the order it was given, within each status', () => {
  const groups = groupByStatus([
    { id: 1, status: 'pending' },
    { id: 2, status: 'approved' },
    { id: 3, status: 'pending' },
    { id: 4, status: 'rejected' },
  ]);

  assert.deepStrictEqual(groups.pending.map((s) => s.id), [1, 3]);
  assert.deepStrictEqual(groups.approved.map((s) => s.id), [2]);
  assert.deepStrictEqual(groups.rejected.map((s) => s.id), [4]);
});

// ---------------------------------------------------------------------------
// The ledger reason
// ---------------------------------------------------------------------------

test('an approved challenge reads as what it was earned for, not as "Challenge"', () => {
  const reason = approvalReason('github-project', 'Ship Your First CLI');

  assert.strictEqual(reason, 'GitHub project — Ship Your First CLI');
  assert.notStrictEqual(reason, 'Challenge');
  assert.match(reason, /Ship Your First CLI/);
});

test('the reason uses the Handbook label for the activity', () => {
  assert.strictEqual(
    approvalReason('open-source-contribution', 'Open-source Patch'),
    'Open-source contribution — Open-source Patch'
  );
});

test('an unknown activity still produces a usable reason', () => {
  assert.strictEqual(approvalReason('gone', 'Old Challenge'), 'gone — Old Challenge');
});

test('a slug is URL-safe', () => {
  assert.strictEqual(toSlug('Ship Your First CLI'), 'ship-your-first-cli');
  assert.strictEqual(toSlug('  Spaces & Symbols!  '), 'spaces-symbols');
  assert.strictEqual(toSlug('---'), '');
});

// ---------------------------------------------------------------------------
// The client calls
// ---------------------------------------------------------------------------

test('submitChallenge posts the checked draft', async () => {
  let captured = null;

  const outcome = await submitChallenge(
    'ship-your-first-cli',
    { githubUrl: 'https://github.com/a/b', submissionText: '' },
    'github_url',
    async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }
  );

  assert.strictEqual(captured.url, '/api/challenges/ship-your-first-cli/submissions');
  assert.strictEqual(captured.method, 'POST');
  assert.deepStrictEqual(captured.body, {
    githubUrl: 'https://github.com/a/b',
    submissionText: null,
  });

  // The message says nothing about XP having been earned.
  assert.match(outcome.message, /no XP is awarded until they do/i);
});

test('submitChallenge refuses a bad draft without a request', async () => {
  let called = false;

  const outcome = await submitChallenge(
    'x',
    { githubUrl: 'https://gitlab.com/a', submissionText: '' },
    'github_url',
    async () => {
      called = true;
      return new Response('{}', { status: 201 });
    }
  );

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'invalid');
  assert.strictEqual(called, false);
});

test('submitChallenge reports a duplicate pending submission', async () => {
  const outcome = await submitChallenge(
    'x',
    { githubUrl: 'https://github.com/a/b', submissionText: '' },
    'github_url',
    fetchStub(409, { error: 'Already pending' })
  );

  assert.strictEqual(outcome.kind, 'conflict');
  assert.match(outcome.message, /waiting for review/);
});

test('submitChallenge keeps a 5xx apart from an unreachable server', async () => {
  const server = await submitChallenge(
    'x',
    { githubUrl: 'https://github.com/a/b', submissionText: '' },
    'github_url',
    fetchStub(500, {})
  );
  const network = await submitChallenge(
    'x',
    { githubUrl: 'https://github.com/a/b', submissionText: '' },
    'github_url',
    async () => {
      throw new TypeError('fetch failed');
    }
  );

  assert.strictEqual(server.kind, 'unavailable');
  assert.notStrictEqual(server.message, network.message);
  assert.match(network.message, /could not be reached/);
});

test('reviewSubmission posts the decision', async () => {
  let captured = null;

  await reviewSubmission(SUBMISSION_ID, 'approve', 'nice', async (url, init) => {
    captured = { url, method: init.method, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(captured.method, 'POST');
  assert.deepStrictEqual(captured.body, { decision: 'approve', feedback: 'nice' });
});

test('reviewSubmission reports an already-reviewed submission', async () => {
  const outcome = await reviewSubmission(
    SUBMISSION_ID,
    'approve',
    '',
    fetchStub(409, { error: 'Already reviewed' })
  );

  assert.strictEqual(outcome.kind, 'conflict');
  assert.match(outcome.message, /already been reviewed/);
});

// ---------------------------------------------------------------------------
// POST /api/challenges/[slug]/submissions
// ---------------------------------------------------------------------------

test('submitting needs a session', async () => {
  reset();

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('ship-your-first-cli')
  );

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(dbState.challengeSubmissionWrites, []);
});

test('submitting a challenge that does not exist is a 404', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('nope')
  );

  assert.strictEqual(response.status, 404);
});

test('a member can submit, and it writes NO XP', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [];

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('ship-your-first-cli')
  );

  assert.strictEqual(response.status, 201);
  assert.deepStrictEqual(await response.json(), {
    ok: true,
    submissionId: '99999999-9999-4999-8999-999999999999',
    status: 'pending',
  });

  assert.deepStrictEqual(dbState.challengeSubmissionWrites, [
    {
      challengeId: CHALLENGE_ID,
      memberId: MEMBER_ID,
      githubUrl: 'https://github.com/a/b',
      submissionText: null,
    },
  ]);

  // The core rule: a submission grants nothing.
  assert.deepStrictEqual(dbState.writes, [], 'a submission must never write XP');
  assert.deepStrictEqual(dbState.reviewCalls, []);
});

test('a second pending submission is refused', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow({ status: 'pending' })];

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('ship-your-first-cli')
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(dbState.challengeSubmissionWrites, []);
});

test('a rejected submission can be resubmitted', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow({ status: 'rejected' })];

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('ship-your-first-cli')
  );

  assert.strictEqual(response.status, 201);
  assert.strictEqual(dbState.challengeSubmissionWrites.length, 1);
});

test('an approved challenge cannot be resubmitted', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow({ status: 'approved', xpLedgerId: 42 })];

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('ship-your-first-cli')
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(dbState.challengeSubmissionWrites, []);
});

test('an archived challenge accepts no submissions', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  dbState.challengeRows = [challengeRow({ archivedAt: '2026-09-20T00:00:00Z' })];
  dbState.submissionRows = [];

  const response = await submitRoute(
    request('POST', { githubUrl: 'https://github.com/a/b', submissionText: null }),
    context('ship-your-first-cli')
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(dbState.challengeSubmissionWrites, []);
});

test('a bad body is refused before anything is read', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  dbState.challengeRows = [challengeRow()];

  const response = await submitRoute(request('POST', {}), context('ship-your-first-cli'));

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(dbState.challengeSubmissionWrites, []);
});

// ---------------------------------------------------------------------------
// POST /api/manager/challenges/submissions/[id]
// ---------------------------------------------------------------------------

test('reviewing needs a manager', async () => {
  reset();
  const unauthorized = await reviewRoute(
    request('POST', { decision: 'approve' }),
    idContext(SUBMISSION_ID)
  );

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await reviewRoute(
    request('POST', { decision: 'approve' }),
    idContext(SUBMISSION_ID)
  );

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.reviewCalls, []);
});

test('a manager approves, and the ledger row is written once', async () => {
  reset();
  signInAsManager();
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow()];
  dbState.reviewResult = { data: [{ ledger_id: 42 }], error: null };

  const response = await reviewRoute(
    request('POST', { decision: 'approve' }),
    idContext(SUBMISSION_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), {
    ok: true,
    decision: 'approve',
    xpAwarded: 50,
    ledgerId: 42,
  });

  // The amount is the challenge's Handbook value, and the reviewer is the
  // manager's AUTH user id - not their members.id.
  const call = dbState.reviewCalls[0];

  assert.strictEqual(call.fnName, 'approve_challenge_submission');
  assert.deepStrictEqual(call.args, {
    submissionId: SUBMISSION_ID,
    reviewedBy: AUTH_USER_ID,
    reason: 'GitHub project — Ship Your First CLI',
  });
});

test('approving twice writes nothing the second time', async () => {
  // The database function returns no rows when the submission is no longer
  // pending, which is how a double-click is made harmless.
  reset();
  signInAsManager();
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow()];
  dbState.reviewResult = { data: [], error: null };

  const response = await reviewRoute(
    request('POST', { decision: 'approve' }),
    idContext(SUBMISSION_ID)
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(await response.json(), { error: 'Already reviewed' });
});

test('rejecting writes no XP and keeps the feedback', async () => {
  reset();
  signInAsManager();
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow()];
  dbState.reviewResult = { data: [{ submission_id: SUBMISSION_ID }], error: null };

  const response = await reviewRoute(
    request('POST', { decision: 'reject', feedback: 'Add tests and a README.' }),
    idContext(SUBMISSION_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), {
    ok: true,
    decision: 'reject',
    xpAwarded: 0,
  });

  assert.deepStrictEqual(dbState.reviewCalls[0].args, {
    submissionId: SUBMISSION_ID,
    reviewedBy: AUTH_USER_ID,
    feedback: 'Add tests and a README.',
  });
});

test('rejecting without feedback stores null rather than an empty string', async () => {
  reset();
  signInAsManager();
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow()];
  dbState.reviewResult = { data: [{ submission_id: SUBMISSION_ID }], error: null };

  await reviewRoute(request('POST', { decision: 'reject' }), idContext(SUBMISSION_ID));

  assert.strictEqual(dbState.reviewCalls[0].args.feedback, null);
});

test('a submission against an archived challenge is still reviewable', async () => {
  // Archiving hides a challenge from the homepage; it does not invalidate work
  // already done against it.
  reset();
  signInAsManager();
  dbState.challengeRows = [challengeRow({ archivedAt: '2026-09-20T00:00:00Z' })];
  dbState.submissionRows = [submissionRow()];
  dbState.reviewResult = { data: [{ ledger_id: 7 }], error: null };

  const response = await reviewRoute(
    request('POST', { decision: 'approve' }),
    idContext(SUBMISSION_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.strictEqual((await response.json()).ledgerId, 7);
});

test('reviewing rejects an unknown decision and an unknown submission', async () => {
  reset();
  signInAsManager();

  assert.strictEqual(
    (await reviewRoute(request('POST', { decision: 'delete' }), idContext(SUBMISSION_ID))).status,
    400
  );
  assert.strictEqual(
    (await reviewRoute(request('POST', { decision: 'approve' }), idContext('not-a-uuid'))).status,
    404
  );
});

// ---------------------------------------------------------------------------
// GET / POST / PATCH /api/manager/challenges
// ---------------------------------------------------------------------------

test('the manager console needs a manager', async () => {
  reset();
  assert.strictEqual((await managerReadRoute()).status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  assert.strictEqual((await managerReadRoute()).status, 403);
});

test('the manager console returns the catalogue, the queue and the roster', async () => {
  reset();
  signInAsManager();
  dbState.challengeRows = [challengeRow()];
  dbState.submissionRows = [submissionRow()];
  dbState.directoryRows = [
    {
      memberId: MEMBER_ID,
      email: 'ordinary-member@dbcegoa.ac.in',
      displayName: 'Ordinary Member',
      membershipStatus: 'active',
      joinedAt: '2026-09-01T00:00:00Z',
      totalXp: 0,
      archivedAt: null,
    },
  ];

  const payload = await (await managerReadRoute()).json();

  assert.strictEqual(payload.challenges.length, 1);
  assert.strictEqual(payload.submissions.length, 1);
  assert.strictEqual(payload.members[0].displayName, 'Ordinary Member');
  assert.strictEqual(payload.viewerId, BASIL_ID);
});

test('creating a challenge needs a manager', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await createChallengeRoute(
    request('POST', {
      title: 'X',
      slug: 'x',
      activityCode: 'github-project',
      difficulty: 'beginner',
      description: 'd',
      requirements: 'r',
      estimatedHours: 1,
      submissionType: 'text',
    })
  );

  assert.strictEqual(response.status, 403);
  assert.deepStrictEqual(dbState.challengeWrites, []);
});

test('a created challenge takes its XP from the Handbook, not the request', async () => {
  reset();
  signInAsManager();

  const response = await createChallengeRoute(
    request('POST', {
      title: 'Ship Your First CLI',
      slug: 'Ship Your First CLI',
      activityCode: 'github-project',
      difficulty: 'beginner',
      description: 'd',
      requirements: 'r',
      estimatedHours: 6,
      submissionType: 'github_url',
    })
  );

  assert.strictEqual(response.status, 201);

  const written = dbState.challengeWrites[0];

  assert.strictEqual(written.xpReward, 50, 'the Handbook value');
  assert.strictEqual(written.activityCode, 'github-project');
  assert.strictEqual(written.slug, 'ship-your-first-cli', 'the slug is derived');
});

test('a caller cannot choose the XP at all', async () => {
  // The body schema is strict, so an `xpReward` is REJECTED outright rather than
  // quietly dropped. Even stronger than ignoring it: there is no shape of
  // request that sets an amount.
  reset();
  signInAsManager();

  const response = await createChallengeRoute(
    request('POST', {
      title: 'Ship Your First CLI',
      slug: 'ship-your-first-cli',
      activityCode: 'github-project',
      difficulty: 'beginner',
      description: 'd',
      requirements: 'r',
      estimatedHours: 6,
      submissionType: 'github_url',
      xpReward: 9999,
    })
  );

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(dbState.challengeWrites, []);
});

test('a challenge cannot be created against a non-Handbook activity', async () => {
  reset();
  signInAsManager();

  const response = await createChallengeRoute(
    request('POST', {
      title: 'Made up',
      slug: 'made-up',
      activityCode: 'invented-activity',
      difficulty: 'beginner',
      description: 'd',
      requirements: 'r',
      estimatedHours: 1,
      submissionType: 'text',
    })
  );

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(dbState.challengeWrites, []);
});

test('a duplicate slug is a conflict', async () => {
  reset();
  signInAsManager();
  dbState.challengeWriteResult = { ok: false, duplicateSlug: true };

  const response = await createChallengeRoute(
    request('POST', {
      title: 'Ship Your First CLI',
      slug: 'ship-your-first-cli',
      activityCode: 'github-project',
      difficulty: 'beginner',
      description: 'd',
      requirements: 'r',
      estimatedHours: 6,
      submissionType: 'github_url',
    })
  );

  assert.strictEqual(response.status, 409);
});

test('archiving a challenge records the manager and never deletes it', async () => {
  reset();
  signInAsManager();

  const response = await challengePatchRoute(
    request('PATCH', { action: 'archive' }),
    idContext(CHALLENGE_ID)
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(dbState.challengeArchives, [
    { challengeId: CHALLENGE_ID, archivedBy: AUTH_USER_ID },
  ]);
});

test('archiving twice is a conflict', async () => {
  reset();
  signInAsManager();
  dbState.challengeArchiveResult = false;

  const response = await challengePatchRoute(
    request('PATCH', { action: 'archive' }),
    idContext(CHALLENGE_ID)
  );

  assert.strictEqual(response.status, 409);
});

test('editing a challenge re-derives the XP from the activity', async () => {
  reset();
  signInAsManager();

  const response = await challengePatchRoute(
    request('PATCH', {
      action: 'update',
      title: 'Open-source Patch',
      activityCode: 'open-source-contribution',
      difficulty: 'advanced',
      description: 'd',
      requirements: 'r',
      estimatedHours: 10,
      submissionType: 'github_url',
    }),
    idContext(CHALLENGE_ID)
  );

  assert.strictEqual(response.status, 200);

  const update = dbState.challengeUpdates[0];

  assert.strictEqual(update.entry.xpReward, 100);
  // The slug is not editable: it is the challenge's public address.
  assert.strictEqual('slug' in update.entry, false);
});

test('editing against a non-Handbook activity is refused', async () => {
  reset();
  signInAsManager();

  const response = await challengePatchRoute(
    request('PATCH', {
      action: 'update',
      title: 'X',
      activityCode: 'invented',
      difficulty: 'beginner',
      description: 'd',
      requirements: 'r',
      estimatedHours: 1,
      submissionType: 'text',
    }),
    idContext(CHALLENGE_ID)
  );

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(dbState.challengeUpdates, []);
});

test('there is no way to delete a challenge', async () => {
  const { default: fs } = await import('node:fs');

  for (const file of [
    'app/api/manager/challenges/route.ts',
    'app/api/manager/challenges/[id]/route.ts',
  ]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    assert.ok(!/export async function DELETE/.test(source), `${file} must not export DELETE`);
  }
});

// ---------------------------------------------------------------------------
// Which form each seeded challenge renders
// ---------------------------------------------------------------------------
//
// The five seeded challenges must NOT all ask for the same thing. The Handbook
// proves different activities with different evidence, and this table is the
// contract between the seed and the form.

/** The seed, and the field each row must render. */
const SEEDED_FORMS = [
  {
    slug: 'ship-your-first-cli',
    activityCode: 'github-project',
    submissionType: 'github_url',
    label: 'GitHub Repository URL',
    kind: 'github_url',
  },
  {
    slug: 'javascript-debug-sprint',
    activityCode: 'club-coding-problem',
    submissionType: 'text',
    label: 'Solution / Proof',
    kind: 'text',
  },
  {
    slug: 'git-branch-rescue',
    activityCode: 'club-coding-problem',
    submissionType: 'text',
    label: 'Solution / Proof',
    kind: 'text',
  },
  {
    slug: 'open-source-patch',
    activityCode: 'open-source-contribution',
    submissionType: 'github_url',
    label: 'GitHub Pull Request URL',
    kind: 'github_url',
  },
  {
    slug: '30-day-coding-streak',
    activityCode: 'coding-streak-30-days',
    submissionType: 'text',
    label: 'Solution / Proof',
    kind: 'text',
  },
];

test('each seeded challenge renders the field the Handbook implies', () => {
  for (const seed of SEEDED_FORMS) {
    const field = submissionFieldFor(seed.activityCode, seed.submissionType);

    assert.strictEqual(field.label, seed.label, seed.slug);
    assert.strictEqual(field.kind, seed.kind, seed.slug);
  }
});

test('the five seeded challenges do NOT all ask for the same thing', () => {
  // The bug this patch fixes: every challenge rendering one GitHub form.
  const labels = new Set(
    SEEDED_FORMS.map(
      (seed) => submissionFieldFor(seed.activityCode, seed.submissionType).label
    )
  );

  assert.ok(labels.size >= 3, `expected at least 3 distinct fields, got ${labels.size}`);
});

test('Ship Your First CLI and Open-source Patch ask for different GitHub things', () => {
  // Both are github_url, and a member asked for a "Repository URL" on the
  // open-source challenge would submit their own fork instead of their PR.
  const cli = submissionFieldFor('github-project', 'github_url');
  const patch = submissionFieldFor('open-source-contribution', 'github_url');

  assert.strictEqual(cli.label, 'GitHub Repository URL');
  assert.strictEqual(patch.label, 'GitHub Pull Request URL');
  assert.notStrictEqual(cli.label, patch.label);
});

test('a written challenge never asks for a GitHub URL, whatever its activity', () => {
  for (const activityCode of [
    'github-project',
    'open-source-contribution',
    'club-coding-problem',
    'coding-streak-30-days',
    'invented',
  ]) {
    const field = submissionFieldFor(activityCode, 'text');

    assert.strictEqual(field.kind, 'text', activityCode);
    assert.strictEqual(field.label, 'Solution / Proof', activityCode);
    assert.ok(!/github/i.test(field.label), `${activityCode} must not mention GitHub`);
  }
});

test('a written challenge offers the four kinds of proof the brief lists', () => {
  const field = submissionFieldFor('coding-streak-30-days', 'text');

  assert.deepStrictEqual(field.examples, SUBMISSION_EXAMPLES);
  assert.deepStrictEqual(SUBMISSION_EXAMPLES, [
    'LeetCode profile link',
    'HackerRank profile',
    'Screenshot link',
    'Explanation of your solution',
  ]);
});

test('a GitHub challenge offers no proof examples', () => {
  assert.strictEqual(submissionFieldFor('github-project', 'github_url').examples, null);
});

test('the placeholder matches what is being asked for', () => {
  assert.match(
    submissionFieldFor('github-project', 'github_url').placeholder,
    /github\.com\/you/
  );
  assert.match(
    submissionFieldFor('open-source-contribution', 'github_url').placeholder,
    /\/pull\//
  );
});

test('a written challenge stores its answer in the text field, not the URL field', () => {
  // The schema is reused, not extended: submission_type decides which of the two
  // existing columns holds the value.
  const result = validateSubmission('text', {
    githubUrl: '',
    submissionText: 'My LeetCode profile: https://leetcode.com/u/me',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(
    result.submissionText,
    'My LeetCode profile: https://leetcode.com/u/me'
  );
  assert.strictEqual(result.githubUrl, null, 'the URL column must stay empty');
});

test('a written challenge is not held to GitHub URL validation', () => {
  // A LeetCode link is not a github.com URL and must not be rejected as one.
  const result = validateSubmission('text', {
    githubUrl: '',
    submissionText: 'https://leetcode.com/u/me',
  });

  assert.strictEqual(result.ok, true);
});

test('a written challenge still requires its answer to be non-empty', () => {
  for (const submissionText of ['', '   ', '\n']) {
    const result = validateSubmission('text', { githubUrl: '', submissionText });

    assert.strictEqual(result.ok, false, JSON.stringify(submissionText));
    assert.strictEqual(result.field, 'submissionText');
  }
});

test('a GitHub challenge still requires a valid GitHub URL', () => {
  for (const githubUrl of ['', '   ', 'https://leetcode.com/u/me', 'not a url']) {
    const result = validateSubmission('github_url', { githubUrl, submissionText: '' });

    assert.strictEqual(result.ok, false, JSON.stringify(githubUrl));
    assert.strictEqual(result.field, 'githubUrl');
  }
});
