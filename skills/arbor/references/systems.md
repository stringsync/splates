# Offering a system

A system has at most two aliases, and arbor refuses a file with more: to
offer a third, offer to swap it for one it has, or to call the system by its
name instead.

```markdown
- [ ] 3. Should the mixing code have a name?
  You have called `src/mixer/**` "the mixer" three times, and no system covers it.
  - (a) Name it `mixer`, for `src/mixer/**` (chosen)
  - (b) Add `src/mixer/**` to `playback`, with `mixer` as an alias
  - (c) Leave it unnamed
```

Here `(chosen)` is what you would pick, not what you did: write nothing until
the answer comes, then commit the change to `arbor.systems.ts` with your
task. `satisfies SystemsFile` types what you write, the typecheck catches a
mistake, and `arbor systems` reads it back.
