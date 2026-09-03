---
name: External runtime dependencies
description: Runtime dependency rule for bundled API artifacts
---

When an API build marks a package as external, the package must be declared directly in the API artifact's runtime dependencies, even if another package already brings it into the workspace lockfile.

**Why:** Production runs the artifact with package isolation; a transitive lockfile entry can exist while Node still cannot resolve the external module at runtime.

**How to apply:** For every externalized import in a production bundle, verify the owning artifact can import the package directly after a frozen install before publishing.