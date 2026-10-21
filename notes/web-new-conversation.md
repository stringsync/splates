---
description: How a new conversation is started in the web app: the new/ address, drafts, and seeding the composer from elsewhere
---

A conversation not yet started is the address `#conversations/new[/<agent>[/<task>]]`
(`NEW` and `newAddress` in `conversation-address.ts`); `new/auto` leaves the
agent to Auto pick. Its composer carries the model and settings pickers
(`conversation-home.tsx`), so any entry point gets those for free.
With an agent picked, the Model picker also offers Auto pick first, which
keeps that agent and lets Auto pick choose the model and effort from the
first message (`autoPick: true` on `POST /api/conversations`); whether New
was left on it is kept in `splates.newConversationAutoModel`.
On `new/auto` the composer has no agent's settings, so it shows Auto pick's
button alone, opening the sheet whose switch, turned off, goes to `new/<agent>`
for the agent Auto pick stood in with.

What is typed is kept as a draft in `Drafts` (`drafts.ts`) under `newDraft(...)`.
A page that wants to start a conversation with words already in the composer
writes a draft under a fresh identity and opens `withDraft(NEW, identity)`.
Do not build a separate form that calls
`startConversation` directly unless no composer is wanted.
