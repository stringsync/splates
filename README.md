# @webappwiz/arbor

A harness for running many coding agents on one repository at once. Each agent
works in its own git worktree and lands its change on `main` itself, without
pull requests.

```bash
bunx @webappwiz/arbor init   # once per repository, then commit what it wrote
bunx @webappwiz/arbor dev    # the page, on http://localhost:4269
```

## Parallel agents

Start as many conversations as you like. Each one gets its own task and
worktree, so agents never edit the same checkout, and each lands its work with
`arbor merge` once its tests pass on the latest `main`.

![Several agents working at once](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/parallel.png)

## Questions and demos

Agents ask as they go instead of guessing. Each question comes with its
choices, the one the agent would pick, and a screenshot of each when there is
something to see. Answer in a click.

![Questions with a screenshot per choice](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/questions.png)

When work is ready, the agent hands you a demo: steps to try, what you should
see, and a checklist to tick off before you merge or ask for changes.

![A demo to try before merging](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/demo.png)

## Annotate any image

Mark up any image, one you upload or one an agent shows you. Draw a box or an
arrow, pin a note to each, and send it back.

![An agent's screenshot, marked up](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/annotate.png)

## Without the page

Agents you run in your own terminal work through arbor just the same; the page
is optional. `arbor --help` lists every command.
