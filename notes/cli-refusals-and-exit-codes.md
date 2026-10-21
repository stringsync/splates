---
description: How a command refuses: fail(reason) throws an Exit, the exits middleware prints JSON on stdout and prose on stderr, and the exit codes in exit.ts are a stable contract agents branch on
---

Every refusal is `fail(reason, message, data)` from
`packages/server/exit.ts`. It throws an `Exit` and returns `never`, so code
after it is unreachable and TypeScript narrows. The `exits()` middleware,
outermost on the root `cli`, is the only place the process ends on a
refusal: one JSON line `{"reason", ...data}` on stdout, the human message on
stderr, exit code `EXIT[reason]`. Any other error is rethrown as a real
failure.

`EXIT` maps each reason to a fixed code (`usage` 1, `conflict` 2,
`tests_failed` 3, `lease_lost` 4, `budget_exhausted` 5 ... `migration_failed`
30), stable by contract since agents branch on the code or the reason, never
the prose. Retired codes stay as comments and are never reused: 15
(`unread`), 17 (`not_escalated`), 29 (`agents_full`). A new reason takes
the next free number. Tests assert a refusal with `toBail(reason, { message,
data })` from `@stringsync/splates-server/testing`.
