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

  /**
   * Phase 7A: what a `.from(...).select(...)` chain should resolve to. Shaped
   * like a supabase-js response, so a test can point it at a bare array of rows
   * (what PostgREST returns for a table select) or at anything else it wants
   * the layer under test to reject.
   */
  selectResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },

  /**
   * Phase 7B: what a `.select(...).eq(...).maybeSingle()` should resolve to -
   * one row object, or null, rather than an array.
   */
  singleResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },

  /** Every select chain, recording the table, columns, filters and orderings. */
  selectCalls: [] as {
    table: string;
    columns: string;
    eqs: { column: string; value: unknown }[];
    orders: { column: string; ascending: boolean }[];
  }[],

  /**
   * Phase 8A: what an `.update(...).eq(...).is(...).select(...)` chain should
   * resolve to - the rows the update affected, which is how the query layer
   * tells "updated" from "matched nothing".
   */
  updateResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },

  /** Every update chain, recording the patch and the filters it carried. */
  updateCalls: [] as {
    table: string;
    patch: Record<string, unknown>;
    eqs: { column: string; value: unknown }[];
    isNull: { column: string; value: unknown }[];
    selectedColumns: string | null;
  }[],
};

export function resetAdminState() {
  adminState.rpcResult = { data: null, error: null };
  adminState.rpcCalls = [];
  adminState.inserts = [];
  adminState.insertResult = { error: null };
  adminState.selectResult = { data: null, error: null };
  adminState.singleResult = { data: null, error: null };
  adminState.selectCalls = [];
  adminState.updateResult = { data: null, error: null };
  adminState.updateCalls = [];
}

/**
 * A thenable `.select()` chain.
 *
 * `await`ing the builder resolves `selectResult`, and every `.order()` and
 * `.eq()` is recorded rather than applied - the point is to assert on what the
 * query layer ASKED the database for (filtering and ordering are the database's
 * job everywhere in this project), not to reimplement PostgREST.
 */
function selectChain(table: string, columns: string) {
  const call = {
    table,
    columns,
    eqs: [] as { column: string; value: unknown }[],
    orders: [] as { column: string; ascending: boolean }[],
  };

  adminState.selectCalls.push(call);

  const chain = {
    order(column: string, options?: { ascending?: boolean }) {
      call.orders.push({ column, ascending: options?.ascending ?? true });
      return chain;
    },
    eq(column: string, value: unknown) {
      call.eqs.push({ column, value });
      return chain;
    },
    maybeSingle() {
      return Promise.resolve(adminState.singleResult);
    },
    then(
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(adminState.selectResult).then(resolve, reject);
    },
  };

  return chain;
}

/**
 * A thenable `.update()` chain.
 *
 * Records the patch and every filter, and resolves `updateResult` - the rows
 * the update affected. That result is the point: the query layer uses
 * `.select()` to distinguish "the row was updated" from "no row matched the
 * guard", which is how the archived read-only rule is enforced in the statement
 * rather than only in the route.
 */
function updateChain(table: string, patch: Record<string, unknown>) {
  const call = {
    table,
    patch,
    eqs: [] as { column: string; value: unknown }[],
    isNull: [] as { column: string; value: unknown }[],
    selectedColumns: null as string | null,
  };

  adminState.updateCalls.push(call);

  const chain = {
    eq(column: string, value: unknown) {
      call.eqs.push({ column, value });
      return chain;
    },
    is(column: string, value: unknown) {
      call.isNull.push({ column, value });
      return chain;
    },
    select(columns: string) {
      call.selectedColumns = columns;
      return chain;
    },
    then(
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(adminState.updateResult).then(resolve, reject);
    },
  };

  return chain;
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

        select(columns: string) {
          return selectChain(table, columns);
        },

        update(patch: Record<string, unknown>) {
          return updateChain(table, patch);
        },
      };
    },
  } as never;
}
