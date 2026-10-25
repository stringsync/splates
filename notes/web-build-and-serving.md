---
description: How the page is bundled and served: Bun.build into text files inside the server package, no dev server or HMR, so a web change shows only after a rebuild and a server restart
---

`packages/web/build.ts` compiles the page with `Bun.build` from `boot.ts`
(which only imports `main.tsx`), split per page into `chunk-<hash>.js`, with
a separate service worker `worker.ts` and Tailwind compiled through
`@tailwindcss/oxide`. Everything is written as `.txt` into
`packages/server/web-build/` (gitignored): `shell.txt`, `main.txt`,
`styles.txt`, the manifest and icons, and the chunks as `chunk-names.txt`,
`chunks.txt` (their code) and `chunk-maps.txt` (their source maps).
`server/assets.ts` imports them `with { type: "text" }`, so a release bundles
the page inside the server and React and Tailwind stay out of the CLI's
dependencies. The chunk code and maps are a dynamic `import()`, loaded on
the first request for a chunk or a `.map` (`pages.ts` hashes each then), so
a CLI command or test that serves no page never holds them.

Measured 2026-10-25 (bun 1.4.2), max RSS: importing `server/assets.ts` 249 →
16 MB, `server/index.ts` 271 → 72 MB, `splates task list` 285 → 96 MB. In a
bundle the chunk text is still inlined in the source, so a bundled CLI
starts near 105 MB before loading it.

The build runs on `bun install` (the root `postinstall`), `bun run build` in
`packages/web`, and a release. There is no watch mode and no HMR, and dev
and release use the same minified output with linked source maps, so a
change shows only after a rebuild and a server restart. `pages.ts` stamps
`?v=<hash>` on the script and stylesheet, and the service worker caches the
shell and tells the window to reload once the server's shell differs; a tab
never reloads while in use.
