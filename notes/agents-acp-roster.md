---
description: Every agent splates runs is an ACP adapter started with bunx; the machine-wide roster in ~/.splates/agents.json names them and their models, and FakeAgent stands in for tests
---

Splates talks to coding agents only over the Agent Client Protocol
(`@agentclientprotocol/sdk`); there is no per-harness output parser.
`DEFAULT_AGENTS` in `packages/server/models/roster.ts` holds `claude` (`bunx
@agentclientprotocol/claude-agent-acp`; models `fable`, `opus`, `sonnet`,
`haiku`) and `codex` (`bunx @agentclientprotocol/codex-acp`; `gpt-6-astra`,
`gpt-6.1-sol`, `gpt-6-luna`). OpenCode is opt-in, added by a setup step as
`opencode acp` with `opencode-go/...` ids that must match exactly. The roster
is `~/.splates/agents.json`, one file for every project; defaults added
later are merged in on server start, so Auto pick rules naming them match.

`AgentConnection` (`agents/connection.ts`) owns one process and session.
`AgentStream` numbers the process's stdout frames and hands ACP messages
over one at a time, so a replay after a restart resumes on a frame
boundary; `fold` (`agents/fold.ts`) folds ACP updates into message parts.
`SharedBrowser` gives every session one Playwright MCP over HTTP with a
context each. Claude's AskUserQuestion tool is turned off in sessions,
since its form answers never reached the plan. In tests `FakeAgent`
(`agents/testing.ts`) is an in-process ACP agent scripted by `turn`.
