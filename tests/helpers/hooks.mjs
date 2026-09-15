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
import { existsSync } from 'node:fs';
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

function findSourceFile(basePath) {
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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

  try {
    return nextResolve(specifier, context);
  } catch (error) {
    // `next` ships no "exports" map, so bare subpaths like "next/server" have
    // no extension resolution in Node's ESM resolver. Retry with ".js" before
    // giving up.
    const isBare = !specifier.startsWith('.') && !path.isAbsolute(specifier);

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
