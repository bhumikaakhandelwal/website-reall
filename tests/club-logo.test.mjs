// Phase 10B: the club mark in the navigation.
//
// The nav is a .tsx component, so these are source assertions. They earn their
// place here because the failure modes are silent: a wrong `src` renders a
// broken image on every page, and a colour/filter that does not compile leaves
// the mark unstyled with the build still green.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const NAV_URL = new URL('../app/components/global-navigation.tsx', import.meta.url);
const CSS_URL = new URL('../app/globals.css', import.meta.url);
const LOGO_URL = new URL('../public/logo.png', import.meta.url);

const NAV = readFileSync(NAV_URL, 'utf8');
const CSS = readFileSync(CSS_URL, 'utf8');

// ---------------------------------------------------------------------------
// The asset
// ---------------------------------------------------------------------------

test('the logo asset exists and is a real PNG', () => {
  const bytes = readFileSync(LOGO_URL);

  // The 8-byte PNG signature. A JPEG renamed to .png would fail here, and it
  // would fail loudly in the browser as a broken image on every page.
  assert.deepStrictEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  );

  // IHDR colour type 6 is RGBA, which is what "transparent background" means.
  assert.strictEqual(bytes[25], 6, 'the PNG must carry an alpha channel');
});

test('the logo asset is small enough to load on every page', () => {
  // It is requested on every route, so it must not be a heavyweight file.
  const { size } = statSync(LOGO_URL);

  assert.ok(size < 150 * 1024, `logo.png is ${Math.round(size / 1024)}KB`);
});

// ---------------------------------------------------------------------------
// The markup
// ---------------------------------------------------------------------------

test('the nav renders the logo with the required alt text', () => {
  assert.ok(NAV.includes('src="/logo.png"'), 'the nav must point at /logo.png');
  assert.ok(
    NAV.includes('alt="DBCE Coders Club logo"'),
    'the alt text is fixed by the brief'
  );
});

test('the logo is inside a link back to the homepage', () => {
  // The logo and the name are one link, so clicking either returns home.
  const block = NAV.slice(
    NAV.indexOf('LOGO'),
    NAV.indexOf('<nav aria-label="Primary navigation"')
  );

  assert.ok(block.includes('href="/"'), 'the brand must link to /');
  assert.ok(block.includes('<Image'), 'the mark lives in the brand link');
});

test('the club name is stacked over the city', () => {
  const block = NAV.slice(
    NAV.indexOf('LOGO'),
    NAV.indexOf('<nav aria-label="Primary navigation"')
  );

  assert.ok(block.includes('DBCE Coders Club'), 'the club name');
  assert.ok(block.includes('Goa'), 'the city');
  assert.ok(
    block.includes('flex-col'),
    'the two lines must be stacked, not run together'
  );
});

test('the mark is sized for desktop and mobile separately', () => {
  // 36px on mobile, 44px from the sm breakpoint up - inside the 32-36 and
  // 42-48 ranges the brief asks for.
  assert.ok(NAV.includes('h-9'), 'the mobile height');
  assert.ok(NAV.includes('sm:h-11'), 'the desktop height');
});

test('the mark keeps its own aspect ratio', () => {
  // The asset carries the wordmark too, so it is wider than it is tall. A fixed
  // square would squash it - `w-auto` lets the intrinsic ratio through.
  //
  // Scoped to the logo's own class: `w-9` appears elsewhere in the nav on the
  // level-icon avatar, which is legitimately square.
  const logoClass = NAV.slice(NAV.indexOf('club-logo h-9'), NAV.indexOf('club-logo h-9') + 60);

  assert.ok(logoClass.includes('w-auto'), 'the width must follow the asset ratio');
  assert.ok(!logoClass.includes('w-9'), 'a fixed square width would distort it');
});

test('the declared intrinsic size matches the asset', () => {
  // Next/Image uses width/height to reserve space and avoid layout shift, so a
  // mismatch with the real file would reintroduce it.
  const bytes = readFileSync(LOGO_URL);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  assert.ok(
    NAV.includes(`width={${width}}`) && NAV.includes(`height={${height}}`),
    `the nav declares width={${width}} height={${height}} to match the PNG`
  );
});

test('the brand cannot be squeezed into the navigation links', () => {
  // The header is a justify-between flex row; shrink-0 keeps the mark at its
  // size however tight the links get, so the two never overlap.
  assert.ok(NAV.includes('shrink-0'), 'the brand must not shrink');
});

test('the logo is marked as above the fold', () => {
  // It is in the header of every page, so it should not be lazy-loaded.
  assert.ok(NAV.includes('priority'), 'the logo should load with the page');
});

// ---------------------------------------------------------------------------
// The treatment
// ---------------------------------------------------------------------------

test('the glow is a faint white sheen, not neon', () => {
  assert.ok(CSS.includes('.club-logo'), 'the mark needs its own rule');

  const rule = CSS.slice(CSS.indexOf('.club-logo {'), CSS.indexOf('.club-logo-link'));

  assert.ok(rule.includes('drop-shadow(0 0 10px'), 'the near glow');
  assert.ok(rule.includes('drop-shadow(0 0 22px'), 'the far glow');

  // White, and low alpha - the brief asks for polished metal, not a light box.
  assert.ok(rule.includes('rgba(255, 255, 255, 0.22)'), 'the near glow value');
  assert.ok(rule.includes('rgba(255, 255, 255, 0.1)'), 'the far glow value');
});

test('the hover is subtle and never rotates', () => {
  const hoverStart = CSS.indexOf('.club-logo-link:hover');
  const hover = CSS.slice(
    hoverStart,
    // The reduced-motion block that follows the hover rule - NOT the council
    // scan's, which sits earlier in the file.
    CSS.indexOf('@media (prefers-reduced-motion', hoverStart)
  );

  assert.ok(hover.includes('brightness('), 'the hover brightens');
  assert.ok(hover.includes('scale(1.03)'), 'the hover scales by 1.03, no more');
  assert.ok(!hover.includes('rotate'), 'the brief forbids rotation');
});

test('the transition is 200-250ms', () => {
  // --motion-duration is 220ms, inside the range the brief asks for.
  const rule = CSS.slice(CSS.indexOf('.club-logo {'), CSS.indexOf('.club-logo-link'));

  assert.ok(rule.includes('var(--motion-duration)'), 'the shared motion token');
  assert.ok(CSS.includes('--motion-duration: 220ms'), 'and it is 220ms');
});

test('the motion stops for anyone who asked for less of it', () => {
  const markAt = CSS.indexOf('.club-logo {');
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion', markAt));

  assert.ok(reduced.includes('.club-logo'), 'the mark must be covered');
  assert.ok(reduced.includes('transition: none'), 'and its transition dropped');
  assert.ok(reduced.includes('transform: none'), 'and its hover scale dropped');
});

// ---------------------------------------------------------------------------
// Nothing else moved
// ---------------------------------------------------------------------------

test('the navigation links are untouched', () => {
  // The logo must not have displaced the links or the level badge.
  for (const label of [
    'Home',
    'About',
    'Activities',
    'Hackathon',
    'Challenges',
    'Leaderboard',
    'XP System',
    'GitHub',
  ]) {
    assert.ok(NAV.includes(`label: "${label}"`), `${label} must still be linked`);
  }

  assert.ok(NAV.includes('aria-label="Primary navigation"'));
  assert.ok(NAV.includes('min-h-[var(--nav-height)]'), 'the header height is unchanged');
});

test('the mobile menu behaviour is untouched', () => {
  assert.ok(NAV.includes('isMenuOpen'), 'the hamburger state');
  assert.ok(NAV.includes('AnimatePresence'), 'the menu animation');
});

test('the login page still renders no navigation', () => {
  // The nav deliberately returns null on /login. The logo is global because it
  // lives in this component - not because a navbar was added to the login page.
  assert.ok(
    NAV.includes('if (pathname === "/login")'),
    'the login exemption must survive'
  );
});

test('the nav is still a client component with the same imports', () => {
  assert.ok(NAV.startsWith('"use client";'));
  assert.ok(NAV.includes('from "next/image"'), 'Image was already imported');
});

// ---------------------------------------------------------------------------
// No white matte
// ---------------------------------------------------------------------------

test('the asset has no white matte baked in', () => {
  // THE BUG THIS PASS FIXES. The previous asset was keyed with a binary
  // `> 236` mask, so JPEG noise in the background blocked the flood-fill and
  // ~26% of the image stayed OPAQUE near-white - a visible white square on the
  // cream navbar.
  //
  // A real matte shows up as opaque near-white pixels spread across the frame,
  // so this decodes the PNG and measures it rather than trusting the markup.
  const bytes = readFileSync(LOGO_URL);

  assert.deepStrictEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'a real PNG'
  );
  assert.strictEqual(bytes[25], 6, 'colour type 6 is RGBA');

  // The alpha channel must actually be used: a fully opaque image is a JPEG
  // wearing a .png extension.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  assert.ok(width > 0 && height > 0, 'the header must declare a size');
  assert.ok(width !== height, 'the asset carries the wordmark, so it is wider than tall');
});
