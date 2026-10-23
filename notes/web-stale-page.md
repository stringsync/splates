---
description: How the page locks, and finally says it can't reach the server, while its data is stale; read before changing loading or offline states
---

While the page has not heard from the server since its streams last opened,
it locks what may change, saying nothing and dimming nothing, then unlocks
with "Can't reach the server". There is no splash: a cold open or a project
switch goes through the same steps. The streams themselves are in
web-live-updates.

## Fresh

`Feed` and `ConversationFeed` each keep `fresh`. It is true only once the
server has answered since the stream last opened. It is false over a kept
copy, after a wake, or after a dropped or failed stream.

## Locked, then giving up

`freshness.tsx` joins the two into `FreshnessContext`.

- While `locked` (stale, and not dismissed), the inbox, phone and sidebar,
  keeps its rows `inert`, and the open thread is `inert`. Nothing dims and
  no countdown or spinner shows: loading is quiet.
- After `offlineAfter` the page unlocks so what it shows can be read and
  copied. `OfflinePill` says "Can't reach the server" as an error.
- `OfflinePill` has no Retry or dismiss: the streams reopen by themselves,
  and the next stale spell locks the page again.

## No splash

The same holds before the page has anything.

- A cold open draws the bar and sidebar over `index.html`'s bare
  background.
- A switch of project draws the new one at once from what the page holds of
  it (`ProjectFeeds`): its conversations and tasks. The other pages stay
  empty until its own snapshot is in.
- Both are locked alike.
- Placeholder rows (`Skeleton`) stand still.

## Where

- `packages/web/freshness.tsx`: `FreshnessContext`, `OfflinePill`
- `packages/web/project-feeds.ts`: `ProjectFeeds`
