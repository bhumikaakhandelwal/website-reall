// Phase 8C: the XP ledger explorer.
//
//   GET /api/manager/ledger
//
// Manager-only, via lib/auth/require-manager.ts - the same two checks as every
// other manager tool: a verified session (401) and an XP manager (403).
//
// READ-ONLY. This route issues four reads and no writes, and there is no write
// path reachable from it. The ledger is the club's audit trail; the explorer
// exists to read it.
//
// FOUR READS, one response - and three of them are existing queries rather than
// new ones:
//
//   getXpLedgerEntries()        every ledger row, newest first   (new)
//   getMemberDirectory()        memberId -> name and email        (REUSED)
//   getXpLedgerEventLinks()     ledgerId -> eventId              (new)
//   getEvents()                 eventId -> title                 (REUSED)
//
// The two new reads are plain narrow table reads, which is why this phase needs
// no migration: nothing here aggregates, and nothing needs to happen in one
// transaction. The joins that turn those four reads into the explorer's rows
// happen in lib/manager/ledger.ts, a plain module the tests can reach - a SQL
// view would have been untestable here.
//
// Reusing the member directory and the event list rather than adding a third
// definition of either is what stops the ledger disagreeing with /members about
// what a member is called, or with /events about what an event is called.
//
// The activity code is NOT validated here, and the response is NOT filtered by
// activity. Filtering happens in the browser over the whole ledger, which is the
// same choice the member directory makes and for the same reason: the ledger is
// a few hundred rows, and a server round trip per keystroke would buy nothing.

import { NextResponse } from 'next/server';
import {
  getEvents,
  getMemberDirectory,
  getXpLedgerEntries,
  getXpLedgerEventLinks,
} from '@/lib/db/queries';
import { requireXpManager } from '@/lib/auth/require-manager';
import { enrichLedgerEntries } from '@/lib/manager/ledger';

export async function GET() {
  try {
    const auth = await requireXpManager();

    if (!auth.ok) return auth.response;

    const [entries, members, links, events] = await Promise.all([
      getXpLedgerEntries(),
      getMemberDirectory(),
      getXpLedgerEventLinks(),
      getEvents(),
    ]);

    // null means the read failed. An empty ledger is [], so it is not mistaken
    // for an error - and an error is not mistaken for a club that has never
    // recorded any XP, which is what an empty explorer would say.
    if (!entries || !members || !links || !events) {
      console.error(
        'Error in GET /api/manager/ledger: ledger, roster, event link or event data unavailable'
      );
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      entries: enrichLedgerEntries(entries, members, links, events),
    });
  } catch (error) {
    console.error('Error in GET /api/manager/ledger:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
