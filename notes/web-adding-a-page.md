---
description: The places a new top-level page must be registered (PAGES, PHONE_PAGES, DESKTOP_PAGES, pageIn, useAppPages, styles.css) and how heavy pages load on demand as their own chunk
---

A page is one value of the `Page` union in `packages/web/page-route.tsx`.
Registering it touches: the nav list `PAGES` (label, lucide icon, optional
shortcut) and `PHONE_PAGES` (phone padding) in `page-route.tsx`,
`DESKTOP_PAGES` (desktop width) in `desktop-app.tsx`, a branch in `pageIn()`
in `page-address.ts` mapping its hash, and its body in the record
`useAppPages` returns in `app-pages.tsx`. The `Record<Page, ...>` types make
TypeScript flag most misses, but not `pageIn`, which falls through to the
board. Its `.tsx` files also need `@source` lines in `styles.css`.

Heavy pages are exported from `lazy-pages.tsx` through `onDemand(() =>
import(...))`, `React.lazy` with a null fallback, each its own hashed chunk:
Board, Stats, Evals, Billing, Workers, Automations, Auto pick, Notes, Setup,
the lightbox and the annotator. `navPage()` lets a sub-page highlight its
parent in the nav, as Auto pick sits under Automations.
