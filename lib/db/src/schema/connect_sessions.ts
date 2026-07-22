import {
  pgTable,
  varchar,
  timestamp,
  json,
} from "drizzle-orm/pg-core";

/**
 * express-session store table used by connect-pg-simple.
 *
 * connect-pg-simple requires the exact column names `sid`, `sess`, and `expire`
 * (and creates the table itself if `createTableIfMissing: true`). We declare it
 * here so drizzle-kit keeps the schema in sync.
 */
export const connectSessionsTable = pgTable("connect_sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true }).notNull(),
});
