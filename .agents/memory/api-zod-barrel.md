---
name: api-zod barrel (lib/api-zod/src/index.ts)
description: Manually maintained to avoid TS2308 type collisions — must not be overwritten by codegen
---

`lib/api-zod/src/index.ts` selectively re-exports from `./generated/api` (Zod schemas) and individual type files in `./generated/types/` — NOT the barrel `./generated/types/index.ts`.

This prevents TS2308 collision errors when the generated barrel re-exports conflicting Params types.

**Why:** The Orval-generated `./generated/types/index.ts` barrel re-exports types that conflict when re-exported from api-zod. The fix was to import individual type files directly.

**How to apply:** After any codegen rerun (`pnpm --filter @workspace/api-spec run codegen`), restore the manual barrel. Keep a comment in the file explaining this.
