---
description: How the page is bundled and served: Bun.build into text files inside the server package, no dev server or HMR, so a web change shows only after a rebuild and a server restart
---

`packages/web/build.ts` compiles the page with `Bun.build` from `boot.ts`
(which only imports `main.tsx`), split per page into `chunk-<hash>.js`, with
a separate service worker `worker.ts` and Tailwind compiled through
`@tailwindcss/oxide`. Everything is written as `.txt` into
`packages/server/web-build/` (gitignored): `shell.txt`, `main.txt`,
`chunks.txt`, `styles.txt`, the manifest and icons. `server/assets.ts`
imports them `with { type: "text" }`, so a release bundles the page inside
the server and React and Tailwind stay out of the CLI's dependencies.

The build runs on `bun install` (the root `postinstall`), `bun run build` in
`packages/web`, and a release. There is no watch mode and no HMR, and dev
and release use the same minified output with linked source maps, so a
change shows only after a rebuild and a server restart. `pages.ts` stamps
`?v=<hash>` on the script and stylesheet, and the service worker caches the
shell and tells the window to reload once the server's shell differs; a tab
never reloads while in use. `packages/splates/web-build/` is a tracked
leftover nothing reads.
