---
description: Auto pick looks again at what the person says mid-conversation and moves the conversation up, never down and never past the person's own choice, with an Undo line; the composer's settings switch it on or off for any conversation
---

`lifting` (`packages/server/auto-pick/lift.ts`) gives Auto pick a second look
at a conversation it started, as long as the person has not changed its
model or effort since. The judge reads the person's new messages under the
rules in `auto-pick/follow-up.ts`: short ones such as "go" are skipped, and
from the person's fourth message on everything they have said is read. If
the rules then give a stronger model, or a higher thinking level on the same
agent, the conversation moves up before the agent reads the message, with a
splates line saying why and an Undo; a lighter verdict changes nothing.

A second signal comes from reviewed conversations: when the agent's first
reply ended on a bare prose question and the person answered it, the
conversation moves to the rules' pick one depth deeper (`decideDeeper`).
Classifications are cached by a hash of the subject and judged detail.

The person can switch Auto pick on or off for any conversation from the
composer's settings (`web/auto-pick-switch.tsx`, `web/setting-controls.tsx`,
`PUT /api/conversations/:id/auto-pick`, logged as `auto-pick-switch`): a
switch atop the settings sheet a phone opens, and a switch atop the
Model picker's dropdown where the settings sit inline, a new conversation's composer
among them. The sheet's button shows Auto
pick's sparkles while on, else the agent's mark in its maker's colors. Off, or
any model or effort they pick by hand, leaves the settings as they are and
stops the second look. Switched on, the mark holds `rejudge`: the next
message the person sends is judged with everything they said before it, and
the conversation moves to the rules' pick on the agent it runs, down as well
as up, logged as "Auto switched to" with an Undo; after that first look it
lifts only up, as above.
