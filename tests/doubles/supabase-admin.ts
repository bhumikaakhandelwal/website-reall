// Test double for `@/lib/supabase/admin` - the SERVER-ONLY service-role client.
//
// Unlike the other doubles this one is not a fixed module: it is a stubbable
// factory. Tests that exercise the real `lib/db/queries.ts` (rather than the
// `@/lib/db/queries` double) point `rpcResult` at whatever shape they want
// supabase-js to have resolved, then assert on the mapping. `rpcCalls` records
// every call so a test can pin the arguments the query layer sends.
//
// Nothing here runs in the application; it is test-only scaffolding. The real
// module's rules (service-role key never reaches the browser) are unaffected -
// this replaces it only inside `npm test`.

/** What the next `.rpc()` resolves to. Shaped like a supabase-js response. */
export const adminState = {
  rpcResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },

  /** Every `{ fnName, args }` handed to `.rpc()`, in order. */
  rpcCalls: [] as { fnName: string; args: unknown }[],

  /** Every row handed to `.from(...).insert(...)`, in order. */
  inserts: [] as unknown[],

  /** What a `.insert()` should resolve to. */
  insertResult: { error: null } as {
    error: { code?: string; message: string } | null;
  },
};

export function resetAdminState() {
  adminState.rpcResult = { data: null, error: null };
  adminState.rpcCalls = [];
  adminState.inserts = [];
  adminState.insertResult = { error: null };
}

export function createAdminClient() {
  return {
    async rpc(fnName: string, args?: unknown) {
      adminState.rpcCalls.push({ fnName, args });
      return adminState.rpcResult;
    },

    from(table: string) {
      return {
        async insert(row: unknown) {
          adminState.inserts.push({ table, row });
          return adminState.insertResult;
        },
      };
    },
  } as never;
}
