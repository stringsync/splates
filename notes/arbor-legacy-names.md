---
description: splates was called arbor until October 2026, and todos became tasks; what still answers to the old names and where they survive in code and records
---

The project was arbor, part of webappwiz, until 2026-10-17, when one commit
renamed everything with a migration: the command and package, `.git/arbor` to
`.git/splates`, `~/.arbor`, `ARBOR_*` to `SPLATES_*`, `ARBOR.md` to
`SPLATES.md`, the `[ARBOR ...]` directives. `config/legacy-names.ts` keeps the
old names readable for one release (`ARBOR_*` read as `SPLATES_*`,
`arbor.config.ts` when there is no `splates.config.ts`, `ARBOR.md` as the
plan file, `.git/arbor` until the server moves it), each printing one stderr
warning; dropping that file and `legacy-ps.ts` ends the support. Merge
refuses a branch that tracks either plan file.

On 2026-10-19 `splates todo` became `splates task`, and a queued task and a
started one became one numbered thing. Old `TODO` directives and journal
events still read under the new names, and the page's API paths and stored
keys keep `todo` so old links and settings work. "arbor dev" in old commit
subjects means today's `splates server` page.
