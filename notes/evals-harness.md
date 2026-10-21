---
description: How the splates-skill eval harness is organized: probes per aspect with cli or agent execution, versioned seeds, deterministic pass/fail/uncovered verdicts and no LLM judge
---

`splates dev eval` spawns `bun evals/splates-skill/index.ts`. The fast path
(`fastCli` in `probe-cli.ts`) never imports the legacy LLM grader; legacy
`e2e` execution is refused and only `e2e report` still works. A probe
(`probe-schema.ts`, assessed by the pure `assess` in `probe.ts`) names one
skill requirement and declares a versioned seed, one input, tools, a stop
condition, time, turn and token bounds, and assertions of kind `count`,
`before`, `state`, `reply` or `uncovered`. `execution.kind` is `cli` (runs
argv, costs nothing) or `agent` (runs a real agent on the skill). Probes
live in one `*.probes.ts` per aspect (lifecycle, decisions, continuity,
discovery, orchestration), each exporting a `ProbeModule`, discovered
automatically. Verdicts are `pass`, `fail` or `uncovered`, the last meaning
the evidence channel was incomplete. Native drivers for Claude, Codex and
OpenCode (`native-*.ts`) replace ACP for agent probes. Free: `list`, `plan`,
`report`, `budgets` and `splates dev test --evals`.
