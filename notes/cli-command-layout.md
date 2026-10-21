---
description: How the splates CLI is put together: webappwiz/cmd builders, zod-typed flags, one file per command group mounted on splates.ts, help text written for agents, and the empty-string default
---

The CLI is built with `cli()` from `webappwiz/cmd`; there is no hand-rolled
argv parsing. `packages/splates/splates.ts` holds the root roster of
top-level commands (it carries a `scry-ignore-file compact-files` for that),
and each group is its own `cli<SplatesDeps>("<name>")` in its own file
(`task.ts`, `lane.ts`, `queue.ts`, `hook.ts`, `worker.ts`, `budget.ts`,
`creds.ts`, `tunnel.ts`, `slots.ts`, `projects.ts`, `artifact.ts`,
`server.ts`), attached with `.mount(...)` at the bottom; `infra.ts` mounts
under `server`, `waiting.ts` is `worker queue`. Flags are `.option(name,
zodSchema, { default, description })`, `.arg` and `.rest`; an optional
string flag defaults to `""` and the action treats `""` as absent.

The logic lives in `@stringsync/splates-server`; a CLI file only maps flags
onto those calls, and the server never imports CLI definitions. The
description strings are the help agents read, so they are long and precise:
changing a command's API means checking `skills/splates/SKILL.md` still
matches. `index.ts` is the published bin, stripping a leading `--project
<slug>` before `splates.run(deps, argv)`.
