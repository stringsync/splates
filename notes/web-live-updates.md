---
description: How the server's changes reach the page over SSE streams that reopen after silence; read before touching the page's feeds or adding a WebSocket
---

The page hears of the server's changes over SSE streams, each reopening by
itself after silence. WebSockets are used only for terminals and dictation.
How the page shows that it is stale or offline is in web-stale-page.

## The streams

- `Feed` opens `/events`. Each message only means something moved, and the
  page re-reads `/api/snapshot`. At most one read is in flight and one
  trailing.
- `ConversationFeed` opens `/api/conversations/events`. A plain message
  carries a whole `ConversationState`. The named events are `delta`,
  `removed` and `settings`, which re-lists.
- `EverywhereFeed` streams `/api/everywhere/events` across every project.

## Reopening

All three go through `LiveStream`, an `EventSource` that reopens after two
server pulses of silence. A stream can sit open but dead after the machine
sleeps, which is why.

- On reopen it reads everything afresh.
- Messages still sending on a reconnect are marked unsent.
- It also reopens at once on a wake: the page shown again after a pulse or
  more hidden, or back online. It tells its feed it `dropped` the old one.

## The first read

`index.html` starts fetching `/api/snapshot` and `/api/conversations` before
the script loads. `EarlyReads` hands those to the first read.

## Where

- `packages/web/feed.ts`: `Feed`
- `packages/web/conversation-feed.ts`: `ConversationFeed`
- `packages/web/everywhere-feed.ts`: `EverywhereFeed`
- `packages/web/live-stream.ts`: `LiveStream`
- `packages/web/wakes.ts`: what counts as a wake
- `packages/web/early-reads.ts`: `EarlyReads`
- `packages/web/terminal-session.ts`: the terminals' WebSocket
- `/api/dictation`: the dictation WebSocket
