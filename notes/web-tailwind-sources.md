---
description: Tailwind only sees classes in files styles.css names with @source; top-level .tsx files are globbed, but a class-holding .ts or a file in another directory must be listed
---

`build.ts` compiles `styles.css` with Tailwind's `compile` and `Scanner`
without automatic content detection, so only what an `@source` line in
`styles.css` names is scanned. A file left off still builds, but its utility
classes are never emitted and nothing errors.

- A glob, `@source "./*.tsx"` minus `*.test.tsx`, covers every top-level page
  file, so a new component needs no line.
- A `.ts` file that builds class strings (`phone-rows.ts`, `board.ts`,
  `status-pill.ts`) must be listed by hand.
- So must a file in another directory; `components/ui` and
  `components/assistant-ui` are listed.

`styles.test.ts` checks the glob, the listed `.ts` files and that tests are
left out. It cannot catch a new class-holding `.ts` or directory left off.
