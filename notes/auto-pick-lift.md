---
description: Auto pick looks again at what the person says mid-conversation and moves the conversation up, never down and never past the person's own choice, with an Undo line
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
