// Phase 10A: the DBCE Coders Club Executive Council.
//
// THE OFFICIAL LIST, in the order the club publishes it - the President first,
// then the rest of the council. This is a content module, not a database table:
// a council is a handful of names that changes once a year, and the Handbook
// (section 10) is where the titles come from.
//
// The titles match the Handbook's governance list exactly: President, Vice
// President, Secretary, Treasurer, Internal Affairs, Technical Lead, Events &
// Logistics, PR & Outreach.
//
// THERE IS NO RANKING HERE BEYOND THE PRESIDENT BEING FIRST. The council is not
// a leaderboard, and the numbering on the cards is a decorative counter, not a
// position. No XP appears anywhere near it - council office is service, not
// points.

export type CouncilMember = {
  name: string;
  /** The official title, exactly as the Handbook writes it. */
  title: string;
};

/**
 * The Executive Council.
 *
 * The first entry is the featured card on the homepage; the rest are the
 * charcoal cards. Ordering the array this way means the featured slot follows
 * from the data rather than being a special case in the markup.
 */
export const EXECUTIVE_COUNCIL: readonly CouncilMember[] = [
  { name: 'Rituraj Patil', title: 'President' },
  { name: 'Basil Shaikh', title: 'Vice President' },
  { name: 'Aryan Vishwakarma', title: 'Secretary' },
  { name: 'Angelica Pereira', title: 'Treasurer' },
  { name: 'Bhumika Khandelwal', title: 'Internal Affairs' },
  { name: 'Sania Suleman', title: 'Tech Lead' },
  { name: 'Akhil Nair', title: 'Tech Lead' },
  { name: 'Aliya Saldhana', title: 'Events' },
  { name: 'Adhish Sawant Dessai', title: 'PR & Outreach' },
  { name: 'Vedant Chodankar', title: 'PR & Outreach' },
  { name: 'Priya Honkalase', title: 'PR & Outreach' },
];

/**
 * The counter shown in each card's corner, e.g. "#1".
 *
 * Phase 10A final polish: this was a zero-padded "01", which read like a
 * catalogue entry. A hash reads as a label on a member, and it stays a counter -
 * not a rank. The President being #1 is the council's own ordering, not a
 * standing.
 */
export function councilNumber(index: number): string {
  return `#${index + 1}`;
}

// ---------------------------------------------------------------------------
// Shared roles
//
// Two titles on this council are held by more than one person: Tech Lead by
// two, PR & Outreach by three. They are not duplicates - a co-lead pair and an
// outreach team are how the club is actually organised - so the showcase marks
// them as groups rather than leaving the reader to wonder why a title repeats.
//
// The grouping is DERIVED FROM THE TITLE, never from a hardcoded list of names.
// A role held by one person gets no marker; a role held by several gets the same
// marker on every holder. Adding a second Events lead would group them
// automatically, and renaming a title cannot leave a stale group behind.
// ---------------------------------------------------------------------------

/** Everyone who holds a given title, in council order. */
export function rolePeers(title: string): CouncilMember[] {
  return EXECUTIVE_COUNCIL.filter((member) => member.title === title);
}

/** How many council members hold this title. */
export function roleSize(title: string): number {
  return rolePeers(title).length;
}

/** True when more than one member holds this title. */
export function isSharedRole(title: string): boolean {
  return roleSize(title) > 1;
}

/**
 * The shared marker for a role, or null when the role is held by one person.
 *
 * One glyph per holder - "◈◈" for the co-leads, "◈◈◈" for the outreach team -
 * so the card says how many people share the role, not merely that it is
 * shared. `◈` is the glyph the homepage already uses on its "Learn" pillar.
 */
export function roleMarker(title: string): string | null {
  const size = roleSize(title);

  return size > 1 ? '◈'.repeat(size) : null;
}

/**
 * Where a member sits within their shared role, 1-based, or null when the role
 * is theirs alone.
 *
 * A number rather than 'first'/'last', because the only thing that reads it is
 * the sentence a screen reader gets in place of the diamonds: "Shared role,
 * 1 of 2."
 */
export function rolePosition(member: CouncilMember): number | null {
  const peers = rolePeers(member.title);

  if (peers.length < 2) return null;

  const index = peers.findIndex((peer) => peer.name === member.name);

  return index === -1 ? null : index + 1;
}
