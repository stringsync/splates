---
description: Auto pick judges kind, depth and settled behavior with Jev or Clef, then maps these to models and effort through machine-wide rules
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
attachments unopened. `decide` takes the likeliest kind, depth and clarity
when the judge is at least `threshold` (0.5) sure, then the first matching
rule and its first pick whose agent has plan quota left.

Clarity measures settled behavior or approach, never assertive tone;
settled work can still be deep. Tied, missing or coin-toss clarity is unknown.
Rules may match `clarity: "settled"` or `"unresolved"`; omitted or `"*"`
accepts any certainty, preserving existing saved rules. Without a judge the first
rule that accepts any kind, depth and certainty wins. Rules are machine-wide in
`~/.splates/auto-pick.json`, edited on the Automations page; the defaults
(`auto-pick/defaults.ts`) run Claude then Codex at each depth, with deep
work whose choices are settled starting on `opus`, along with deep bugfixes;
other deep design and open work starts on `fable`. Certainty never lowers depth
or effort. Resetting to defaults adopts this rule for an existing saved mapping.
