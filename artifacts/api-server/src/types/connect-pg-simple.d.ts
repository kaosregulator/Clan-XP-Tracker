// connect-pg-simple ships no type declarations and has no @types package.
// This minimal ambient declaration covers the surface we use: calling the
// factory with the express-session module and constructing a Store.
declare module "connect-pg-simple" {
  import type { Store } from "express-session";

  interface PgStoreOptions {
    pool?: unknown;
    pgPromise?: unknown;
    conString?: string;
    conObject?: Record<string, unknown>;
    schemaName?: string;
    tableName?: string;
    createTableIfMissing?: boolean;
    ttl?: number;
    disableTouch?: boolean;
    pruneSessionInterval?: number | false;
    errorLog?: (...args: unknown[]) => void;
    [key: string]: unknown;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function connectPgSimple(session: any): new (options?: PgStoreOptions) => Store;

  export = connectPgSimple;
}
