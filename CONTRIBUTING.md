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
- Run `splates dev fix` and `splates dev test` before you push.

## Workspace conventions

Each package lives directly under `packages/*`, with its `package.json`, public
`index.ts` entry point, and source files at the package root. Keep tests beside
the source they exercise as `*.test.ts` or `*.test.tsx`; use subdirectories for
features rather than adding a `src/` wrapper. Import another workspace through
its declared package exports, rather than a relative path into its files.

`packages/splates` is the published CLI and server. `packages/dev` is a private
workspace for repository commands behind `splates dev`; it is never published.
One root `tsconfig.json` and `biome.json` cover the workspace. The fix command
runs Biome, TypeScript, and Scry against these shared settings.

The maintained splates agent skill lives in `skills/splates`, linked from
`.agents/skills/splates`. Third-party skills in `.agents/skills` are installed
from pinned releases and recorded in `skills-lock.json`; update them through
`splates dev skills`, rather than editing their installed copies. `CLAUDE.md`
links to `AGENTS.md`, and `.claude/skills` links to `.agents/skills`, so agents
share the same instructions.
