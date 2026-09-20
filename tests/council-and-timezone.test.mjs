// Phase 10A: the Council Showcase and the club timezone.
//
// Two things this file exists to pin:
//
//   * the council list is the OFFICIAL one, complete, and carries no XP - the
//     cards it replaced showed invented totals for three people and called
//     everyone a "Club member".
//   * every displayed date reads in Indian Standard Time, and the leaderboard's
//     month window agrees with the label it is shown under.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EXECUTIVE_COUNCIL,
  councilNumber,
  isSharedRole,
  roleMarker,
  rolePeers,
  rolePosition,
  roleSize,
} from '@/app/content/council';
import {
  CLUB_TIME_ZONE,
  formatIstDate,
  formatIstDateTime,
  formatIstMonth,
  formatIstShortMonth,
  formatIstWeekdayDate,
  istMonthPeriod,
  istToday,
} from '@/lib/dates';

// ---------------------------------------------------------------------------
// The council
// ---------------------------------------------------------------------------

/** The official Executive Council, exactly as the club publishes it. */
const OFFICIAL = [
  ['Rituraj Patil', 'President'],
  ['Basil Shaikh', 'Vice President'],
  ['Aryan Vishwakarma', 'Secretary'],
  ['Angelica Pereira', 'Treasurer'],
  ['Bhumika Khandelwal', 'Internal Affairs'],
  ['Sania Suleman', 'Tech Lead'],
  ['Akhil Nair', 'Tech Lead'],
  ['Aliya Saldhana', 'Events'],
  ['Adhish Sawant Dessai', 'PR & Outreach'],
  ['Vedant Chodankar', 'PR & Outreach'],
  ['Priya Honkalase', 'PR & Outreach'],
];

test('the council is the official list, in order', () => {
  assert.deepStrictEqual(
    EXECUTIVE_COUNCIL.map((member) => [member.name, member.title]),
    OFFICIAL
  );
});

test('all eleven council members are shown', () => {
  assert.strictEqual(EXECUTIVE_COUNCIL.length, 11);
});

test('the President is first, because the first card is the featured one', () => {
  assert.strictEqual(EXECUTIVE_COUNCIL[0].name, 'Rituraj Patil');
  assert.strictEqual(EXECUTIVE_COUNCIL[0].title, 'President');
});

test('every member has a name and an official title', () => {
  for (const member of EXECUTIVE_COUNCIL) {
    assert.ok(member.name.trim().length > 0, 'every member needs a name');
    assert.ok(member.title.trim().length > 0, `${member.name} needs a title`);
  }
});

test('the titles are the Handbook ones', () => {
  const handbookTitles = new Set([
    'President',
    'Vice President',
    'Secretary',
    'Treasurer',
    'Internal Affairs',
    'Tech Lead',
    'Events',
    'PR & Outreach',
  ]);

  for (const member of EXECUTIVE_COUNCIL) {
    assert.ok(
      handbookTitles.has(member.title),
      `${member.title} is not a Handbook council title`
    );
  }
});

test('no member is listed twice', () => {
  const names = EXECUTIVE_COUNCIL.map((member) => member.name);

  assert.strictEqual(new Set(names).size, names.length);
});

test('the corner numbering reads #1, #2, ... and is not a rank', () => {
  assert.strictEqual(councilNumber(0), '#1');
  assert.strictEqual(councilNumber(1), '#2');
  assert.strictEqual(councilNumber(9), '#10');
  assert.strictEqual(councilNumber(10), '#11');

  // Sequential across the whole council, with no gaps and no repeats - so the
  // counter is a counter, and the President's #1 is the council's own ordering.
  const labels = EXECUTIVE_COUNCIL.map((_, index) => councilNumber(index));

  assert.deepStrictEqual(labels, [
    '#1', '#2', '#3', '#4', '#5', '#6',
    '#7', '#8', '#9', '#10', '#11',
  ]);
});

// ---------------------------------------------------------------------------
// The homepage section
// ---------------------------------------------------------------------------

const HOME_SOURCE = readFileSync(
  new URL('../app/page.tsx', import.meta.url),
  'utf8'
);

test('the homepage renders the council and no XP strip', () => {
  assert.ok(HOME_SOURCE.includes('EXECUTIVE_COUNCIL.map'), 'the council must be rendered');

  // The three-card XP strip is gone, along with its invented totals.
  assert.ok(!HOME_SOURCE.includes('xp-cards'), 'the XP strip must be replaced');
  assert.ok(!HOME_SOURCE.includes('Club member'), 'the "Club member" label must be gone');
  assert.ok(!HOME_SOURCE.includes('7,500 XP'), 'the placeholder totals must be gone');
  assert.ok(!HOME_SOURCE.includes('GAMIFIED LEARNING'), 'the old micro-label must be gone');
});

test('the section keeps its heading and its micro-label', () => {
  assert.ok(HOME_SOURCE.includes('EXECUTIVE COUNCIL'), 'the new micro-label');

  // "Earn your place." is unchanged, split across lines exactly as before.
  assert.ok(HOME_SOURCE.includes('Earn your'));
  assert.ok(HOME_SOURCE.includes('place.</span>'));
});

test('the cards collapse 3 / 2 / 1', () => {
  assert.ok(
    HOME_SOURCE.includes('grid-cols-1') &&
      HOME_SOURCE.includes('sm:grid-cols-2') &&
      HOME_SOURCE.includes('lg:grid-cols-3'),
    'the council grid must be 1 column, then 2, then 3'
  );
});

test('the first card is lime and the rest are charcoal', () => {
  assert.ok(HOME_SOURCE.includes('bg-lime'), 'the featured card must be lime');
  assert.ok(HOME_SOURCE.includes('bg-gradient-to-b'), 'the rest must be a charcoal gradient');
  assert.ok(HOME_SOURCE.includes('border-accent'), 'the orange accent must survive');
});

test('the scan line is decorative and respects reduced motion', () => {
  assert.ok(HOME_SOURCE.includes('council-scan'));
  assert.ok(HOME_SOURCE.includes('aria-hidden="true"'), 'the scan is decorative');

  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.ok(css.includes('@keyframes council-scan'), 'the keyframe must exist');
  assert.ok(
    css.includes('prefers-reduced-motion'),
    'the scan must stop for anyone who asked for less motion'
  );
});

// ---------------------------------------------------------------------------
// The club timezone
// ---------------------------------------------------------------------------

test('the club timezone is Asia/Kolkata', () => {
  assert.strictEqual(CLUB_TIME_ZONE, 'Asia/Kolkata');
});

test('a date renders as an Indian date', () => {
  // en-IN puts the day first, which is the order the club reads.
  assert.strictEqual(formatIstDate('2026-09-18T06:00:00Z'), '18 Sept 2026');
  assert.strictEqual(formatIstWeekdayDate('2026-09-18T06:00:00Z'), 'Fri, 18 Sept, 2026');
});

test('a timestamp renders on the Indian clock', () => {
  // 22:13 UTC is 03:43 the next morning in IST. Reading the UTC clock here is
  // exactly the bug this phase removes.
  assert.strictEqual(
    formatIstDateTime('2026-09-17T22:13:00Z'),
    '18 Sept 2026, 03:43'
  );
});

test('IST midnight is 00:00, not 24:00', () => {
  // The ICU quirk with hour12: false, at the instant that would trip it.
  assert.strictEqual(
    formatIstDateTime('2026-08-31T18:30:00Z'),
    '01 Sept 2026, 00:00'
  );
});

test('a month renders as a month and a year', () => {
  assert.strictEqual(formatIstMonth('2026-09-01T00:00:00Z'), 'September 2026');
  assert.strictEqual(formatIstShortMonth('2026-09-01T00:00:00Z'), 'Sept 2026');
});

test('an unparseable value is returned unchanged, not as "Invalid Date"', () => {
  assert.strictEqual(formatIstDate('nonsense'), 'nonsense');
  assert.strictEqual(formatIstDateTime('nonsense'), 'nonsense');
  assert.strictEqual(formatIstMonth('nonsense'), 'nonsense');
});

test('the formatters do not move with the visitor timezone', () => {
  // The pin is the point: a member in London and a member in Goa must read the
  // same date for the same session. These are pure Intl calls with an explicit
  // timeZone, so this asserts the pin is actually there.
  const source = readFileSync(new URL('../lib/dates.ts', import.meta.url), 'utf8');

  assert.ok(
    source.includes('timeZone: CLUB_TIME_ZONE'),
    'every formatter must pin the zone explicitly'
  );
  assert.ok(
    !source.includes('toLocaleDateString'),
    'formatting must go through Intl.DateTimeFormat, not the host locale'
  );
});

// ---------------------------------------------------------------------------
// The leaderboard month
// ---------------------------------------------------------------------------

test('today in IST rolls over at IST midnight, not UTC midnight', () => {
  // 19:00 UTC on the 20th is 00:30 IST on the 21st.
  assert.strictEqual(istToday(new Date('2026-09-20T19:00:00Z')), '2026-09-21');

  // 18:00 UTC on the 20th is still 23:30 IST on the 20th.
  assert.strictEqual(istToday(new Date('2026-09-20T18:00:00Z')), '2026-09-20');
});

test('the month window is the Indian month, expressed in UTC instants', () => {
  const period = istMonthPeriod(new Date('2026-09-18T02:46:28Z'));

  // 1 September 00:00 IST is 31 August 18:30 UTC.
  assert.strictEqual(period.start.toISOString(), '2026-08-31T18:30:00.000Z');

  // The end is the first instant of October IST, exclusive.
  assert.strictEqual(period.end.toISOString(), '2026-09-30T18:30:00.000Z');
});

test('the window and the label agree at a month boundary', () => {
  // THE BUG THIS PHASE FIXES. 23:30 UTC on 30 September is 05:00 IST on
  // 1 October, so the club's month is October - and the window must be
  // October's too, or the label would sit above August and September's entries.
  const period = istMonthPeriod(new Date('2026-09-30T23:30:00Z'));

  assert.strictEqual(period.start.toISOString(), '2026-09-30T18:30:00.000Z');
  assert.strictEqual(period.end.toISOString(), '2026-10-31T18:30:00.000Z');

  assert.strictEqual(formatIstMonth(period.start), 'October 2026');
});

test('the window is exactly one month long, half-open', () => {
  for (const instant of [
    '2026-01-15T00:00:00Z',
    '2026-02-15T00:00:00Z',
    '2026-12-31T23:59:59Z',
    '2028-02-29T12:00:00Z',
  ]) {
    const { start, end } = istMonthPeriod(new Date(instant));

    assert.ok(end > start, instant);

    // The start is an IST midnight: shifting it into IST lands on the 1st at 00:00.
    const asIst = new Date(start.getTime() + 330 * 60 * 1000);

    assert.strictEqual(asIst.getUTCDate(), 1, instant);
    assert.strictEqual(asIst.getUTCHours(), 0, instant);
    assert.strictEqual(asIst.getUTCMinutes(), 0, instant);
  }
});

test('the window contains the instant it was computed from', () => {
  for (const instant of [
    '2026-09-18T02:46:28Z',
    '2026-09-30T23:30:00Z',
    '2026-10-01T00:00:00Z',
  ]) {
    const now = new Date(instant);
    const { start, end } = istMonthPeriod(now);

    assert.ok(start <= now && now < end, instant);
  }
});

test('the leaderboard no longer exports utcMonthPeriod', async () => {
  // The name would be a lie now. A stale import would be a compile error, so
  // this pins the rename for anyone reading the test suite for the contract.
  const leaderboards = await import('@/lib/xp/leaderboards');

  assert.strictEqual(typeof leaderboards.istMonthPeriod, 'function');
  assert.strictEqual(leaderboards.utcMonthPeriod, undefined);
});

// ---------------------------------------------------------------------------
// Shared roles: the Tech Lead pair and the PR & Outreach trio
// ---------------------------------------------------------------------------
//
// The council has two titles held by more than one person. They are not
// duplicates - a co-lead pair and an outreach team are how the club is
// organised - so the showcase marks them as groups. These tests pin both the
// grouping rule and the fact that each group is an unbroken run.

test('the Tech Lead pair is Sania Suleman and Akhil Nair, consecutively', () => {
  const peers = rolePeers('Tech Lead');

  assert.deepStrictEqual(
    peers.map((member) => member.name),
    ['Sania Suleman', 'Akhil Nair']
  );

  const indices = peers.map((peer) =>
    EXECUTIVE_COUNCIL.findIndex((member) => member.name === peer.name)
  );

  // Consecutive in the array, so they render as an unbroken run wherever the
  // grid happens to break.
  assert.strictEqual(indices[1] - indices[0], 1);
});

test('the PR & Outreach trio is Adhish, Vedant and Priya, consecutively', () => {
  const peers = rolePeers('PR & Outreach');

  assert.deepStrictEqual(
    peers.map((member) => member.name),
    ['Adhish Sawant Dessai', 'Vedant Chodankar', 'Priya Honkalase']
  );

  const indices = peers.map((peer) =>
    EXECUTIVE_COUNCIL.findIndex((member) => member.name === peer.name)
  );

  assert.strictEqual(indices[1] - indices[0], 1);
  assert.strictEqual(indices[2] - indices[1], 1);
});

test('the two groups are the only shared roles on the council', () => {
  // Every other title is held by exactly one person, so it must NOT get a
  // group marker. If a third role were duplicated this test would fail and the
  // showcase would need a decision, not a silent grouping.
  const shared = [
    ...new Set(EXECUTIVE_COUNCIL.map((member) => member.title)),
  ].filter(isSharedRole);

  assert.deepStrictEqual(shared.sort(), ['PR & Outreach', 'Tech Lead']);
});

test('the co-leads get two glyphs and the trio gets three', () => {
  // One glyph per holder, so the card says HOW MANY people share the role.
  assert.strictEqual(roleMarker('Tech Lead'), '◈◈');
  assert.strictEqual(roleMarker('PR & Outreach'), '◈◈◈');
});

test('a solo role gets no marker at all', () => {
  for (const title of [
    'President',
    'Vice President',
    'Secretary',
    'Treasurer',
    'Internal Affairs',
    'Events',
  ]) {
    assert.strictEqual(isSharedRole(title), false, title);
    assert.strictEqual(roleMarker(title), null, title);
  }
});

test('an unknown title is not a shared role', () => {
  assert.strictEqual(isSharedRole('Chief Vibes Officer'), false);
  assert.strictEqual(roleMarker('Chief Vibes Officer'), null);
  assert.strictEqual(roleSize('Chief Vibes Officer'), 0);
});

test('the President is not grouped, so the featured card stays unmarked', () => {
  assert.strictEqual(roleMarker(EXECUTIVE_COUNCIL[0].title), null);
});

test('rolePosition numbers each holder within their group', () => {
  // 1-based, because this is what the screen-reader sentence says: "Shared
  // role, 1 of 2."
  const byName = (name) =>
    EXECUTIVE_COUNCIL.find((member) => member.name === name);

  assert.strictEqual(rolePosition(byName('Sania Suleman')), 1);
  assert.strictEqual(rolePosition(byName('Akhil Nair')), 2);

  assert.strictEqual(rolePosition(byName('Adhish Sawant Dessai')), 1);
  assert.strictEqual(rolePosition(byName('Vedant Chodankar')), 2);
  assert.strictEqual(rolePosition(byName('Priya Honkalase')), 3);

  // A solo role has no position in a group.
  assert.strictEqual(rolePosition(byName('Rituraj Patil')), null);
});

test('every holder of a shared role renders the same marker', () => {
  // The point of the accent: the pair must not look like two different roles.
  for (const title of ['Tech Lead', 'PR & Outreach']) {
    const markers = new Set(rolePeers(title).map(() => roleMarker(title)));

    assert.strictEqual(markers.size, 1, title);
    assert.ok(!markers.has(null), `${title} must carry a marker`);
  }
});

test('the homepage gives a shared role the permanent orange rule', () => {
  // The accent has to be in the markup, not only in the data: a group whose
  // cards carry no shared treatment is just a repeated title.
  assert.ok(HOME_SOURCE.includes('isSharedRole(member.title)'));
  assert.ok(HOME_SOURCE.includes('roleMarker(member.title)'));
  assert.ok(
    HOME_SOURCE.includes('border-accent/35'),
    'shared roles must light the top rule permanently, not only on hover'
  );
});

test('the marker is hidden from screen readers and described instead', () => {
  // A row of diamonds means nothing read aloud, so the card says the same thing
  // in words: "Shared role, 1 of 2."
  assert.ok(HOME_SOURCE.includes('aria-hidden="true"'), 'the glyph is decorative');
  assert.ok(
    HOME_SOURCE.includes('Shared role,'),
    'a screen reader must get the meaning in words'
  );
  assert.ok(HOME_SOURCE.includes('rolePosition(member)'));
});

test('the two groups keep their cards separate', () => {
  // The brief is explicit: pair them visually, never merge them. Five distinct
  // entries must survive, one per holder.
  for (const title of ['Tech Lead', 'PR & Outreach']) {
    for (const peer of rolePeers(title)) {
      assert.ok(
        EXECUTIVE_COUNCIL.includes(peer),
        `${peer.name} must remain its own council entry`
      );
    }
  }

  assert.strictEqual(rolePeers('Tech Lead').length, 2);
  assert.strictEqual(rolePeers('PR & Outreach').length, 3);
});

// ---------------------------------------------------------------------------
// The final polish pass
// ---------------------------------------------------------------------------

test('the featured card uses the CLUB lime, not Tailwind default lime', () => {
  // `bg-lime` is not a utility in this project: the Tailwind theme defines
  // `--color-accent` and `--color-foreground` but no `--color-lime`, so the
  // class compiles to nothing. The card then fell back to the dark panel behind
  // it, which is why the President's dark name was unreadable on a dark ground.
  assert.ok(
    HOME_SOURCE.includes('bg-[var(--lime)]'),
    'the featured card must use the club lime token'
  );
  assert.ok(
    !HOME_SOURCE.includes('bg-lime '),
    'bg-lime compiles to nothing and must not come back'
  );
});

test('the featured card text is dark, and the rest stay white-on-charcoal', () => {
  // Dark on lime is the readable pairing; white on charcoal is the rest.
  assert.ok(HOME_SOURCE.includes('text-foreground'), 'the featured text is dark');
  assert.ok(HOME_SOURCE.includes('text-white'), 'the charcoal cards stay white');

  // The number and the title on the featured card are dark too, not orange on
  // lime.
  assert.ok(HOME_SOURCE.includes('text-foreground/60'));
  assert.ok(HOME_SOURCE.includes('text-foreground/70'));
});

test('the President card is taller than the rest', () => {
  // ~15% up from the 200px base, and still one grid column.
  assert.ok(HOME_SOURCE.includes('min-h-[230px]'), 'the featured height');
  assert.ok(HOME_SOURCE.includes('min-h-[200px]'), 'the standard height');
  assert.ok(
    !HOME_SOURCE.includes('lg:col-span-2'),
    'the President must not span two columns'
  );
});

test('the President card carries its badge', () => {
  assert.ok(HOME_SOURCE.includes('President'), 'the badge text');

  // Orange micro-label styling, and it only renders on the featured card.
  assert.ok(
    HOME_SOURCE.includes('text-accent-text'),
    'the badge uses the orange micro-label colour'
  );
  assert.ok(
    HOME_SOURCE.includes('{featured && ('),
    'the badge must be conditional on the featured card'
  );
});

test('the shared-role glow is faint, permanent and identical across a group', () => {
  // One glow value, applied to every shared-role card - so the co-leads match
  // each other and the outreach trio matches itself.
  const glow = 'shadow-[0_0_30px_-16px_rgba(232,92,61,0.6)]';

  assert.ok(HOME_SOURCE.includes(glow), 'the shared glow');

  // It is on the `shared` branch, which is driven by the title, so every holder
  // of a shared role gets the same treatment by construction.
  const sharedBranch = HOME_SOURCE.slice(
    HOME_SOURCE.indexOf(': shared'),
    HOME_SOURCE.indexOf(': "border-transparent')
  );

  assert.ok(sharedBranch.includes(glow), 'the glow belongs to the shared branch');
  assert.ok(
    sharedBranch.includes('border-accent/35'),
    'the permanent orange top rule survives'
  );
});

test('the polish draws no connecting lines between grouped cards', () => {
  // The brief is explicit: a shared glow, never a drawn connector. Scoped to
  // the council section, because the page's "Four paths" block uses its own
  // border-r dividers that have nothing to do with the council.
  const council = HOME_SOURCE.slice(
    HOME_SOURCE.indexOf('Phase 10A: the Council Showcase'),
    HOME_SOURCE.indexOf('council-scan')
  );

  assert.ok(council.length > 0, 'the council section must be findable');

  for (const forbidden of ['border-l-', 'border-r-', 'border-x-', 'divide-', 'connector']) {
    assert.ok(
      !council.includes(forbidden),
      `${forbidden} would draw a connection between the cards`
    );
  }
});

test('accessibility survives the polish', () => {
  // The glyphs stay decorative and the screen-reader sentence stays.
  assert.ok(HOME_SOURCE.includes('aria-hidden="true"'));
  assert.ok(HOME_SOURCE.includes('Shared role,'));
  assert.ok(HOME_SOURCE.includes('rolePosition(member)'));
  assert.ok(HOME_SOURCE.includes('roleSize(member.title)'));
});

test('the responsive grid is unchanged', () => {
  assert.ok(
    HOME_SOURCE.includes('grid-cols-1') &&
      HOME_SOURCE.includes('sm:grid-cols-2') &&
      HOME_SOURCE.includes('lg:grid-cols-3'),
    'the grid must stay 1 / 2 / 3 columns'
  );
});

test('the ordering is untouched', () => {
  // The polish must not have reshuffled the council.
  assert.deepStrictEqual(
    EXECUTIVE_COUNCIL.map((member) => member.name),
    OFFICIAL.map(([name]) => name)
  );
});

test('the scan line and the IST changes survive', () => {
  assert.ok(HOME_SOURCE.includes('council-scan'), 'the scanning line');

  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

  assert.ok(css.includes('@keyframes council-scan'));
  assert.strictEqual(CLUB_TIME_ZONE, 'Asia/Kolkata');
});
