---
description: The styling stack: shadcn base-nova on Base UI (not Radix) as vendored, lint-exempt components, Tailwind v4 oklch tokens, dark mode by a .dark class applied before first paint, and #web/ imports
---

`components.json` uses shadcn style `base-nova`; the primitives under
`components/ui/` come from `@base-ui/react`, not Radix, and are vendored
copies exempt from lint (a `biome.json` override), as are
`components/assistant-ui/` (the chat thread is built on assistant-ui) and
`hooks/`. `shadcn.css` is a vendored excerpt, so the shadcn CLI package is
not installed. Theme tokens are oklch CSS variables in `styles.css`; dark
mode is the `.dark` class on `<html>` (`@custom-variant dark`), which
`followAppearance` in `appearance.ts` toggles from the `appearance.theme`
setting or the device, also setting `data-accent` for the accent palettes
and the `theme-color` meta, and an inline script in `index.html` applies it
before first paint. Shared modules are imported as `#web/...` with the
extension (`#web/components/ui/button.tsx`, `#web/lib/utils.ts` for `cn`)
through the package's `imports` map; siblings as `./x`. The blue-violet-pink
gradient marks AI work (Auto pick, a running lane); yellow marks action
needed from the person.
