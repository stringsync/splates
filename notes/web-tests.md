---
description: How the web package is tested: the Testing fake server and where page tests live
---

Page tests sit beside their component in `packages/web` (`*.test.tsx`) and run
under bun with Testing Library. `testing.ts` exports `Testing`, a fake of the
server's API (`testing.notes`, `testing.talk`, `testing.reply`,
`testing.posted(path)`), plus `render`, `fireEvent` and `cleanup`. Extend that
fake rather than stubbing `fetch` in a test. Tests are named for the behavior
(`app-conversation-queue-card.test.tsx`), one file per area.

Run `splates dev fix` then `splates dev test` after changes; the second takes
a heavy-job slot itself.
