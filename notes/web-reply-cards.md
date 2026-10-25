---
description: How an agent's markdown reply is cut into cards on the page, and the exact shapes recognized: numbered questions, Ready to merge, Proposed, Merged, Removed, Deferred, Permission, Demo
---

The parser is `stretches(text)` in `packages/server/plans/asked.ts`, reached
by the page through `@stringsync/splates-server/plans/browser`. It cuts a
reply into stretches of type `text`, `questions`, `review`, `proposal`,
`report`, `todo`, `permission` and `demo`:

- Questions: a numbered list at the margin, outside code fences, where every
  item asks, ending in `?` (an aside in parentheses may follow) or carrying
  `- (a)` or `- [a]` choices.
- Review `## 🔍 Ready to merge <task> onto <base>`, with `Checks:` and
  `Failed:` lines; proposal `## 💡 Proposed ...`.
- Reports `## ✅ Merged <task> onto <base>`, `## ✅ Done: ...` (any
  conversation's work over with no task landed, an automation's run among
  them; offers Archive and the same green circle check as a merge),
  `## 🛑 Removed`, `## ⏸ Deferred`, `## ⚠️ Escalated`, `## ⏳ Working`.
- Permission `## 🔐 Permission: queue lane <n>|queue #<n>|remove lane
  <n>|run evals <skill>|run command` (older `## 📥 Queue` reads as queue); todo `### 📝
  <subject> [#<id>]`; demo `### 🎬 Demo: ...`.

A heading `#` to `###` ends a card, `####` stays inside one. `replied()` in
`packages/web/thread-reply.ts` turns stretches into assistant-ui `data-*`
parts only once the message is settled; until then the reply is plain text.
A demo, proposal or escalation is merged into the questions card that
follows it, and each part is drawn by a UI registered in `thread.tsx`.
Changing a shape means changing the skill's Formats too.
