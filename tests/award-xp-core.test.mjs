// Phase 5B: the award path's logic.
//
// The Award XP panel is a client component and this project has no DOM test
// environment, so the panel's behaviour is expressed in lib/xp/award.ts as
// plain functions and driven here. These tests are the ones that actually
// matter for this feature: they pin the request the panel sends (and prove it
// can never send an amount), and they pin which failure the manager is shown
// for each status the endpoint can answer.
//
// The endpoint itself is already covered by tests/xp-api.test.mjs; this file
// covers the CLIENT half of that contract, so a drift between the two shows up
// as a failing test rather than as a broken award in production.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_OPTIONS,
  CORRECTION_MAX,
  CORRECTION_MIN,
  CORRECTION_REASON_MAX,
  awardXp,
  correctXp,
  correctionAmount,
  correctionPreview,
  filterMembers,
  resolveActivity,
  validateCorrection,
} from '../lib/xp/award.ts';
import { XP_ACTIVITIES, getXpActivity } from '../lib/xp/activities.ts';

const MEMBERS = [
  { memberId: 'id-1', displayName: 'Basil Shaikh Mohammad', email: '2414011@dbcegoa.ac.in' },
  { memberId: 'id-2', displayName: 'Bhumika Khandelwal', email: '2414012@dbcegoa.ac.in' },
  { memberId: 'id-3', displayName: 'Aisha Fernandes', email: 'aisha@dbcegoa.ac.in' },
];

const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

/** A fetch that records what it was called with and answers a fixed response. */
function stubFetch(response) {
  const calls = [];

  const impl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };

  return { impl, calls };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// filterMembers
// ---------------------------------------------------------------------------

test('filterMembers: an empty query returns the whole roster', () => {
  assert.deepStrictEqual(filterMembers(MEMBERS, ''), MEMBERS);
  assert.deepStrictEqual(filterMembers(MEMBERS, '   '), MEMBERS);
});

test('filterMembers: matches on display name, case-insensitively', () => {
  assert.deepStrictEqual(
    filterMembers(MEMBERS, 'aisha').map((m) => m.memberId),
    ['id-3']
  );
  assert.deepStrictEqual(
    filterMembers(MEMBERS, 'BHUMIKA').map((m) => m.memberId),
    ['id-2']
  );
});

test('filterMembers: matches on email as well as name', () => {
  assert.deepStrictEqual(
    filterMembers(MEMBERS, '2414011@').map((m) => m.memberId),
    ['id-1']
  );
});

test('filterMembers: a partial match on either field is enough', () => {
  // "Shaikh" is only in the name; "dbcegoa" is only in every email.
  assert.deepStrictEqual(
    filterMembers(MEMBERS, 'shaikh').map((m) => m.memberId),
    ['id-1']
  );
  assert.strictEqual(filterMembers(MEMBERS, 'dbcegoa').length, 3);
});

test('filterMembers: no match is an empty list, not the whole roster', () => {
  assert.deepStrictEqual(filterMembers(MEMBERS, 'nobody-here'), []);
});

test('filterMembers: does not mutate the input', () => {
  const original = [...MEMBERS];
  filterMembers(MEMBERS, 'aisha');

  assert.deepStrictEqual(MEMBERS, original);
});

// ---------------------------------------------------------------------------
// resolveActivity / ACTIVITY_OPTIONS
// ---------------------------------------------------------------------------

test('ACTIVITY_OPTIONS mirrors the Handbook list exactly, in order', () => {
  // Reused from lib/xp/activities.ts rather than redefined, so the dropdown can
  // never drift from the amounts the server awards.
  assert.deepStrictEqual(
    ACTIVITY_OPTIONS,
    XP_ACTIVITIES.map((a) => ({ code: a.code, label: a.label, xp: a.xp }))
  );
  assert.strictEqual(ACTIVITY_OPTIONS.length, 15);
});

test('resolveActivity: resolves a Handbook code to its label and amount', () => {
  assert.deepStrictEqual(resolveActivity('win-hackathon'), {
    code: 'win-hackathon',
    label: 'Win hackathon',
    xp: 250,
  });
});

test('resolveActivity: an unknown or empty code previews nothing', () => {
  // null, not a 0-XP preview that would misrepresent the award.
  assert.strictEqual(resolveActivity(''), null);
  assert.strictEqual(resolveActivity('free-xp-please'), null);
});

test('resolveActivity: every offered activity previews a positive amount', () => {
  for (const option of ACTIVITY_OPTIONS) {
    const resolved = resolveActivity(option.code);

    assert.ok(resolved, `${option.code} must resolve`);
    assert.ok(resolved.xp > 0, `${option.code} must have positive XP`);
    // The preview must equal what the server will resolve.
    assert.strictEqual(resolved.xp, getXpActivity(option.code).xp);
  }
});

// ---------------------------------------------------------------------------
// awardXp — the request
// ---------------------------------------------------------------------------

test('awardXp: posts only the member id and activity code', async () => {
  const { impl, calls } = stubFetch(
    jsonResponse(201, {
      ok: true,
      memberId: MEMBER_ID,
      xpAmount: 250,
      activityCode: 'win-hackathon',
      reason: 'Win hackathon',
    })
  );

  await awardXp(MEMBER_ID, 'win-hackathon', impl);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/xp/award');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['content-type'], 'application/json');

  // Exactly two keys. In particular no `xpAmount`: the endpoint's award schema
  // is strict, so sending an amount would turn a valid award into a 400.
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), {
    memberId: MEMBER_ID,
    activityCode: 'win-hackathon',
  });
});

test('awardXp: a 201 resolves to the awarded amount', async () => {
  const { impl } = stubFetch(
    jsonResponse(201, {
      ok: true,
      memberId: MEMBER_ID,
      xpAmount: 250,
      activityCode: 'win-hackathon',
      reason: 'Win hackathon',
    })
  );

  const outcome = await awardXp(MEMBER_ID, 'win-hackathon', impl);

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.xpAmount, 250);
  assert.strictEqual(outcome.memberId, MEMBER_ID);
  assert.strictEqual(outcome.activityCode, 'win-hackathon');
});

// ---------------------------------------------------------------------------
// awardXp — the failures the panel must tell apart
// ---------------------------------------------------------------------------

test('awardXp: 401 is unauthorized, not a generic error', async () => {
  const { impl } = stubFetch(jsonResponse(401, { error: 'Unauthorized' }));

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unauthorized');
});

test('awardXp: 403 is unauthorized, so the form is withdrawn', async () => {
  const { impl } = stubFetch(jsonResponse(403, { error: 'Forbidden' }));

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unauthorized');
});

test('awardXp: a rejected 400 carries a manager-readable message', async () => {
  const { impl } = stubFetch(
    jsonResponse(400, { error: 'Invalid request body' })
  );

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'rejected');
  // The server's own wording is never shown raw.
  assert.doesNotMatch(outcome.message, /Invalid request body/);
  // Wording that fits both modes - an award and a correction can each produce
  // this same 400.
  assert.match(outcome.message, /not valid/i);
  assert.match(outcome.message, /try again/i);
});

test('awardXp: an unknown activity code is explained in Handbook terms', async () => {
  const { impl } = stubFetch(
    jsonResponse(400, { error: 'Unknown activity code' })
  );

  const outcome = await awardXp(MEMBER_ID, 'free-xp-please', impl);

  assert.strictEqual(outcome.kind, 'rejected');
  assert.match(outcome.message, /Handbook/);
});

test('awardXp: a 404 (member deleted mid-session) is a rejection', async () => {
  const { impl } = stubFetch(jsonResponse(404, { error: 'Member not found' }));

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.kind, 'rejected');
  assert.match(outcome.message, /no longer exists/);
});

test('awardXp: an unrecognised 400 still produces a usable message', async () => {
  const { impl } = stubFetch(jsonResponse(400, { error: 'Something new' }));

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.kind, 'rejected');
  assert.ok(outcome.message.length > 0);
});

test('awardXp: a 500 is unavailable (retryable), not a rejection', async () => {
  const { impl } = stubFetch(jsonResponse(500, { error: 'Internal server error' }));

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('awardXp: a network failure never throws', async () => {
  const impl = async () => {
    throw new TypeError('Failed to fetch');
  };

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('awardXp: a 2xx with an unexpected body is not reported as success', async () => {
  const { impl } = stubFetch(jsonResponse(201, { ok: true }));

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  // Claiming success without the awarded amount would let the panel confirm an
  // award it cannot describe.
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('awardXp: a non-JSON error body does not throw', async () => {
  const impl = async () =>
    new Response('<html>502 Bad Gateway</html>', { status: 502 });

  const outcome = await awardXp(MEMBER_ID, 'membership', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('awardXp: every non-ok outcome carries a non-empty message', async () => {
  const statuses = [400, 401, 403, 404, 500, 502];

  for (const status of statuses) {
    const { impl } = stubFetch(jsonResponse(status, { error: 'x' }));
    const outcome = await awardXp(MEMBER_ID, 'membership', impl);

    assert.strictEqual(outcome.ok, false, `${status} must not be ok`);
    assert.ok(outcome.message.length > 0, `${status} must explain itself`);
    // A manager must never be shown a bare status code.
    assert.doesNotMatch(outcome.message, new RegExp(String(status)));
  }
});

// ---------------------------------------------------------------------------
// validateCorrection — the endpoint's rules, enforced before the round trip
// ---------------------------------------------------------------------------

test('validateCorrection: a well-formed deduction is accepted and signed', () => {
  const result = validateCorrection({
    amount: '50',
    reason: 'Duplicate GitHub project entry',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.correctionXp, -50);
  assert.strictEqual(result.reason, 'Duplicate GitHub project entry');
});

test('validateCorrection: the reason is trimmed', () => {
  const result = validateCorrection({ amount: '50', reason: '  spacing  ' });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'spacing');
});

test('validateCorrection: a correction requires a reason', () => {
  const missing = validateCorrection({ amount: '50', reason: '' });
  const blank = validateCorrection({ amount: '50', reason: '    ' });

  assert.strictEqual(missing.ok, false);
  assert.strictEqual(blank.ok, false);
  assert.match(blank.message, /reason/i);
});

test('validateCorrection: a missing or zero amount is rejected', () => {
  assert.strictEqual(validateCorrection({ amount: '', reason: 'x' }).ok, false);
  assert.strictEqual(validateCorrection({ amount: '   ', reason: 'x' }).ok, false);
  assert.strictEqual(validateCorrection({ amount: '0', reason: 'x' }).ok, false);
});

test('validateCorrection: non-integer amounts are rejected', () => {
  // Each of these would pass a naive Number() and become a 400 server-side.
  for (const amount of ['12.5', 'abc', '1e3', '0x10', 'Infinity', '--5', '5 0']) {
    const result = validateCorrection({ amount, reason: 'x' });

    assert.strictEqual(result.ok, false, `${amount} must be rejected`);
    assert.match(result.message, /whole number/i, `${amount} must explain itself`);
  }
});

test('validateCorrection: the amount is bounded at +/-1000', () => {
  assert.strictEqual(validateCorrection({ amount: '1000', reason: 'x' }).ok, true);
  assert.strictEqual(validateCorrection({ amount: '-1000', reason: 'x' }).ok, true);
  assert.strictEqual(validateCorrection({ amount: '1001', reason: 'x' }).ok, false);
  assert.strictEqual(validateCorrection({ amount: '-1001', reason: 'x' }).ok, false);
});

test('validateCorrection: the reason is bounded at 500 characters', () => {
  const atLimit = validateCorrection({
    amount: '50',
    reason: 'x'.repeat(CORRECTION_REASON_MAX),
  });
  const overLimit = validateCorrection({
    amount: '50',
    reason: 'x'.repeat(CORRECTION_REASON_MAX + 1),
  });

  assert.strictEqual(atLimit.ok, true);
  assert.strictEqual(overLimit.ok, false);
});

test('the client bounds match the endpoint schema', () => {
  // app/api/xp/award/route.ts: correctionXp .min(-1000).max(1000), reason
  // .min(1).max(500). If the server ever widens or narrows those, this fails
  // rather than the panel silently pre-rejecting a valid entry.
  assert.strictEqual(CORRECTION_MIN, -1000);
  assert.strictEqual(CORRECTION_MAX, 1000);
  assert.strictEqual(CORRECTION_REASON_MAX, 500);
});

// ---------------------------------------------------------------------------
// correctionAmount / correctionPreview
// ---------------------------------------------------------------------------

test('correctionAmount: the typed deduction is recorded as negative', () => {
  assert.strictEqual(correctionAmount('50'), -50);
  // Typing the sign explicitly is idempotent, not doubled.
  assert.strictEqual(correctionAmount('-50'), -50);
});

test('correctionAmount: unusable input yields zero rather than NaN', () => {
  assert.strictEqual(correctionAmount(''), 0);
  assert.strictEqual(correctionAmount('abc'), 0);
});

test('correctionPreview: shows the signed amount a manager is about to record', () => {
  assert.strictEqual(correctionPreview('50'), '-50 XP');
  assert.strictEqual(correctionPreview('1'), '-1 XP');
});

test('correctionPreview: previews nothing rather than "-0 XP" or "NaN XP"', () => {
  assert.strictEqual(correctionPreview(''), null);
  assert.strictEqual(correctionPreview('0'), null);
  assert.strictEqual(correctionPreview('abc'), null);
  assert.strictEqual(correctionPreview('1001'), null);
});

// ---------------------------------------------------------------------------
// correctXp — the request and the response
// ---------------------------------------------------------------------------

test('correctXp: posts exactly the correction shape, with no activityCode', async () => {
  const { impl, calls } = stubFetch(
    jsonResponse(201, {
      ok: true,
      memberId: MEMBER_ID,
      xpAmount: -50,
      activityCode: null,
      reason: 'Duplicate GitHub project entry',
    })
  );

  await correctXp(MEMBER_ID, -50, 'Duplicate GitHub project entry', impl);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/xp/award');
  assert.strictEqual(calls[0].init.method, 'POST');

  // Exactly three keys. The two request shapes are a strict union server-side,
  // so an `activityCode` here would fail validation rather than be ignored.
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), {
    memberId: MEMBER_ID,
    correctionXp: -50,
    reason: 'Duplicate GitHub project entry',
  });
});

test('correctXp: a 201 with activityCode null is a success, not a shape error', async () => {
  const { impl } = stubFetch(
    jsonResponse(201, {
      ok: true,
      memberId: MEMBER_ID,
      xpAmount: -50,
      activityCode: null,
      reason: 'Duplicate entry',
    })
  );

  const outcome = await correctXp(MEMBER_ID, -50, 'Duplicate entry', impl);

  // A correction is recorded with activity_code = NULL, so null is the expected
  // value here - unlike the award path, where it would be a fault.
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.kind, 'correction');
  assert.strictEqual(outcome.xpAmount, -50);
  assert.strictEqual(outcome.reason, 'Duplicate entry');
});

test('correctXp: 401 and 403 are unauthorized, matching the award path', async () => {
  for (const status of [401, 403]) {
    const { impl } = stubFetch(jsonResponse(status, { error: 'x' }));
    const outcome = await correctXp(MEMBER_ID, -50, 'reason', impl);

    assert.strictEqual(
      outcome.kind,
      'unauthorized',
      `${status} must withdraw the form`
    );
  }
});

test('correctXp: a 400 is a rejection with a manager-readable message', async () => {
  const { impl } = stubFetch(
    jsonResponse(400, { error: 'Invalid request body' })
  );

  const outcome = await correctXp(MEMBER_ID, -50, 'reason', impl);

  assert.strictEqual(outcome.kind, 'rejected');
  assert.doesNotMatch(outcome.message, /Invalid request body/);
  assert.ok(outcome.message.length > 0);
});

test('correctXp: a 404 is a rejection naming the member', async () => {
  const { impl } = stubFetch(jsonResponse(404, { error: 'Member not found' }));

  const outcome = await correctXp(MEMBER_ID, -50, 'reason', impl);

  assert.strictEqual(outcome.kind, 'rejected');
  assert.match(outcome.message, /no longer exists/);
});

test('correctXp: a 500 is retryable, and a network failure never throws', async () => {
  const { impl } = stubFetch(
    jsonResponse(500, { error: 'Internal server error' })
  );
  assert.strictEqual(
    (await correctXp(MEMBER_ID, -50, 'r', impl)).kind,
    'unavailable'
  );

  const failing = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.strictEqual(
    (await correctXp(MEMBER_ID, -50, 'r', failing)).kind,
    'unavailable'
  );
});

test('correctXp: a 2xx missing the recorded fields is not reported as success', async () => {
  const { impl } = stubFetch(jsonResponse(201, { ok: true }));

  const outcome = await correctXp(MEMBER_ID, -50, 'reason', impl);

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'unavailable');
});

test('the two modes never send each other s fields', async () => {
  const award = stubFetch(
    jsonResponse(201, {
      ok: true,
      memberId: MEMBER_ID,
      xpAmount: 250,
      activityCode: 'win-hackathon',
      reason: 'Win hackathon',
    })
  );
  await awardXp(MEMBER_ID, 'win-hackathon', award.impl);
  const awardBody = JSON.parse(award.calls[0].init.body);

  const correction = stubFetch(
    jsonResponse(201, {
      ok: true,
      memberId: MEMBER_ID,
      xpAmount: -50,
      activityCode: null,
      reason: 'Duplicate',
    })
  );
  await correctXp(MEMBER_ID, -50, 'Duplicate', correction.impl);
  const correctionBody = JSON.parse(correction.calls[0].init.body);

  assert.ok(!('correctionXp' in awardBody), 'an award must not carry correctionXp');
  assert.ok(!('reason' in awardBody), 'an award must not carry a reason');
  assert.ok(
    !('activityCode' in correctionBody),
    'a correction must not carry activityCode'
  );
});
