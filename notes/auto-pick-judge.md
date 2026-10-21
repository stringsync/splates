---
description: Auto pick classifies a task's kind and depth with a TypeSafe Jev (else Cloudflare Clef) decision model, then maps them to an agent, model and effort through machine-wide rules
---

Auto pick is not a prompt-and-parse step: it asks a "System One" decision
model yes/no questions and reads back probabilities (`Judge`, `Judgment` in
`packages/server/auto-pick/system-one.ts`). `judgeFrom` takes `Jev`
(TypeSafe, `jev-latest`) when the `TYPESAFE_API_KEY` cred is kept, else
`Clef` (Cloudflare Workers AI) when `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` are, else no judge.

`classify` asks every question in one judgment: kind `bugfix`, `design` or
`open`; depth `shallow`, `moderate` or `deep`, reading the subject plus up to
4000 characters of detail, keeping paths the goal names and summarizing
attachments unopened. `decide` takes the likeliest kind and depth when the
judge is at least `threshold` (0.5) sure, then the first matching rule and
its first pick whose agent has plan quota left. Without a judge the first
rule that accepts any kind and depth wins. Rules are machine-wide in
`~/.splates/auto-pick.json`, edited on the Automations page; the defaults
(`auto-pick/defaults.ts`) run Claude then Codex at each depth, with deep
design and open work starting on `fable` and deep bugfixes on `opus`.
