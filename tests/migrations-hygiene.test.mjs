// Migration hygiene.
//
// This exists because of a real incident. Phase 6's onboarding migration was
// written with version 20260918000001, which manager_dashboard already used.
// Nothing in the test suite noticed. `schema_migrations.version` is a PRIMARY
// KEY and `supabase db push` matches on (version, name), so the collision only
// surfaced when a push was attempted:
//
//   ERROR: 23505: duplicate key value violates unique constraint
//   "schema_migrations_pkey"  DETAIL: Key (version)=(20260918000001) exists.
//
// Because push applies migrations in version order, one collision also blocks
// every migration after it. That is a deployment-stopping failure that a
// five-line test can prevent, so it is one now.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** `20260918000003_member_onboarding.sql` -> `20260918000003`. */
function versionOf(filename) {
  return filename.slice(0, filename.indexOf('_'));
}

test('there is at least one migration', () => {
  assert.ok(files.length > 0);
});

test('every migration filename is <version>_<name>.sql', () => {
  for (const name of files) {
    assert.match(
      name,
      /^\d{14}_[a-z0-9_]+\.sql$/,
      `${name} must be named <14-digit version>_<snake_case name>.sql`
    );
  }
});

test('no two migrations share a version', () => {
  // The one that matters. A duplicate version is a duplicate primary key, and
  // `supabase db push` fails on insert - taking every later migration with it.
  const seen = new Map();
  const collisions = [];

  for (const name of files) {
    const version = versionOf(name);

    if (seen.has(version)) {
      collisions.push(`${version}: ${seen.get(version)} and ${name}`);
    } else {
      seen.set(version, name);
    }
  }

  assert.deepStrictEqual(
    collisions,
    [],
    `duplicate migration versions will break \`supabase db push\`:\n  ${collisions.join('\n  ')}`
  );
});

test('migration versions sort in the same order as their filenames', () => {
  // The versions are zero-padded and sort lexically, which is what makes the
  // directory listing the apply order. A version with the wrong digit count
  // would sort somewhere unexpected.
  const versions = files.map(versionOf);

  assert.deepStrictEqual(versions, [...versions].sort());
});
