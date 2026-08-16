---
name: Publish schema sync
description: Non-obvious database schema sequence for production releases
---

The compiled database declarations and production deployment can be ahead of the actual databases. A successful TypeScript build does not mean the development database has the new columns or tables.

**Why:** A release can start the Discord bot successfully while every command that reads the changed table fails with a missing-column error. Replit applies the development-to-production schema diff during Publish, but only if the development database already has the schema.

**How to apply:** After a PR adds or changes Drizzle schema, run the normal development DB push, verify the expected development columns/tables, and inspect the publish diff before publishing. Accept only the expected non-destructive schema changes; never apply DDL directly to production or add startup-time schema mutation.