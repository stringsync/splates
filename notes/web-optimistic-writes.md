---
description: Page actions show at once through expect() patches over the last snapshot and roll back with a reason beside the control if the server refuses; there is no toaster
---

Writes go through `expect(expectation, write)`: `Feed.expect` takes a
`Snapshot => Snapshot` patch and `ConversationFeed.expect` a per-conversation
patch, laid over the server's last word until the write lands and a later
read holds the change; a refused write drops the patch and rejects.
Components reach them through `useExpectSnapshot()` and `useExpect()` from
`expecting.tsx`, whose default context just awaits the write, so a control
works without a feed. Ready-made board patches (`assigned`, `queued`,
`arranged`, `laneRenamed`, `lanesJoined`) live in `board-expectations.ts`.
New conversations and messages get page-chosen ids, so they open before the
server answers.

The toaster was removed on purpose. A refusal shows for four seconds beside
the control that caused it (`useRefusals` in `refusal.tsx`, worded
`refusalOf(title, error)` as "Not pinned: locked"; `RowRefusals` keys them by
conversation so the reason survives a row vanishing and returning), copies
confirm in place, and a refused draft is restored. An undo, where offered,
is a row that goes away when the person acts elsewhere, never a toast.
