---
description: The server keeps the 200 most recently archived conversations and deletes older logs and images; how that number went back and forth, and what archiving does to a task
---

`ARCHIVED_KEPT` in `packages/server/conversations/conversations.ts` is 200:
as more conversations are archived, the log and images of older ones are
deleted. It went 50, then keep all and page through them, then back to 50,
then 200, as the 73 MB of logs on one machine shows why. The newest
conversation of each persistent agent's role is kept whatever its age, since
it holds that automation's row. Archiving a conversation removes the task it
is on, asking first only when the task has unmerged changes, and takes a
queued task out of the queue silently so it is not started forever. On the
phone, swiping an open conversation from the right archives it and returns
to the inbox, with an undo row above the list that goes when you act
elsewhere.
