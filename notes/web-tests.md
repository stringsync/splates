---
description: How the web package is tested: the Testing fake server, where page tests live, and the drivers for live updates, optimistic writes, refusals and phone widths
---

Page tests sit beside their component in `packages/web` (`*.test.tsx`) and run
under bun with Testing Library. `testing.ts` exports `Testing`, a fake of the
server's API (`testing.notes`, `testing.talk`, `testing.reply`,
`testing.posted(path)`), plus `render`, `fireEvent`, `act`, `waitFor`,
`within` and `cleanup`. Import those from `testing.ts`, never from
`@testing-library/react`, which biome refuses: the wrapper registers the DOM
before React DOM loads. Extend that
fake rather than stubbing `fetch` in a test. Tests are named for the behavior
(`app-conversation-queue-card.test.tsx`), one file per area.

Its drivers: `testing.openConversations(held, open?, snapshotOverrides?, agents?)`
sets `testing.talk` and renders the page at the named row or
`#conversations`; `testing.say(state)` pushes a `ConversationState` through
the fake SSE stream as the server would, and `testing.remove(id)` a removal.
Optimistic UI is tested with `testing.holdWrites()`, the action, an assertion
that it already shows, then `testing.refuseWrites = { reason, message }` and
`act(() => testing.release())`, expecting the rollback and the alert "Not
<x>: <message>". `holdSnapshots()`, `goAway()`, `comeBack()` and
`refuse(reason, message)` play the snapshot and offline cases. Phone-only UI
needs `resize(390, 844)`, with `resize(1024, 768)` put back in `afterEach`.
Shared helpers are in `drivers.ts` (`agentList`, `openRow`, `typeIn`,
`menuItem`) and `fixtures.ts` (`conversation`, `details`, `snapshot`).

Run `splates dev fix` then a focused `splates dev test` after changes.
