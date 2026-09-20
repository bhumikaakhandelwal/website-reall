// Module resolution hooks for the Phase 3 route tests.
//
// Two jobs, both applied before the test files are linked (hence `--import`):
//
//   1. Teach Node the app's `@/...` TypeScript path alias, so a test can
//      import a Next.js route handler directly.
//   2. Redirect the two modules that talk to Supabase to test doubles, so the
//      route tests exercise the real authorization and validation code with no
//      network, no database, and no XP written against the production roster.
//
// Nothing here runs in the application; it is test-only scaffolding.

import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../../..');

// Only the data-access boundary is doubled. Everything else — the routes, the
// XP manager allowlist, the activity table, the level calculation — is the
// real application code under test.
const DOUBLES = new Map([
  ['@/lib/db/queries', path.join(root, 'tests/doubles/db-queries.ts')],
  ['@/lib/auth/session', path.join(root, 'tests/doubles/auth-session.ts')],
]);

// The privileged Supabase client is doubled too, but as a stubbable factory
// rather than a fixed module: tests that exercise the real lib/db/queries.ts
// need to control what a `.rpc()` call resolves to (see
// tests/leaderboard-query-shape.test.mjs). Tests that only drive a route hit
// the `@/lib/db/queries` double above and never reach this one.
DOUBLES.set(
  '@/lib/supabase/admin',
  path.join(root, 'tests/doubles/supabase-admin.ts')
);

// Phase 8D: the anon-key client bound to the request cookies. Sign-in,
// sign-out, password update and password reset all go through it now, so the
// auth routes need to be able to drive those without a Supabase project.
DOUBLES.set(
  '@/lib/supabase/server',
  path.join(root, 'tests/doubles/supabase-server.ts')
);

function findSourceFile(basePath) {
  const candidates = [
    // `basePath` itself matches a specifier that already carries its
    // extension (`./doubles/db-queries.ts`).
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
  ];

  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    ) ?? null
  );
}

function resolveModule(specifier, context, nextResolve) {
  const doubled = DOUBLES.get(specifier);

  if (doubled) {
    return { url: pathToFileURL(doubled).href, shortCircuit: true };
  }

  if (specifier.startsWith('@/')) {
    const sourceFile = findSourceFile(path.join(root, specifier.slice(2)));

    if (sourceFile) {
      return { url: pathToFileURL(sourceFile).href, shortCircuit: true };
    }
  }

  // Application code uses extensionless imports (`./schema`, `next/server`);
  // Node's ESM resolver requires an explicit extension. Resolve those here,
  // before delegating, so a failure never reaches the bare-specifier path
  // below (an unresolved `@/...` alias must not be retried as a package name).
  if (specifier.startsWith('.')) {
    const resolved = findSourceFile(
      path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    );

    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  try {
    return nextResolve(specifier, context);
  } catch (error) {
    // `next` ships no "exports" map, so bare subpaths like "next/server" have
    // no extension resolution in Node's ESM resolver. Retry with ".js" before
    // giving up.
    const isBare =
      !specifier.startsWith('.') &&
      !specifier.startsWith('@/') &&
      !path.isAbsolute(specifier);

    if (isBare) {
      try {
        return nextResolve(`${specifier}.js`, context);
      } catch {
        // Fall through to the original error.
      }
    }

    throw error;
  }
}

registerHooks({ resolve: resolveModule });
