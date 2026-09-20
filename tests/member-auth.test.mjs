// Phase 8D: Supabase Auth, self-activation, onboarding and password management.
//
// Three halves in one file, because they are one change:
//
//   1. the pure logic in lib/auth/activation.ts, lib/members/onboarding.ts and
//      lib/profile/security.ts. This project has no DOM test environment (Node's
//      type stripping does not transform JSX, so a .tsx component cannot be
//      imported into a test at all), so these modules are where the decisions
//      live and where they can be asserted.
//
//   2. the routes, run for real against in-memory doubles for Supabase Auth, the
//      data layer and the session.
//
// The rules this file exists to pin: ONLY MEMBERS MAY ACTIVATE, NO PASSWORD IS
// EVER CREATED OR STORED BY THIS APPLICATION, and NO MEMBER IS EVER DELETED.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { dbState, resetDbState, activationState } from './doubles/db-queries.ts';
import { authState } from './doubles/auth-session.ts';
import { adminState, resetAdminState } from './doubles/supabase-admin.ts';
import { serverAuthState, resetServerAuthState } from './doubles/supabase-server.ts';

import {
  ACTIVATION_COPY,
  canSelfActivate,
  checkEmail,
  requestActivation,
  resolveActivationStatus,
} from '@/lib/auth/activation';
import { addMember, validateNewMember } from '@/lib/members/onboarding';
import {
  MIN_PASSWORD_LENGTH,
  changePassword,
  requestPasswordReset,
  validatePasswordChange,
} from '@/lib/profile/security';
import {
  POST as checkActivation,
  PUT as sendActivation,
} from '@/app/api/auth/activation/route';
import { POST as sendReset } from '@/app/api/auth/reset/route';
import { POST as changeOwnPassword } from '@/app/api/profile/password/route';
import { POST as addMemberRoute } from '@/app/api/manager/members/route';
import { POST as memberAction } from '@/app/api/manager/members/[id]/route';

const BASIL_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
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

function context(id) {
  return { params: Promise.resolve({ id }) };
}

function post(url, body) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
// resolveActivationStatus
// ---------------------------------------------------------------------------

test('a non-member is not-a-member whatever else is true', () => {
  // The central rule: only members already on the roster may activate. An
  // unknown address is refused before anything else is considered.
  for (const membershipStatus of [null, 'active', 'pending', 'inactive']) {
    for (const hasAuthAccount of [true, false]) {
      assert.strictEqual(
        resolveActivationStatus({
          memberExists: false,
          membershipStatus,
          hasAuthAccount,
        }),
        'not-a-member',
        `${membershipStatus} / ${hasAuthAccount}`
      );
    }
  }
});

test('a deactivated member is refused before the account check', () => {
  // Deactivation has to mean something at the door. A deactivated member must
  // not be handed a new way in, whether or not they already have an account.
  for (const hasAuthAccount of [true, false]) {
    assert.strictEqual(
      resolveActivationStatus({
        memberExists: true,
        membershipStatus: 'inactive',
        hasAuthAccount,
      }),
      'deactivated',
      String(hasAuthAccount)
    );
  }
});

test('a member with no account needs activation', () => {
  for (const membershipStatus of ['active', 'pending']) {
    assert.strictEqual(
      resolveActivationStatus({
        memberExists: true,
        membershipStatus,
        hasAuthAccount: false,
      }),
      'needs-activation',
      membershipStatus
    );
  }
});

test('a member who has activated is told to sign in', () => {
  assert.strictEqual(
    resolveActivationStatus({
      memberExists: true,
      membershipStatus: 'active',
      hasAuthAccount: true,
    }),
    'has-account'
  );
});

test('only needs-activation offers the first-time flow', () => {
  assert.strictEqual(canSelfActivate('needs-activation'), true);

  for (const status of ['not-a-member', 'has-account', 'deactivated']) {
    assert.strictEqual(canSelfActivate(status), false, status);
  }
});

test('every status has copy', () => {
  for (const status of ['not-a-member', 'needs-activation', 'has-account', 'deactivated']) {
    assert.ok(ACTIVATION_COPY[status].length > 0, status);
  }

  assert.match(ACTIVATION_COPY['needs-activation'], /found your club membership/i);
});

// ---------------------------------------------------------------------------
// checkEmail and requestActivation
// ---------------------------------------------------------------------------

test('checkEmail returns the status and its message', async () => {
  const outcome = await checkEmail('  MEMBER@dbcegoa.ac.in  ', fetchStub(200, {
    status: 'needs-activation',
  }));

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.status, 'needs-activation');
  assert.strictEqual(outcome.message, ACTIVATION_COPY['needs-activation']);
});

test('checkEmail normalizes the address it sends', async () => {
  let body = null;

  await checkEmail('  MEMBER@DBCEGOA.AC.IN  ', async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ status: 'not-a-member' }), { status: 200 });
  });

  assert.deepStrictEqual(body, { email: 'member@dbcegoa.ac.in' });
});

test('checkEmail rejects a malformed address without a request', async () => {
  let called = false;

  const outcome = await checkEmail('not-an-email', async () => {
    called = true;
    return new Response('{}', { status: 200 });
  });

  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'invalid');
  assert.strictEqual(called, false);
});

test('checkEmail reports an unknown status as unavailable', async () => {
  // A status this build does not understand must not be guessed at.
  for (const body of [{}, { status: 'nonsense' }, null]) {
    const outcome = await checkEmail('member@dbcegoa.ac.in', fetchStub(200, body));

    assert.strictEqual(outcome.ok, false, JSON.stringify(body));
    assert.strictEqual(outcome.kind, 'unavailable');
  }
});

test('requestActivation PUTs the address', async () => {
  let captured = null;

  const outcome = await requestActivation('member@dbcegoa.ac.in', async (url, init) => {
    captured = { url, method: init.method, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(captured.method, 'PUT');
  assert.strictEqual(captured.url, '/api/auth/activation');
  assert.match(outcome.message, /check your inbox/i);
});

test('requestActivation explains a refusal', async () => {
  const notMember = await requestActivation(
    'nobody@dbcegoa.ac.in',
    fetchStub(403, { error: 'Not a member' })
  );
  const inactive = await requestActivation(
    'member@dbcegoa.ac.in',
    fetchStub(403, { error: 'Membership is inactive' })
  );

  assert.strictEqual(notMember.kind, 'rejected');
  assert.strictEqual(notMember.message, ACTIVATION_COPY['not-a-member']);
  assert.strictEqual(inactive.kind, 'rejected');
  assert.strictEqual(inactive.message, ACTIVATION_COPY.deactivated);
});

// ---------------------------------------------------------------------------
// validateNewMember
// ---------------------------------------------------------------------------

test('a complete member is accepted and normalized', () => {
  const result = validateNewMember({
    displayName: '  Aisha   Fernandes ',
    email: '  AISHA@dbcegoa.ac.in ',
  });

  assert.deepStrictEqual(result, {
    ok: true,
    displayName: 'Aisha Fernandes',
    email: 'aisha@dbcegoa.ac.in',
  });
});

test('a blank name is rejected', () => {
  for (const displayName of ['', '   ', '\t']) {
    const result = validateNewMember({ displayName, email: 'a@dbcegoa.ac.in' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'displayName');
  }
});

test('an over-long name is rejected', () => {
  const result = validateNewMember({
    displayName: 'a'.repeat(201),
    email: 'a@dbcegoa.ac.in',
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.field, 'displayName');
});

test('a blank, malformed or over-long email is rejected', () => {
  const cases = [
    ['', 'email'],
    ['   ', 'email'],
    ['not-an-email', 'email'],
    ['a@b', 'email'],
    [`${'a'.repeat(320)}@dbcegoa.ac.in`, 'email'],
  ];

  for (const [email, field] of cases) {
    const result = validateNewMember({ displayName: 'Aisha', email });

    assert.strictEqual(result.ok, false, email);
    assert.strictEqual(result.field, field, email);
  }
});

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------

test('addMember POSTs only the name and the email', async () => {
  let captured = null;

  await addMember(
    { displayName: 'Aisha Fernandes', email: 'aisha@dbcegoa.ac.in' },
    async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ ok: true, xpAwarded: true }), { status: 201 });
    }
  );

  assert.strictEqual(captured.url, '/api/manager/members');
  assert.strictEqual(captured.method, 'POST');

  // Nothing about XP, status or dates: the server owns all of those.
  assert.deepStrictEqual(Object.keys(captured.body).sort(), ['displayName', 'email']);
});

test('addMember reports a duplicate clearly', async () => {
  const outcome = await addMember(
    { displayName: 'Aisha', email: 'aisha@dbcegoa.ac.in' },
    fetchStub(409, { error: 'Email already exists' })
  );

  assert.strictEqual(outcome.kind, 'duplicate');
  assert.match(outcome.message, /already on the members list/);
});

test('addMember says so when the XP was not awarded', async () => {
  // The member row is created before the XP is awarded, so a failed award is a
  // partial success - and must not be reported as a clean one.
  const outcome = await addMember(
    { displayName: 'Aisha', email: 'aisha@dbcegoa.ac.in' },
    fetchStub(201, { ok: true, xpAwarded: false })
  );

  assert.strictEqual(outcome.ok, true);
  assert.match(outcome.message, /NOT awarded/);
});

test('addMember refuses a draft the form should have caught', async () => {
  let called = false;

  const outcome = await addMember({ displayName: '', email: 'a@dbcegoa.ac.in' }, async () => {
    called = true;
    return new Response('{}', { status: 201 });
  });

  assert.strictEqual(outcome.kind, 'invalid');
  assert.strictEqual(called, false);
});

// ---------------------------------------------------------------------------
// validatePasswordChange
// ---------------------------------------------------------------------------

test('a matching password of sufficient length is accepted', () => {
  const result = validatePasswordChange({
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });

  assert.deepStrictEqual(result, { ok: true, password: 'correct horse battery' });
});

test('a password is never trimmed', () => {
  // Spaces are legitimate password characters; trimming would make the stored
  // password differ from the one typed - the classic "works on one form" bug.
  const result = validatePasswordChange({
    password: '  spaces  ',
    confirm: '  spaces  ',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.password, '  spaces  ');
});

test('an empty, short or over-long password is rejected', () => {
  const cases = ['', 'a'.repeat(MIN_PASSWORD_LENGTH - 1), 'a'.repeat(73)];

  for (const password of cases) {
    const result = validatePasswordChange({ password, confirm: password });

    assert.strictEqual(result.ok, false, `${password.length} chars`);
    assert.strictEqual(result.field, 'password');
  }
});

test('a mismatched confirmation is rejected against the confirm field', () => {
  const result = validatePasswordChange({
    password: 'correct horse battery',
    confirm: 'correct horse batteries',
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.field, 'confirm');
  assert.match(result.message, /do not match/);
});

// ---------------------------------------------------------------------------
// changePassword and requestPasswordReset
// ---------------------------------------------------------------------------

test('changePassword POSTs only the new password', async () => {
  let captured = null;

  await changePassword(
    { password: 'correct horse battery', confirm: 'correct horse battery' },
    async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  );

  assert.strictEqual(captured.url, '/api/profile/password');

  // No member id: the session identifies the member, so this cannot be pointed
  // at somebody else.
  assert.deepStrictEqual(Object.keys(captured.body), ['password']);
});

test('changePassword reports a rejection and a lost session', async () => {
  const draft = { password: 'correct horse battery', confirm: 'correct horse battery' };

  assert.strictEqual((await changePassword(draft, fetchStub(401, {}))).kind, 'unauthorized');
  assert.strictEqual((await changePassword(draft, fetchStub(400, {}))).kind, 'rejected');
  assert.strictEqual((await changePassword(draft, fetchStub(500, {}))).kind, 'unavailable');
});

test('requestPasswordReset never reveals whether an account exists', async () => {
  // Same message on success, and the endpoint answers 200 regardless.
  const outcome = await requestPasswordReset(
    'member@dbcegoa.ac.in',
    fetchStub(200, { ok: true })
  );

  assert.strictEqual(outcome.ok, true);
  assert.match(outcome.message, /if that address has an account/i);
});

test('requestPasswordReset rejects a malformed address without a request', async () => {
  let called = false;

  const outcome = await requestPasswordReset('nope', async () => {
    called = true;
    return new Response('{}', { status: 200 });
  });

  assert.strictEqual(outcome.kind, 'invalid');
  assert.strictEqual(called, false);
});

// ---------------------------------------------------------------------------
// POST /api/auth/activation
// ---------------------------------------------------------------------------

test('the activation check rejects a malformed body', async () => {
  reset();

  for (const body of [{}, { email: 'nope' }, { email: '' }]) {
    const response = await checkActivation(post('/api/auth/activation', body));

    assert.strictEqual(response.status, 400, JSON.stringify(body));
  }
});

test('the activation check reports each of the four states', async () => {
  const cases = [
    [null, 'not-a-member'],
    [{ memberId: MEMBER_ID, membershipStatus: 'active', hasAuthAccount: false }, 'needs-activation'],
    [{ memberId: MEMBER_ID, membershipStatus: 'active', hasAuthAccount: true }, 'has-account'],
    [{ memberId: MEMBER_ID, membershipStatus: 'inactive', hasAuthAccount: false }, 'deactivated'],
  ];

  for (const [result, expected] of cases) {
    reset();
    activationState.result = result;

    const response = await checkActivation(
      post('/api/auth/activation', { email: 'member@dbcegoa.ac.in' })
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { status: expected }, expected);
  }
});

test('the activation check is unauthenticated', async () => {
  // It has to be: it is what a member uses BEFORE they can sign in.
  reset();
  activationState.result = null;

  const response = await checkActivation(
    post('/api/auth/activation', { email: 'nobody@dbcegoa.ac.in' })
  );

  assert.strictEqual(response.status, 200);
});

// ---------------------------------------------------------------------------
// PUT /api/auth/activation
// ---------------------------------------------------------------------------

test('a non-member cannot activate', async () => {
  reset();
  activationState.result = null;

  const response = await sendActivation(
    new Request('http://localhost/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@dbcegoa.ac.in' }),
    })
  );

  assert.strictEqual(response.status, 403);
  assert.deepStrictEqual(await response.json(), { error: 'Not a member' });

  // Nothing was created and no email was sent.
  assert.deepStrictEqual(adminState.authCalls, []);
});

test('a deactivated member cannot activate', async () => {
  reset();
  activationState.result = {
    memberId: MEMBER_ID,
    membershipStatus: 'inactive',
    hasAuthAccount: false,
  };

  const response = await sendActivation(
    new Request('http://localhost/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@dbcegoa.ac.in' }),
    })
  );

  assert.strictEqual(response.status, 403);
  assert.deepStrictEqual(adminState.authCalls, []);
});

test('a member with no account is invited and the link is recorded', async () => {
  reset();
  activationState.result = {
    memberId: MEMBER_ID,
    membershipStatus: 'active',
    hasAuthAccount: false,
  };
  adminState.inviteResult = { data: { user: { id: AUTH_USER_ID } }, error: null };

  const response = await sendActivation(
    new Request('http://localhost/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@dbcegoa.ac.in' }),
    })
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), { ok: true, alreadyActivated: false });

  // The invite carried no password - only the address and where to return to.
  const invite = adminState.authCalls.find((call) => call.method === 'inviteUserByEmail');
  assert.ok(invite);
  assert.strictEqual(invite.args[0], 'member@dbcegoa.ac.in');

  // The link is what makes "has this member activated?" a fact the application
  // owns next time.
  assert.deepStrictEqual(dbState.authUserWrites, [
    { memberId: MEMBER_ID, authUserId: AUTH_USER_ID },
  ]);
});

test('a member who already has an account gets a reset instead of an invite', async () => {
  reset();
  activationState.result = {
    memberId: MEMBER_ID,
    membershipStatus: 'active',
    hasAuthAccount: true,
  };

  const response = await sendActivation(
    new Request('http://localhost/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@dbcegoa.ac.in' }),
    })
  );

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), { ok: true, alreadyActivated: true });

  assert.ok(adminState.authCalls.some((call) => call.method === 'resetPasswordForEmail'));
  assert.ok(!adminState.authCalls.some((call) => call.method === 'inviteUserByEmail'));
});

test('an account created outside the app falls back to a reset', async () => {
  // The auth_user_id column cannot see an account created directly in the
  // Supabase dashboard, so the invite fails with "already registered" and the
  // member is sent a reset instead of being told nothing can be done.
  reset();
  activationState.result = {
    memberId: MEMBER_ID,
    membershipStatus: 'active',
    hasAuthAccount: false,
  };
  adminState.inviteResult = {
    data: null,
    error: { message: 'A user with this email address has already been registered' },
  };

  const response = await sendActivation(
    new Request('http://localhost/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@dbcegoa.ac.in' }),
    })
  );

  assert.strictEqual(response.status, 200);
  assert.ok(adminState.authCalls.some((call) => call.method === 'resetPasswordForEmail'));
});

test('a failed send is reported rather than swallowed', async () => {
  reset();
  activationState.result = {
    memberId: MEMBER_ID,
    membershipStatus: 'active',
    hasAuthAccount: false,
  };
  adminState.inviteResult = { data: null, error: { message: 'smtp exploded' } };

  const response = await sendActivation(
    new Request('http://localhost/api/auth/activation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@dbcegoa.ac.in' }),
    })
  );

  assert.strictEqual(response.status, 502);
  assert.deepStrictEqual(dbState.authUserWrites, [], 'no link may be recorded');
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset
// ---------------------------------------------------------------------------

test('the reset request answers 200 for anything well-formed', async () => {
  // Deliberately identical whether or not the address has an account: this is
  // reachable by anyone and must not become a way to enumerate members.
  for (const email of ['member@dbcegoa.ac.in', 'nobody@dbcegoa.ac.in']) {
    reset();

    const response = await sendReset(post('/api/auth/reset', { email }));

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { ok: true });
  }
});

test('the reset request answers 200 even when the send fails', async () => {
  reset();
  adminState.recoverResult = { error: { message: 'smtp exploded' } };

  const response = await sendReset(post('/api/auth/reset', { email: 'member@dbcegoa.ac.in' }));

  assert.strictEqual(response.status, 200);
});

test('the reset request rejects a malformed body', async () => {
  reset();

  const response = await sendReset(post('/api/auth/reset', { email: 'nope' }));

  assert.strictEqual(response.status, 400);
});

// ---------------------------------------------------------------------------
// POST /api/profile/password
// ---------------------------------------------------------------------------

test('changing a password requires a session', async () => {
  reset();

  const response = await changeOwnPassword(post('/api/profile/password', { password: 'correct horse battery' }));

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(serverAuthState.calls, []);
});

test('changing a password is refused for a deactivated member', async () => {
  reset();
  signInAs({ ...ORDINARY, membership_status: 'inactive' });
  dbState.profile = { ...ORDINARY, membership_status: 'inactive' };

  const response = await changeOwnPassword(post('/api/profile/password', { password: 'correct horse battery' }));

  assert.strictEqual(response.status, 403);
});

test('changing a password hands it straight to Supabase', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  serverAuthState.updateUserResult = { data: { user: { id: AUTH_USER_ID } }, error: null };

  const response = await changeOwnPassword(post('/api/profile/password', { password: 'correct horse battery' }));

  assert.strictEqual(response.status, 200);

  const call = serverAuthState.calls.find((entry) => entry.method === 'updateUser');
  assert.deepStrictEqual(call.args, [{ password: 'correct horse battery' }]);
});

test('changing a password rejects a too-short one before Supabase is called', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const response = await changeOwnPassword(post('/api/profile/password', { password: 'short' }));

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(serverAuthState.calls, []);
});

test('a password Supabase rejects is reported as a 400, not a 500', async () => {
  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;
  serverAuthState.updateUserResult = {
    data: null,
    error: { message: 'Password should be at least 6 characters' },
  };

  const response = await changeOwnPassword(post('/api/profile/password', { password: 'correct horse battery' }));

  assert.strictEqual(response.status, 400);
});

// ---------------------------------------------------------------------------
// POST /api/manager/members
// ---------------------------------------------------------------------------

test('adding a member answers 401 and 403', async () => {
  reset();
  const unauthorized = await addMemberRoute(post('/api/manager/members', { displayName: 'A', email: 'a@dbcegoa.ac.in' }));

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await addMemberRoute(post('/api/manager/members', { displayName: 'A', email: 'a@dbcegoa.ac.in' }));

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.memberWrites, []);
});

test('adding a member creates the row and awards Membership XP once', async () => {
  reset();
  signInAsManager();
  dbState.memberWriteResult = { ok: true, memberId: MEMBER_ID };

  const response = await addMemberRoute(
    post('/api/manager/members', { displayName: '  Aisha   Fernandes ', email: ' AISHA@dbcegoa.ac.in ' })
  );

  assert.strictEqual(response.status, 201);
  assert.deepStrictEqual(await response.json(), {
    ok: true,
    memberId: MEMBER_ID,
    xpAwarded: true,
  });

  assert.deepStrictEqual(dbState.memberWrites, [
    {
      displayName: 'Aisha Fernandes',
      email: 'aisha@dbcegoa.ac.in',
      membershipStatus: 'active',
      membershipStart: new Date().toISOString().slice(0, 10),
    },
  ]);

  // Exactly one ledger row, with the same activity code and amount the roster
  // import uses.
  assert.deepStrictEqual(dbState.writes, [
    {
      memberId: MEMBER_ID,
      xpAmount: 50,
      activityCode: 'membership',
      reason: 'Membership',
    },
  ]);
});

test('adding a member never creates an auth account or sends an email', async () => {
  // The whole point of Part D: the new member activates themselves later.
  reset();
  signInAsManager();

  await addMemberRoute(post('/api/manager/members', { displayName: 'Aisha', email: 'aisha@dbcegoa.ac.in' }));

  assert.deepStrictEqual(adminState.authCalls, []);
  assert.deepStrictEqual(serverAuthState.calls, []);
});

test('a duplicate email is a conflict, not a second member', async () => {
  reset();
  signInAsManager();
  dbState.memberWriteResult = { ok: false, duplicate: true };

  const response = await addMemberRoute(
    post('/api/manager/members', { displayName: 'Aisha', email: 'aisha@dbcegoa.ac.in' })
  );

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(dbState.writes, [], 'no XP may be awarded');
});

test('a failed XP award is reported without failing the request', async () => {
  reset();
  signInAsManager();
  dbState.memberWriteResult = { ok: true, memberId: MEMBER_ID };
  dbState.writeResult = { ok: false };

  const response = await addMemberRoute(
    post('/api/manager/members', { displayName: 'Aisha', email: 'aisha@dbcegoa.ac.in' })
  );

  // 201: the member WAS created. Saying 500 would send the manager looking for
  // somebody who is already on the roster.
  assert.strictEqual(response.status, 201);
  assert.strictEqual((await response.json()).xpAwarded, false);
});

test('adding a member rejects an empty body', async () => {
  reset();
  signInAsManager();

  for (const body of [{}, { displayName: 'Aisha' }, { email: 'a@dbcegoa.ac.in' }, { displayName: '   ', email: 'a@dbcegoa.ac.in' }]) {
    const response = await addMemberRoute(post('/api/manager/members', body));

    assert.strictEqual(response.status, 400, JSON.stringify(body));
  }

  assert.deepStrictEqual(dbState.memberWrites, []);
});

// ---------------------------------------------------------------------------
// POST /api/manager/members/[id]
// ---------------------------------------------------------------------------

test('member actions answer 401 and 403', async () => {
  reset();
  const unauthorized = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'deactivate' }), context(MEMBER_ID));

  assert.strictEqual(unauthorized.status, 401);

  reset();
  signInAs(ORDINARY);
  dbState.profile = ORDINARY;

  const forbidden = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'deactivate' }), context(MEMBER_ID));

  assert.strictEqual(forbidden.status, 403);
  assert.deepStrictEqual(dbState.statusWrites, []);
});

test('member actions answer 404 for an id that is not a member id', async () => {
  reset();
  signInAsManager();

  const response = await memberAction(post('/api/manager/members/not-a-uuid', { action: 'deactivate' }), context('not-a-uuid'));

  assert.strictEqual(response.status, 404);
  assert.deepStrictEqual(dbState.statusWrites, []);
});

test('member actions reject an unknown action', async () => {
  reset();
  signInAsManager();

  const response = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'delete' }), context(MEMBER_ID));

  assert.strictEqual(response.status, 400);
  assert.deepStrictEqual(dbState.statusWrites, []);
});

test('a manager cannot deactivate themselves', async () => {
  // With only two managers in the club this is easy to do by accident, and it
  // would lock them out of the page they are standing on.
  reset();
  signInAsManager(BASIL);

  const response = await memberAction(post(`/api/manager/members/${BASIL_ID}`, { action: 'deactivate' }), context(BASIL_ID));

  assert.strictEqual(response.status, 409);
  assert.deepStrictEqual(dbState.statusWrites, []);
});

test('deactivating and reactivating set the membership status', async () => {
  reset();
  signInAsManager();

  const deactivated = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'deactivate' }), context(MEMBER_ID));

  assert.strictEqual(deactivated.status, 200);
  assert.deepStrictEqual(dbState.statusWrites, [{ memberId: MEMBER_ID, status: 'inactive' }]);

  reset();
  signInAsManager();

  const reactivated = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'reactivate' }), context(MEMBER_ID));

  assert.strictEqual(reactivated.status, 200);
  assert.deepStrictEqual(dbState.statusWrites, [{ memberId: MEMBER_ID, status: 'active' }]);
});

test('no member action ever deletes anything', async () => {
  reset();
  signInAsManager();

  for (const action of ['deactivate', 'reactivate', 'send-reset']) {
    reset();
    signInAsManager();

    await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action }), context(MEMBER_ID));
  }

  assert.deepStrictEqual(dbState.deleteEventCalls, []);
  assert.deepStrictEqual(dbState.writes, [], 'no XP may be written');
});

test('sending a reset email targets the member on the row', async () => {
  reset();
  signInAsManager();

  const response = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'send-reset' }), context(MEMBER_ID));

  assert.strictEqual(response.status, 200);

  const call = adminState.authCalls.find((entry) => entry.method === 'resetPasswordForEmail');
  assert.ok(call);

  // The address comes from the member the route LOOKED UP, never from the
  // request body - which is what stops a manager resetting an address they were
  // not looking at. (The double holds a single profile slot, so the actor and
  // the target are the same member here; the address asserted is the one the
  // lookup returned.)
  assert.strictEqual(call.args[0], dbState.profile.email);
  assert.strictEqual(call.args[0], BASIL.email);

  // A reset changes no status.
  assert.deepStrictEqual(dbState.statusWrites, []);
});

test('a failed reset email is reported', async () => {
  reset();
  signInAsManager();
  adminState.recoverResult = { error: { message: 'smtp exploded' } };

  const response = await memberAction(post(`/api/manager/members/${MEMBER_ID}`, { action: 'send-reset' }), context(MEMBER_ID));

  assert.strictEqual(response.status, 502);
});
