---
description: Where server code lives and the one-directory-per-module layout being migrated to
---

`packages/server` is moving from flat files to one directory per module, with
`conversations/` as the model: an `index.ts` of named re-exports is the only
way in from outside, a `testing.ts` holds fakes, and a `browser.ts` holds
what the web bundle may import (anything pulling agent processes or `bun:`
modules must stay out of it). `AGENTS.md` has the full rules; read it before
moving or adding a module. Each directory also needs its own `exports` entry
in `packages/server/package.json`, never a wildcard.

The CLI is `packages/splates`; the web app is `packages/web`; the agent skill
is the source at `skills/splates`.
