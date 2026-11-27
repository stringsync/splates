# Ships and releases

Only the user ships, and a ship starts from the user on the Ships page, never
from an agent. Being told to ship, even "ship it yourself" from a user stepping
away, is no leave to start one: run no target's ship command beyond `plan` and
`done`, and say the ship starts from the Ships page.

A ship is what releases or deploys a project (an npm release, a stack deploy);
a merge is never a release. Never run what a ship would (`npm publish`, a
deploy, a target's `ship run`), and never run `npm login`: only the user starts
a publish, and a ship signs in to nothing.

A project that cannot ship yet has a setup journey on the welcome page and in
Setup (`splates setup ships`; see [setup.md](setup.md)).

## Checking whether a fix is out or a release is due

A fix is out only once a release after it is: a fix committed after the last
release tag is unreleased, and `<command> done <step>` of a target's release
step (`publish`, `deploy`) prints `false` while the next release has yet to
happen.

When the user asks whether a fix is out or a release is due:

1. Find the fix commit and check release tags (`git tag -l --sort=-creatordate`)
   and `splates ships list` first. If neither shows a release, report that
   there is no recorded release carrying the fix. Look up target configuration
   when the answer requires details about a configured target or a release
   outside those records.
2. Check what each relevant target has already released: its `plan`, its
   release step's `done`, and its newest release or deploy tag.
3. Run `git merge-base --is-ancestor <fix> <tag>` to see whether the fix is in
   it (the user may have shipped from the Ships page since you last looked).
4. If a target already carries the fix, it is not due: say which release
   carries it and check that the change works there.
5. If a release is due, say which targets are due, in what order (a target's
   dependency first), and what each release carries; the user ships them from
   the Ships page.

## Ship-started tasks

A task started by a ship belongs to that ship alone. Follow its mechanical
detail and the user's instructions:

- Fix what breaks and land with `splates merge`, which tells the server it is OK
  to publish. Run no ship command yourself.
- Never change the release type or bump further. The branch already holds the
  adopted pins and refresh work.
- If it cannot land, remove it with `--reason blocked` and explain why; this
  stops the ship.
- Never queue a ship's task.
- A ship's task may be a deliberate "check this upstream update for API breaks"
  chosen up front (Agent task), not only a fix after a failed adoption: either
  way fix what breaks, land with `splates merge`, and never bump further.

## Failed-step fix tasks

A board task sent from a failed step on the Ships page is that step's fix:

1. Take it as any queued task and read the run with `splates ships show <run>`
   (with `--target` and `--step` for everything the step printed).
2. Fix what made the step fail and land with `splates merge`; the ship retries
   the step automatically once the fix task ends (merged or removed), so press
   nothing, change no code for it, and start no ship.
3. To try the step before merging, `splates ships retry <run> --target <target> --step <step>`
   from your worktree runs it again in the run's own checkout, which stays on
   the commit the ship started on plus any fix that merged for it (so it shows
   whether the failure still reproduces, not whether your unmerged fix works).
4. Any agent may carry a ship the user started on that way, retrying a failed
   step and leaving findings with
   `splates ships note <run> "<text>" [--target <target> --step <step>] [--link <task or URL>]`.
   No agent may start a ship, answer its prompts, or stop it.
