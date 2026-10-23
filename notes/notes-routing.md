---
description: How the project's judge points messages to notes and checks turns applied them, and what the Stats page reads; bears on routing tiers and stats
---

Under `splates server` the project's judge weighs notes twice: routing
before a message reaches the agent, and weighing after each turn that read
a note. Each judgment is a journal event for the Stats page. With no judge
neither runs.

## How it works

- Routing attaches pointers to the notes that bear on a message, recorded
  as `notes attached`.
- Routing's request also asks whether the message corrects the agent,
  given its last reply (`corrects`), for the correction rate.
- Weighing asks whether the turn's actions applied the note, recorded as
  `note applied` with the tier its pointer had, or `unprompted`.
- `note read` keeps the note's `bytes` and the conversation's `context`
  tokens as it was read.
- The tiers' bars and caps are `ROUTING`.

## Spend

Routing and weighing keep what Jev said the request cost (`dollars`, split
over the notes weighed). Both ask the judge with `purpose: "notes"`. So the
ledger names their spend `jev-latest notes`, a row of its own on Billing
beside Auto pick's `jev-latest`.

## The Stats page's Notes section

It reads those events from the project's journal, served per project at
`/api/stats/notes`, beside the machine's outcomes and adherence. It shows:

- conversations with pointers against the holdout, a conversation's arm
  being what its first `notes attached` said;
- per note, the reads after its pointers, the applied rate and unprompted
  reads;
- corrections and turns per merged task (`Outcome.turns`) by arm;
- the judge's spend;
- the notes' share of context, at about 4 bytes a token.

The later facts are optional, so events from before them still read.

## Tuned 2026-10-21

`ROUTING` was tuned against 94 recorded judgments labelled by hand. A
`notes attached` event holds no message text, so each was joined to the
last `prompt` record at or before its `at` in `conversations/<id>.jsonl`.

- At p ≥ 0.8, nine in ten notes bore on the message.
- Between 0.7 and 0.8, half did.
- Between 0.5 and 0.7, under a quarter did.

So the optional tier starts at 0.7 and takes one. The judge answered in
about 0.3s (p95 0.5s, never over 0.9s), hence the 2s timeout.

## Where

- `packages/server/notes/route.ts`: routing
- `packages/server/notes/applied.ts`: weighing
- `packages/server/notes/tiers.ts`: `ROUTING`
- `packages/server/stats/notes.ts`: the Stats page's Notes section
