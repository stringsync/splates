---
description: Question and review cards answer by sending an ordinary message that quotes each question in bold with its picks; permission cards make the write themselves since agents are refused those actions
---

Question and review cards call no special endpoint. They build a reply with
`replyOf` (`packages/server/plans/reply.ts`) and send it through
`ReplyContext.send` as a normal user message: each question quoted as `>
**...**`, picks written as `- (b) text` (numbered when order matters), then
the person's own words, which the agent reads like anything typed; what they add beyond the questions comes last, under a quoted `> **Anything else?**`. A card
learns it was answered from the next user message in the thread
(`useCardReply` returns `sent`) and stops offering answers once the agent
asks again; there is no reply path for an external agent.

Permission cards (`permission-card.tsx`, on `ActionCard`) exist because
splates refuses those actions to agents: the person's button makes the write
directly through `expect`, queueing a lane for instance, and a copy button
gives the equivalent `splates ...` command for a terminal.
