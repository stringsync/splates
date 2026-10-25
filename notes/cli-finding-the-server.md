---
description: How a CLI command finds the running splates server (--dev, then SPLATES_DEV), and how an agent the server starts knows its server and conversation
---

Commands that need the running server (`worker queue`, `worker list`,
`artifact add`, the conversation `follow`) resolve it with `serverOf` in
`packages/server/workers/server-of.ts`: the `--dev <url>` flag, then
`SPLATES_DEV`, else none. Only `ports` falls back to this machine's server
on `DEFAULT_PORT` 4269 (`ports/list.ts`).

The server sets `SPLATES_DEV` and `SPLATES_CONVERSATION` in the environment
of every agent it starts, which is how `splates attach`, `artifact`, `creds`
and journal events know their conversation. An agent outside the page has
neither, so `follow` stays silent and an unreachable server is logged, never
a failure. `SPLATES_DEV` is the server's loopback URL, reached directly.
