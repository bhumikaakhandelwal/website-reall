// SERVER-ONLY privileged Supabase client.
//
// This uses the service-role key, which bypasses Row Level Security. It exists
// for exactly two operations, both of which RLS deliberately blocks for the
// anon key the rest of the app uses:
//
//   1. writing xp_ledger rows (RLS grants members no INSERT),
//   2. reading one member's XP total through get_member_xp_total, which is
//      granted to service_role alone because it accepts an arbitrary member id
//      and must not be callable by any browser-facing role.
//
// HARD RULES
//   * Never import this into a client component, and never let the key reach
//     the browser. The variable is NOT prefixed NEXT_PUBLIC_ on purpose.
//   * Bypassing RLS does not bypass authorization. Every caller must first
//     verify the signed session and - for writes - confirm the actor is an XP
//     manager (lib/xp/managers.ts), and must pass a member id that came from
//     that session rather than from the request. Never call this before those
//     checks have passed.
//   * Do not build other queries with this client just because it is
//     convenient. Everything else reads through the anon-key helpers and the
//     client-readable SECURITY DEFINER functions in lib/db/queries.ts.
//
// The client is created lazily so that importing this module never throws at
// build time when the variable is absent.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set to write XP'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
