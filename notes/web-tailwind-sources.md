---
description: Tailwind only sees classes in files listed by hand as @source lines in styles.css; a file left off compiles but loses its styles silently, and a test catches only top-level .tsx files
---

`build.ts` compiles `styles.css` with Tailwind's `compile` and `Scanner`
without automatic content detection, so only files named by an `@source
"./x.tsx";` line in `styles.css` (about 230 of them) are scanned. A file left
off still builds, but its utility classes are never emitted and nothing
errors. `styles.test.ts` checks that every top-level non-test `*.tsx` except
`main.tsx` is listed, which fails `splates dev test` for a new component
left off. It does not cover `.ts` files that build class strings
(`phone-rows.ts`) or files under `components/`, which must be added by hand.
