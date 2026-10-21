---
description: The three packages, what each publishes, how a release is cut, and how the agent skill ships with it
---

`packages/splates` is the CLI published to npm as `@stringsync/splates`;
`packages/server` is `@stringsync/splates-server`, the HTTP server and every
backend operation, which the CLI maps flags onto and never the reverse;
`packages/web` is the page, compiled into `packages/server/web-build` so the
server ships it. `packages/splates/dev` holds `splates dev` (`fix`, `test`,
`eval`, `ship`), mounted only by `checkout.ts`, which `bin/splates` runs and
no `bin` or `exports` entry names, so it never reaches npm; `e2e.test.ts`
pins that.

`splates dev ship` releases in lockstep (`webappwiz/ship`): every workspace
`package.json` and the `version:` frontmatter of `skills/splates/SKILL.md`
take the same patch bump, in one "Release 0.0.N" commit tagged `v0.0.N`. The
skill is not on npm: `splates init` and `update` install it with `bunx skills
add stringsync/splates#v<release> --skill splates`, so the stamp says which
release a project's copy came from. Here `.agents/skills/splates` links to
`skills/splates`; `skills-lock.json` pins only third-party skills.
