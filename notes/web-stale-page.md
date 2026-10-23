---
description: How the page locks, dims, counts down and finally says it can't reach the server while its data is stale; read before changing loading or offline states
---

While the page has not heard from the server since its streams last opened,
it locks what may change and dims it, then counts down, then unlocks with
"Can't reach the server". There is no splash: a cold open or a project
switch goes through the same steps. The streams themselves are in
web-live-updates.

## Fresh

`Feed` and `ConversationFeed` each keep `fresh`. It is true only once the
server has answered since the stream last opened. It is false over a kept
copy, after a wake, or after a dropped or failed stream.

## Locked, dimmed, giving up

`freshness.tsx` joins the two into `FreshnessContext`.

- While `locked` (stale, and not dismissed), the inbox, phone and sidebar,
  keeps its rows `inert`, and the open thread is `inert`.
- Once the page has been stale 300ms, `useDimmed` dims what may change to
  60%: the desktop's pages and sidebar rows, the phone's inbox rows and
  open thread. Sooner would flash on a wake the server answers at once.
  That is all it says at first.
- Once a third of `offlineAfter` has passed, `GivingUp` counts down to
  giving up ("Still loading, gives up in 6s"). It shows in a desktop's bar
  or a phone's pill at the top of the screen. It is the page's one spinner
  besides the sidebar's working marks.
- After `offlineAfter` the page unlocks, undimmed, so what it shows can be
  read and copied. `OfflinePill` says "Can't reach the server" as an error.
- `OfflinePill` has no Retry or dismiss: the streams reopen by themselves,
  and the next stale spell locks the page again.

## No splash

The same holds before the page has anything.

- A cold open draws the bar and sidebar over `index.html`'s bare
  background.
- A switch of project draws the new one at once from what the page holds of
  it (`ProjectFeeds`): its conversations and tasks. The other pages stay
  empty until its own snapshot is in.
- Both are dimmed and count down alike.
- Placeholder rows (`Skeleton`) stand still.

## Where

- `packages/web/freshness.tsx`: `FreshnessContext`, `useDimmed`,
  `GivingUp`, `OfflinePill`
- `packages/web/countdown.tsx`: the "Still loading, gives up in" countdown
- `packages/web/project-feeds.ts`: `ProjectFeeds`
