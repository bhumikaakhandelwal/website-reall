// Phase 6: roster validation.
//
// The validator is the gate between a supplied roster and the generated
// onboarding migration. It is the only thing standing between a typo in a form
// export and a migration that half-onboards a real roster, so it is tested
// harder than the rest of the phase.
//
// Everything here is pure - no database, no filesystem - so these tests run
// offline and in milliseconds, like the rest of `npm test`.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MEMBERSHIP_ACTIVITY_CODE,
  MEMBERSHIP_REASON,
  MEMBERSHIP_XP,
  normalizeEmail,
  normalizeName,
  quoteSqlLiteral,
  renderOnboardingSql,
  validateRoster,
} from '../lib/onboarding/roster.ts';

/** A valid single-row roster, so each test can vary exactly one thing. */
function row(overrides = {}) {
  return { email: 'someone@dbcegoa.ac.in', displayName: 'Someone Valid', ...overrides };
}

function problemsOf(rows) {
  const result = validateRoster(rows);

  assert.strictEqual(result.ok, false, 'expected the roster to be rejected');

  return result.problems;
}

function codesOf(rows) {
  return problemsOf(rows).map((problem) => problem.code);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('normalizeEmail trims and lowercases', () => {
  assert.strictEqual(normalizeEmail('  Someone@DBCEGoa.AC.IN  '), 'someone@dbcegoa.ac.in');
});

test('normalizeName trims and collapses internal whitespace', () => {
  // The source is a form export, so names arrive with stray tabs and doubles.
  assert.strictEqual(normalizeName('  Akhil \t R  Nair  '), 'Akhil R Nair');
});

// ---------------------------------------------------------------------------
// A good roster
// ---------------------------------------------------------------------------

test('a clean roster is accepted', () => {
  const result = validateRoster([row()]);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.entries, [
    { email: 'someone@dbcegoa.ac.in', displayName: 'Someone Valid' },
  ]);
});

test('accepted entries carry the NORMALIZED email and name', () => {
  const result = validateRoster([
    { email: '  Someone@DBCEGoa.AC.IN ', displayName: '  Someone   Valid  ' },
  ]);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.entries, [
    { email: 'someone@dbcegoa.ac.in', displayName: 'Someone Valid' },
  ]);
});

test('entries keep the source order', () => {
  const result = validateRoster([
    row({ email: 'zara@dbcegoa.ac.in', displayName: 'Zara' }),
    row({ email: 'aisha@dbcegoa.ac.in', displayName: 'Aisha' }),
    row({ email: 'basil@dbcegoa.ac.in', displayName: 'Basil' }),
  ]);

  assert.strictEqual(result.ok, true);
  // Not sorted: the generated SQL should read in the same order as the source
  // roster, so a reviewer can diff the two by eye.
  assert.deepStrictEqual(
    result.entries.map((entry) => entry.displayName),
    ['Zara', 'Aisha', 'Basil']
  );
});

test('an empty roster is structurally valid', () => {
  // The validator judges rows, not policy. Refusing an empty roster is the
  // generator's job (it would produce a migration that onboards nobody).
  const result = validateRoster([]);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.entries, []);
});

test('the validator does not mutate the rows it was given', () => {
  const rows = [row({ email: '  Mixed@Case.AC.IN  ', displayName: '  A   B  ' })];
  const before = JSON.parse(JSON.stringify(rows));

  validateRoster(rows);

  assert.deepStrictEqual(rows, before);
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

test('an exact duplicate email is rejected', () => {
  const problems = problemsOf([row(), row()]);

  assert.deepStrictEqual(problems.map((p) => p.code), ['duplicate-email']);
  assert.strictEqual(problems[0].row, 2, 'the SECOND occurrence is the problem');
  assert.match(problems[0].message, /already appears at row 1/);
});

test('a duplicate differing only in case is rejected', () => {
  // members.email is compared lowercased, so these are the same member. Without
  // this check the second row would be silently swallowed by
  // ON CONFLICT DO NOTHING and that member would go un-awarded.
  assert.deepStrictEqual(
    codesOf([row({ email: 'someone@dbcegoa.ac.in' }), row({ email: 'SOMEONE@dbcegoa.ac.in' })]),
    ['duplicate-email']
  );
});

test('a duplicate differing only in surrounding whitespace is rejected', () => {
  assert.deepStrictEqual(
    codesOf([row({ email: 'someone@dbcegoa.ac.in' }), row({ email: '  someone@dbcegoa.ac.in  ' })]),
    ['duplicate-email']
  );
});

test('three occurrences of the same email report two problems', () => {
  const problems = problemsOf([row(), row(), row()]);

  assert.strictEqual(problems.length, 2);
  assert.deepStrictEqual(
    problems.map((p) => p.row),
    [2, 3]
  );
  // Both point back at the FIRST occurrence, which is the one to keep.
  for (const problem of problems) {
    assert.match(problem.message, /already appears at row 1/);
  }
});

test('different emails are not duplicates', () => {
  assert.strictEqual(
    validateRoster([
      row({ email: 'a@dbcegoa.ac.in' }),
      row({ email: 'b@dbcegoa.ac.in' }),
    ]).ok,
    true
  );
});

// ---------------------------------------------------------------------------
// Malformed emails
// ---------------------------------------------------------------------------

test('malformed emails are rejected', () => {
  const malformed = [
    'not-an-email',
    'missing@',
    '@missing-local.com',
    'spaces in@email.com',
    'has space@x.com',
    'two@@at.com',
    'a@b',
    'a@b.c',
    'trailing@x.com.',
  ];

  for (const email of malformed) {
    assert.deepStrictEqual(
      codesOf([row({ email })]),
      ['malformed-email'],
      `${JSON.stringify(email)} must be rejected`
    );
  }
});

test('a missing or non-string email is rejected', () => {
  for (const email of [undefined, null, 42, true, {}, []]) {
    assert.deepStrictEqual(
      codesOf([row({ email })]),
      ['missing-email'],
      `${JSON.stringify(email)} must be rejected`
    );
  }
});

test('an empty or whitespace-only email is rejected', () => {
  for (const email of ['', '   ', '\t']) {
    assert.deepStrictEqual(codesOf([row({ email })]), ['missing-email']);
  }
});

test('an over-long email is rejected', () => {
  const long = `${'a'.repeat(MAX_EMAIL_LENGTH)}@dbcegoa.ac.in`;

  assert.deepStrictEqual(codesOf([row({ email: long })]), ['email-too-long']);
});

test('uppercase emails are normalized rather than rejected', () => {
  // The college issues lowercase ids, but a form export can capitalize them.
  // Normalizing matches what the login flow does before lookup.
  const result = validateRoster([row({ email: 'SOMEONE@DBCEGOA.AC.IN' })]);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.entries[0].email, 'someone@dbcegoa.ac.in');
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

test('a missing or non-string displayName is rejected', () => {
  for (const displayName of [undefined, null, 42, true, {}, []]) {
    assert.deepStrictEqual(
      codesOf([row({ displayName })]),
      ['missing-name'],
      `${JSON.stringify(displayName)} must be rejected`
    );
  }
});

test('an empty or whitespace-only displayName is rejected', () => {
  for (const displayName of ['', '   ', '\t\n']) {
    assert.deepStrictEqual(codesOf([row({ displayName })]), ['missing-name']);
  }
});

test('an over-long displayName is rejected', () => {
  assert.deepStrictEqual(
    codesOf([row({ displayName: 'a'.repeat(MAX_NAME_LENGTH + 1) })]),
    ['name-too-long']
  );
});

test('a name containing an apostrophe is accepted', () => {
  // The roster really does contain "Christopher Charles D'Souza". Apostrophes
  // are a quoting problem for the generator, not a validation problem here.
  const result = validateRoster([row({ displayName: "Christopher Charles D'Souza" })]);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.entries[0].displayName, "Christopher Charles D'Souza");
});

// ---------------------------------------------------------------------------
// Malformed rows
// ---------------------------------------------------------------------------

test('rows that are not objects are rejected', () => {
  for (const bad of ['a string', 42, true, null, undefined, ['an', 'array']]) {
    assert.deepStrictEqual(
      codesOf([bad]),
      ['not-an-object'],
      `${JSON.stringify(bad)} must be rejected`
    );
  }
});

test('a row missing both fields reports both problems', () => {
  assert.deepStrictEqual(codesOf([{}]), ['missing-email', 'missing-name']);
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test('every problem is reported, not just the first', () => {
  // A source with several mistakes should be fixable in one pass.
  const problems = problemsOf([
    row(), // 1 valid
    row({ email: 'not-an-email' }), // 2 malformed address
    row({ email: 'other@dbcegoa.ac.in', displayName: '   ' }), // 3 no name
    'not-an-object', // 4 wrong shape
    row(), // 5 duplicate of row 1
  ]);

  assert.deepStrictEqual(
    problems.map((problem) => problem.code),
    ['malformed-email', 'missing-name', 'not-an-object', 'duplicate-email']
  );
  assert.deepStrictEqual(
    problems.map((problem) => problem.row),
    [2, 3, 4, 5]
  );
});

test('a single row can report more than one problem', () => {
  // Rows are not rejected at the first fault, so a row with two mistakes shows
  // both rather than hiding the second until the first is fixed.
  const problems = problemsOf([row(), row({ displayName: '  ' })]);

  assert.deepStrictEqual(
    problems.map((problem) => problem.code),
    ['missing-name', 'duplicate-email']
  );
  assert.deepStrictEqual(
    problems.map((problem) => problem.row),
    [2, 2]
  );
});

test('problems are numbered from 1 and in source order', () => {
  const problems = problemsOf([
    row(),
    'not-an-object',
    row({ email: 'nope' }),
  ]);

  assert.deepStrictEqual(
    problems.map((problem) => problem.row),
    [2, 3]
  );
});

test('every problem carries a non-empty message', () => {
  const problems = problemsOf([{}, 'not-an-object', row({ email: 'x' }), row()]);

  assert.ok(problems.length > 0);
  for (const problem of problems) {
    assert.strictEqual(typeof problem.message, 'string');
    assert.ok(problem.message.length > 0, `${problem.code} must explain itself`);
  }
});

// ---------------------------------------------------------------------------
// SQL literal quoting
// ---------------------------------------------------------------------------

test('quoteSqlLiteral doubles single quotes', () => {
  assert.strictEqual(quoteSqlLiteral("D'Souza"), "'D''Souza'");
  assert.strictEqual(quoteSqlLiteral('plain'), "'plain'");
});

test('quoteSqlLiteral survives a name that is nothing but quotes', () => {
  // Two apostrophes in, each doubled, wrapped in the outer pair: six in total.
  const twoApostrophes = "''";

  assert.strictEqual(quoteSqlLiteral(twoApostrophes), "''''''");
  assert.strictEqual(quoteSqlLiteral(twoApostrophes).length, 6);
});

test('quoteSqlLiteral rejects a NUL character', () => {
  // PostgreSQL cannot store one in a text column, so emitting it would produce
  // a migration that fails at run time rather than at generation time.
  assert.throws(() => quoteSqlLiteral('a\u0000b'), /NUL/);
});

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

test('renderOnboardingSql is deterministic', () => {
  const entries = [
    { email: 'b@dbcegoa.ac.in', displayName: 'B' },
    { email: 'a@dbcegoa.ac.in', displayName: 'A' },
  ];

  assert.strictEqual(
    renderOnboardingSql(entries),
    renderOnboardingSql(entries),
    'the same roster must produce byte-identical SQL'
  );
});

test('renderOnboardingSql escapes apostrophes in the roster', () => {
  const sql = renderOnboardingSql([
    { email: 'd@dbcegoa.ac.in', displayName: "Christopher Charles D'Souza" },
  ]);

  assert.ok(sql.includes("'Christopher Charles D''Souza'"));
  // The unescaped form must not appear, or the literal would end early.
  assert.ok(!sql.includes("'Christopher Charles D'Souza'"));
});

test('renderOnboardingSql emits the membership constants', () => {
  const sql = renderOnboardingSql([
    { email: 'a@dbcegoa.ac.in', displayName: 'A' },
  ]);

  assert.ok(sql.includes(`'${MEMBERSHIP_ACTIVITY_CODE}'`));
  assert.ok(sql.includes(`'${MEMBERSHIP_REASON}'`));
  assert.ok(sql.includes(String(MEMBERSHIP_XP)));
});
