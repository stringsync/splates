# @webappwiz/arbor

Run many coding agents on one repository at once. Each works in its own git
worktree and lands its change on `main` itself, without pull requests.

```bash
bunx @webappwiz/arbor init
```

Run it in your repository and commit what it writes: the arbor skill, for
Claude Code, Codex, and any agent that reads `.agents/skills`. From then on,
your agents start each change with `arbor add` and land it with `arbor merge`.

## How it works

At its core, arbor is a consistent way to coordinate worktrees. Each change is
a task with its own branch and worktree, and every agent moves tasks through
the same few commands, so agents never edit the same checkout and always know
what the others are doing. There is no daemon and no orchestrator: arbor is a
CLI over git, and any agent in any terminal can use it. `arbor --help` lists
every command.

**Merging.** `arbor merge` rebases the task onto `main`, runs your checks
(`preMerge` in `arbor.config.ts`) on the result, fast-forwards `main`, and
removes the worktree. A conflict or a failing check goes back to the agent that
made the change, which fixes it and merges again.

**Escalating.** When an agent needs you (a decision, access, a review, or
merges that keep failing), it runs `arbor escalate`: it stops, leaves its
worktree as it is, and writes down its questions. You answer, and it picks up
where it left off.

## The harness

`arbor dev` is an optional page for running agents and answering them, on
http://localhost:4269.

```bash
bunx @webappwiz/arbor dev
```

### Parallel agents

Start as many conversations as you like, each in a task of its own.

![Several agents working at once](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/parallel.png)

### Questions and demos

Agents ask as they go instead of guessing. Each question comes with its
choices, the one the agent would pick, and a screenshot of each when there is
something to see. Answer in a click.

![Questions with a screenshot per choice](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/questions.png)

When work is ready, the agent hands you a demo: steps to try, what you should
see, and a checklist to tick off before you merge or ask for changes.

![A demo to try before merging](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/demo.png)

### Annotate any image

Mark up any image, one you upload or one an agent shows you. Draw a box or an
arrow, pin a note to each, and send it back.

![An agent's screenshot, marked up](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/annotate.png)
