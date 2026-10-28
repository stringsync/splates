# Pending, not optimistic

Settled with the user, 2026-10-28. This supersedes the 2026-10-17 goal that
page actions show their result at once.

## Decision

A page action that writes to the server shows a **pending state** until the
server's own state shows the change, and then the server's copy. It never
draws the expected result early.

Showing a patched copy made rows and cards pop in and out: the overlay
showed, the write landed, and the streamed copy caught up a moment later.

## How

- `ConversationFeed.expect` and `Feed.expect` register a write as pending on
  a key: a conversation id, or for the snapshot the task, todo or lane it
  touches. The feeds hold only the server's word; `pending(id)` and
  `pending(key)` say whether a write is on its way.
- The caller still passes what the change is, but only so the feed knows
  when it has arrived. The write stays pending after its HTTP answer until
  the server's copy holds it (`holds`, `landedRead`, and `unfiled` for the
  archive race), so the old state never flashes back between the answer and
  the stream.
- A refusal clears pending at once and is shown as before (`refusal.tsx`,
  `row-refusal.tsx`).
- Components read `usePendingConversation(id)` and `usePendingSnapshot(key)`,
  and draw it with the pieces in `pending.tsx`: controls disable at once to
  stop a second submit, but the dim and spinner appear only after about
  150ms, so a fast write shows no flicker, and fade in and out.
