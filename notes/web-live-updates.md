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
messages still sending on a reconnect are marked unsent. It also reopens at
once on a wake (`wakes.ts`: the page shown again after a pulse or more
hidden, or back online), telling its feed it `dropped` the old one.

`Feed` and `ConversationFeed` each keep `fresh`, true only once the server
has answered since the stream last opened: false over a kept copy, after a
wake, or a dropped or failed stream. `freshness.tsx` joins the two into
`FreshnessContext`: while `locked` (stale, and not dismissed) the inbox
(phone and sidebar) keeps its rows `inert` and the open thread is `inert`.
Once the page has been stale 300ms (sooner would flash on a wake the server
answers at once), `useDimmed` dims what may change to 60% and says nothing
else: the desktop's pages and sidebar rows, the phone's inbox rows and open
thread. No words, line or spinner, so coming back to a tab stays quiet. After
`offlineAfter` the page unlocks, undimmed, so what it shows can be read and
copied, and a neutral `OfflinePill` says "Offline", with no Retry or dismiss:
the streams reopen by themselves, and the next stale spell locks it again.

`index.html` starts fetching `/api/snapshot` and `/api/conversations` before the script loads,
and `EarlyReads` hands those to the first read. WebSockets are used only for
terminals (`terminal-session.ts`) and dictation (`/api/dictation`).
