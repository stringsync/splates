---
description: The web app has a separate phone layout and desktop layout over shared page bodies; where each lives and how one is chosen
---

`packages/web/app.tsx` picks the layout with `useWide()` (`app-nav.tsx`, the
`WIDE` media query). Both layouts show the same page bodies, built once in
`app-pages.tsx`; only the frame around them differs.

- Desktop: `desktop-app.tsx`. A sidebar (tabs, conversation list, New button)
  beside the page, each page under its own `TopBar`. `DESKTOP_PAGES` there
  sets how wide each page sits.
- Phone: `phone-app.tsx`. The inbox of agents (`phone-inbox*.tsx`) is home, an
  open conversation fills the screen (`phone-thread.tsx`), and every other page
  sits under a bar whose menu opens the drawer (`phone-drawer.tsx`).
  `Screen` (`phone-screen.tsx`) pins a composer above the keyboard.

A change to a page body shows on both. A change to navigation, the bar or the
composer's placement usually needs doing in both layouts, so check each
width (the `WIDE` breakpoint is 768px).
