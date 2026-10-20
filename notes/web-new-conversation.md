---
description: How a new conversation is started in the web app: the new/ address, drafts, and seeding the composer from elsewhere
---

A conversation not yet started is the address `#conversations/new[/<agent>[/<task>]]`
(`NEW` and `newAddress` in `conversation-address.ts`); `new/auto` leaves the
agent to Auto pick. Its composer carries the model and settings pickers
(`conversation-home.tsx`), so any entry point gets those for free.

What is typed is kept as a draft in `Drafts` (`drafts.ts`) under `newDraft(...)`.
A page that wants to start a conversation with words already in the composer
writes a draft under a fresh identity and opens `withDraft(NEW, identity)`
(the Notes page's New does this). Do not build a separate form that calls
`startConversation` directly unless no composer is wanted.
