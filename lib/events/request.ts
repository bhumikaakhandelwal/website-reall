// Phase 8A: the shared request shapes for the event endpoints.
//
// SERVER-ONLY, and deliberately not in lib/events/events.ts: that module is
// imported by the client component, and importing zod there would pull it into
// the browser bundle. This module is imported only by route handlers.
//
// It exists because creating and editing an event must accept exactly the same
// fields with exactly the same rules. Two copies of this schema would drift -
// create would gain a field, or a bound would be tightened in one and not the
// other - and the difference would only show up as an edit that the form allows
// and the API rejects.

import { z } from 'zod';
import { eventTypeSchema } from '@/lib/db/schema';
import { EVENT_TITLE_MAX, isCalendarDate } from './events';

/**
 * The body of POST /api/events and PATCH /api/events/[id].
 *
 * A strict object: an unknown key is a 400 rather than being silently dropped,
 * so a client sending `xpAmount` learns that neither endpoint accepts one.
 *
 * The event type is the shared enum, so the accepted vocabulary cannot drift
 * from the CHECK constraint on events.event_type. The date is checked for shape
 * and then for being a real calendar day - the regex alone would accept
 * 2026-02-31, which is a date nobody typed.
 */
export const eventBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(EVENT_TITLE_MAX),
  eventType: eventTypeSchema,
  eventDate: z
    .string()
    .trim()
    .refine(isCalendarDate, 'eventDate must be a real calendar date'),
  activityCode: z.string().trim().min(1).max(64),
});

/**
 * A dynamic-route id.
 *
 * Checked before anything reaches the database: comparing a non-uuid against a
 * uuid column raises `invalid input syntax for type uuid`, which would surface
 * as a 500 for what is really just an unknown URL.
 */
export const eventIdSchema = z.string().uuid();
