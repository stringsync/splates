---
description: How the server's changes reach the page: SSE streams (one a moved ping that triggers a snapshot re-read, one carrying conversation state) that reopen after silence; WebSockets only for terminals and dictation
---

`Feed` (`packages/web/feed.ts`) opens `/events`; each message only means
something moved, and the page re-reads `/api/snapshot`, with at most one
read in flight and one trailing. `ConversationFeed` (`conversation-feed.ts`)
opens `/api/conversations/events`, where a plain message carries a whole
`ConversationState` and the named events are `delta`, `removed` and
`settings` (which re-lists). `EverywhereFeed` streams
`/api/everywhere/events` across every project.

All three go through `LiveStream` (`live-stream.ts`), an `EventSource` that
reopens after two server pulses of silence, because a stream can sit open
but dead after the machine sleeps, and reads everything afresh on reopen;
messages still sending on a reconnect are marked unsent. `index.html` starts
fetching `/api/snapshot` and `/api/conversations` before the script loads,
and `EarlyReads` hands those to the first read. WebSockets are used only for
terminals (`terminal-session.ts`) and dictation (`/api/dictation`).
