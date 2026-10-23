---
description: The formatter and lint choices biome.json makes beyond Biome's defaults, including the ban on importing through packages/ paths
---

`biome.json` sets no formatter options, so code takes Biome's defaults: tabs,
double quotes, semicolons, 80 columns. On top of the recommended lint preset:
`useBlockStatements` (every `if` has braces); `useNamingConvention` forbids
`IFoo` interface names and one-letter variables other than `i`, `j`, `k`;
`noRestrictedImports` bans any path through `**/packages/**`, so another
workspace is imported by its package export
(`@stringsync/splates-server/<dir>`); `noUndeclaredDependencies` is an error.
`.agents` and `.wiz/scry/*/evals` are not checked, and lint is off for the
vendored shadcn and assistant-ui components and `packages/web/hooks`. `fix`
runs it with `--write --unsafe`, so unsafe autofixes are applied.

In `packages/web/**/*.test.ts` and `*.test.tsx`, `noRestrictedImports` also
rejects direct imports from `@testing-library/react`. Use the shared
`testing-library` wrapper, which registers the DOM before loading React DOM;
otherwise `onChange` can stop firing in later test files in the same process.
The wrapper and `test-preload.ts` are outside the test-file restriction.
