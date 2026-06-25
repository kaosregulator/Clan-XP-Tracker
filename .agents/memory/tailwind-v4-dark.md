---
name: Tailwind v4 dark mode
description: How to force dark mode in Tailwind v4 — @apply dark is invalid
---

In Tailwind v4, `dark` is a custom variant, not a utility class.
`@apply dark;` inside CSS will throw: "Cannot apply unknown utility class `dark`".

**Fix:** Add `class="dark"` directly to the `<html>` element in `index.html`.
Also set `color-scheme: dark` in `:root` for the browser color scheme hint.

**Why:** Discovered when the Vite dev server threw a build error after using `html { @apply dark; }` in index.css.

**How to apply:** Any time a project needs forced dark mode in Tailwind v4, use the HTML attribute approach, not @apply.
