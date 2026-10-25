---
description: How the splates CLI is built and where a command goes; read before adding a command, a flag or help text
---

The CLI is built with `cli()` from `webappwiz/cmd`; there is no hand-rolled
argv parsing. `packages/splates/splates.ts` holds the root roster of
top-level commands (it carries a `scry-ignore-file compact-files` for that),
and each group is its own `cli<SplatesDeps>("<name>")` in its own file
(`task.ts`, `lane.ts`, `queue.ts`, `hook.ts`, `worker.ts`, `creds.ts`,
`tunnel.ts`, `slots.ts`, `projects.ts`, `artifact.ts`, `replica.ts`,
`server.ts`), attached with `.mount(...)` at the bottom; `waiting.ts` mounts
as `worker queue`. Flags are `.option(name,
zodSchema, { default, description })`, `.arg` and `.rest`; an optional
string flag defaults to `""` and the action treats `""` as absent.

The logic lives in `@stringsync/splates-server`; a CLI file only maps flags
onto those calls, and the server never imports CLI definitions. The
description strings are the help agents read, so they are long and precise:
changing a command's API means checking `skills/splates/SKILL.md` still
matches. `index.ts` is the published bin, stripping a leading `--project
<slug>` before `splates.run(deps, argv)`.
