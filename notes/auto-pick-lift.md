---
description: How Auto pick moves a running conversation up on what the person says next, and how the composer switches Auto pick on or off for one conversation
---

Auto pick takes a second look at a conversation it started when the person
says more, and moves it up, never down. It never overrides a model or effort
the person picked. The person can switch Auto pick on or off for any
conversation from the composer's settings.

## The second look

`lifting` gives Auto pick a second look at a conversation it started, as
long as the person has not changed its model or effort since.

- The judge reads the person's new messages under the rules in
  `follow-up.ts`.
- Short ones such as "go" are skipped.
- From the person's fourth message on, everything they have said is read.
- If the rules then give a stronger model, or a higher thinking level on
  the same agent, the conversation moves up before the agent reads the
  message. A splates line says why and offers an Undo.
- A lighter verdict changes nothing.

A second signal comes from reviewed conversations. When the agent's first
reply ended on a bare prose question and the person answered it, the
conversation moves to the rules' pick one depth deeper (`decideDeeper`).

Classifications are cached by a hash of the subject and judged detail.

## The switch

The switch is logged as `auto-pick-switch`.

- On a phone, it sits atop the settings sheet.
- Where the settings sit inline, a new conversation's composer among them,
  it sits atop the Model picker's dropdown.
- The sheet's button shows Auto pick's sparkles while on, else the agent's
  mark in its maker's colors.

Switching off, or picking any model or effort by hand, leaves the settings
as they are and stops the second look.

Switching on sets `rejudge`. The next message the person sends is judged
with everything they said before it. The conversation moves to the rules'
pick on the agent it runs, down as well as up, logged as "Auto switched to"
with an Undo. After that first look it lifts only up, as above.

## Where

- `packages/server/auto-pick/lift.ts`: `lifting`, `rejudge`
- `packages/server/auto-pick/follow-up.ts`: the follow-up rules
- `packages/server/auto-pick/decide.ts`: `decideDeeper`
- `packages/web/auto-pick-switch.tsx`, `packages/web/setting-controls.tsx`:
  the switch
- `PUT /api/conversations/:id/auto-pick`: the switch's route
