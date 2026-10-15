# Offering a system

A system name looks like any other name in code, so say it is one: ask
whether the code should be an arbor system, and write every system name and
alias in the question as `#name`, the way the user and the `arbor dev` page
write them, so no one reads the choice as naming a class, a module or a
directory.

A system has at most two aliases, and arbor refuses a file with more: to
offer a third, offer to swap it for one it has, or to call the system by its
name instead.

```markdown
- [ ] 3. Should the mixing code be an arbor system?
  You have called `src/mixer/**` "the mixer" three times, and no system covers it.
  - (a) Name it `#mixer`, for `src/mixer/**` (chosen)
  - (b) Add `src/mixer/**` to `#playback`, with `#mixer` as an alias
  - (c) Leave it unnamed
```

Here `(chosen)` is what you would pick, not what you did: write nothing until
the answer comes, then commit the change to `arbor.systems.ts` with your
task, where names go without the `#`. `satisfies SystemsFile` types what you
write, the typecheck catches a mistake, and `arbor systems` reads it back.
