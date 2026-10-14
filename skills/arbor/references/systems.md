# Naming systems

Systems are named a few at a time as they come up, never all at once, and
only the user names one. Offer to as a question under `## Blocked`, and write
`arbor.config.ts` only once they pick a choice that does:

- when the user keeps calling one part of the code by a phrase no system has;
- when your task touches files no system covers, at most once per task;
- when a phrase the user uses means a system that already has another name:
  offer the phrase as an alias;
- when the user writes `#name` and no system answers to it: find the code
  they mean, then, if no system covers it, offer to name it, recommending the
  name that code already goes by (its directory, module or main type) over
  theirs; if one does, offer `name` as its alias.

A system has at most two aliases, and arbor refuses a config with more: to
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
the answer comes, then commit the change to `arbor.config.ts` with your task.
