# Contributing to Spinning Plates

Thanks for helping with Spinning Plates (the `splates` package).

## Contributor License Agreement

Before we can merge your first pull request, you must sign the
[Contributor License Agreement](CLA.md). The CLA Assistant check on your pull
request links to it and stays red until you sign; one signature covers every
later contribution.

Spinning Plates is released under the [MIT License](LICENSE), and stringsync LLC
holds its copyright. The CLA lets stringsync LLC keep doing that: you keep the
copyright in your contribution, and you grant the LLC the right to use it,
including to **relicense** it under other terms in future versions of Spinning
Plates. Without every contributor's grant the LLC could not do that.

If you contribute for your employer, make sure you are allowed to sign for
your contribution, or have your employer sign too.

## Pull requests

- Open an issue first for anything large, so we can agree on the direction.
- Keep a pull request to one coherent change.
- Run `bin/mono fix` and `bin/mono test --since main` before you push.

## What happens to your pull request

This repository is a mirror: the maintainers develop Spinning Plates in a
private monorepo and rebuild this repository from it on every release. So a
pull request is never merged on GitHub. A maintainer imports it into the
monorepo as a task, with you as the commit's author, and it reaches this
repository with the next release. Your pull request is then closed with a
comment linking the commit that carries it, and your authorship stays on it.

Because of that, the root files this repository generates (`package.json`,
`biome.json`, `tsconfig.base.json`, `bunfig.toml`, `bun.lock`) and
`packages/core` are not edited here: they come from the monorepo. A change to
one of them may be carried over by hand rather than imported as it is, so
expect a maintainer to ask about it or to port it themselves.

## Workspace conventions

Each package lives directly under `packages/*`, with its `package.json`, public
`index.ts` entry point, and source files at the package root. Keep tests beside
the source they exercise as `*.test.ts` or `*.test.tsx`; use subdirectories for
features rather than adding a `src/` wrapper. Import another workspace through
its declared package exports, rather than a relative path into its files.

`packages/splates` is the published CLI. `packages/server` owns the HTTP server
and shared backend operations; the CLI depends on it, and it never imports CLI
command definitions. `packages/web` owns the browser app, compiled into
`packages/server/web-build` for the server to ship. `packages/splates/dev` holds
the repository commands behind `splates dev`, which only the checkout's entry
`packages/splates/checkout.ts` mounts, so they are never published.
One root `tsconfig.json` and `biome.json` cover the workspace. The fix command
runs Biome, TypeScript, and vet against these shared settings.

The maintained splates agent skill lives in `skills/splates`, linked from
`.agents/skills/splates`. Third-party skills in `.agents/skills` are installed
from pinned releases and recorded in `skills-lock.json`; update them through
`bin/mono skills`, rather than editing their installed copies. `CLAUDE.md`
links to `AGENTS.md`, and `.claude/skills` links to `.agents/skills`, so agents
share the same instructions.
