---
description: The page's addresses are URL hashes (#tasks, #conversations/<id>, #lanes, #stats, #billing, #notes ...) parsed by PageAddress, with ?project= in the query picking the project and history entries that agree with the back button
---

`PageAddress` (`packages/web/page-address.ts`) is the router, wrapped for
React by `usePageRoute()` in `page-route.tsx`. Addresses: `#tasks[/<name>]`,
`#conversations[/<id>]`, `#conversations/archived`, `#conversations/new...`,
`#conversations/<id>/terminal`, `#lanes/<id>`, `#todos/<N>`, `#stats`,
`#evals[/<batch>[/<run>]]`, `#creds[/<name>]`, `#billing` (`#budget` still
opens it), `#workers`, `#automations`, `#automations/auto-pick[/<n>]`,
`#notes`, `#setup[/<journey>[/<step>]]`; an empty hash is the board. Old forms
(`#conversations/task/<name>`, `#auto-pick/<n>`) still parse.

`?project=` in the query, not the hash, picks the project. Each move pushes a
history entry recording `at` and `back`; moving back to the entry just left
calls `history.back()`, so the page's back button and a phone swipe agree,
and scroll is saved per entry. Leaving a main-tree terminal replaces its
entry rather than pushing.

Setup keeps its place: the journey and step are in the hash, the nav entry
returns to where Setup was left (the chevron to the index forgets it), and
the `SetupJourney` and `MoveWatch` live in `SetupContext`'s `HeldJourneys`, so
leaving the page stops nothing.
