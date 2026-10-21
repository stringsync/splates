---
description: The code conventions scry enforces here (classes over function exports, fakes over mocks, one describe per test file, no em dashes, 500-line files) and how a file opts out
---

`.wiz/scry` holds 18 rules that `splates dev fix` checks on changes since
`main`. Seventeen are vendored from webappwiz's catalog and refreshed with
`bunx @webappwiz/cli scry update`, never edited here: classes over function
exports (dependencies arrive once, through a constructor), comments say why
not what, doc comments address users, the file's named export leads it,
fakes over mocks, logic lives in controllers (plain classes a framework only
drives), matchers over test logic (no `if` or `for` in a test), named
options last (a trailing `opts` object), no em dashes in code or prose,
objects over callbacks, one class per file, parameters declare fields,
reactive over useState (a `Dispatcher` and `useReactive`), resources are
disposable (`Resource` from `webappwiz/disposable`), simple test setup (one
unnested `describe`, `it` titles that complete "it ..."), test setup names
what it makes (never "harness"), tests own their state.

`compact-files` is the repo's own: under 500 lines of code per logic file,
comments and tests not counted. A file opts out with `// scry-ignore-file
<rule>: <why>`, a line with `// scry-ignore <rule>: <why>`; the why is
expected. `scry.config.ts` budgets `som` at 5M tokens a day and no `llm`.
