// Phase 6: generate the member onboarding migration from a roster.
//
// USAGE
//   node scripts/generate-onboarding-migration.mjs <roster.json> <output.sql>
//
// The roster is a JSON array of approved members:
//
//   [
//     { "email": "2414011@dbcegoa.ac.in", "displayName": "Basil Shaikh Mohammad" },
//     ...
//   ]
//
// The roster is NOT committed to this repository. It is a list of real people,
// and the only place it needs to exist in git is inside the generated migration
// - which is the artifact that actually has to run. Feed this script a fresh
// export whenever the roster changes.
//
// VALIDATION IS A HARD GATE. If the roster has a duplicate email, a malformed
// address, an empty name, or a row that is not an object, this script prints
// every problem it found and exits non-zero WITHOUT writing the output file.
// It never writes a partial or best-effort migration: the generated SQL is run
// by hand against a live roster, so a bad roster must fail here, where it is
// cheap, rather than half-apply there.
//
// The output is deterministic - same roster in, byte-identical file out - so a
// regeneration that changes nothing produces no diff.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  renderOnboardingSql,
  validateRoster,
} from '../lib/onboarding/roster.ts';

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const [, , rosterPath, outputPath] = process.argv;

if (!rosterPath || !outputPath) {
  fail(
    'usage: node scripts/generate-onboarding-migration.mjs <roster.json> <output.sql>'
  );
}

const resolvedRoster = resolve(rosterPath);
const resolvedOutput = resolve(outputPath);

// --- read -------------------------------------------------------------------

let raw;

try {
  raw = readFileSync(resolvedRoster, 'utf8');
} catch (error) {
  fail(`could not read the roster at ${resolvedRoster}: ${error.message}`);
}

let parsed;

try {
  parsed = JSON.parse(raw);
} catch (error) {
  fail(`the roster at ${resolvedRoster} is not valid JSON: ${error.message}`);
}

// Accept either a bare array or an object wrapping one, so a roster exported
// with a little metadata around it does not need hand-editing first.
const rows = Array.isArray(parsed)
  ? parsed
  : Array.isArray(parsed?.members)
    ? parsed.members
    : null;

if (rows === null) {
  fail(
    'the roster must be a JSON array of { email, displayName }, or an object with a "members" array'
  );
}

if (rows.length === 0) {
  fail('the roster is empty - refusing to generate a migration that onboards nobody');
}

// --- validate ---------------------------------------------------------------

const validation = validateRoster(rows);

if (!validation.ok) {
  const { problems } = validation;

  console.error(
    `\n  REFUSING TO GENERATE: the roster at ${resolvedRoster} has ${problems.length} problem(s).\n`
  );

  for (const problem of problems) {
    console.error(`    row ${String(problem.row).padStart(3)}  [${problem.code}]  ${problem.message}`);
  }

  console.error(
    '\n  Fix the source roster and run again. No file was written.\n'
  );
  process.exit(1);
}

const { entries } = validation;

// --- generate ---------------------------------------------------------------

const sql = renderOnboardingSql(entries);

writeFileSync(resolvedOutput, sql, 'utf8');

const duplicatesInRoster = entries.length - new Set(entries.map((e) => e.email)).size;

console.log(`\n  roster rows validated : ${entries.length}`);
console.log(`  duplicate emails      : ${duplicatesInRoster}`);
console.log(`  migration written to  : ${resolvedOutput}`);
console.log(`  bytes                 : ${Buffer.byteLength(sql, 'utf8')}\n`);
