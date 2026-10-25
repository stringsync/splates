---
description: Everywhere a new top-level page of the web app must be registered, and how a heavy page loads on demand as its own chunk
---

A page is one value of the `Page` union in `packages/web/page-route.tsx`.
Registering it touches: the nav list `PAGES` (label, lucide icon, optional
shortcut) and `PHONE_PAGES` (phone padding) in `page-route.tsx`,
`DESKTOP_PAGES` (desktop width) in `desktop-app.tsx`, a branch in `pageIn()`
in `page-address.ts` mapping its hash, and its body in the record
`useAppPages` returns in `app-pages.tsx`. The `Record<Page, ...>` types make
TypeScript flag most misses, but not `pageIn`, which falls through to the
board. Tailwind's glob in `styles.css` already scans a new top-level
`.tsx`; only a class-holding `.ts` or a file in a subdirectory needs its own
`@source` line.

Heavy pages are exported from `lazy-pages.tsx` through `onDemand(() =>
import(...))`, `React.lazy` with a fallback that stays blank until a slow chunk counts down,
timed out by `WAITS.answer` under an error boundary with Try again, each its
own hashed chunk:
Board, Stats, Evals, Billing, Automations, Auto pick, Notes, Setup,
the lightbox and the annotator. `navPage()` lets a sub-page highlight its
parent in the nav, as Auto pick sits under Automations.
