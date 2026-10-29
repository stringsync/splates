# Setup journeys audit (2026-10-29)

Walked the Setup page the way a first-time user would, in a browser against
a throwaway `bin/splates server` (empty `SPLATES_HOME`, an empty git repo as
the project), at 1280px and 390px, plus a read of `packages/server/setup/area-*.ts`
and `packages/web/setup-*.tsx` for the copy. No product code changed.

Limits of the walk: no real Cloudflare, GitHub, DigitalOcean or OpenAI
account was used, so no step that needs one was completed; each step's
form, copy and error path were read instead. `claude`, `codex`, `kimi` and
OpenCode were already on this machine, so some steps showed done that a
clean machine would not (itself a finding, see 9). Findings are ranked by how
much they block a first-time user.

## Blocks a first-time user

1. **The first open has no way in.** A fresh server with no project shows a
   blank page with 404s on `/api/conversations`, `/api/snapshot` and
   `/events`; the user must already know to add a project by path. With a
   project, the Board opens with nothing pointing at Setup. (Lane 102's
   welcome screen, #2292, covers the pointer; the blank no-project page is
   not covered by it.)
2. **Four areas need hand-edited `splates.config.ts`, a task merge and a
   server restart, with no check the user can see.** Replica (`replica-place`),
   Evals (`evals-results`), GitHub pushing (`github-push`) and the Dictation
   words (a file in `~/.splates`) tell the user to edit config as prose with
   `{ provider: "s3", endpoint: ... }` snippets to copy. A first-timer without
   the terminal is stuck, the page offers only a bare Next that fails, and
   "merge it, as a task" assumes they know what that means. These steps should
   be forms that write the config (or a one-click agent task that does, shown
   as a diff), and "restart `splates server`" should be a button or go away.
3. **Claude, Codex and Kimi sign-in sends the user to a terminal.** The step
   says to run `curl -fsSL https://claude.ai/install.sh | bash` and then
   `claude` to sign in, then Next. No copy button, no hint of which terminal,
   and no live recheck; when Next fails the same text stays. It is also the
   only way to make any agent work, yet it sits last in the list of areas,
   below Evals and GitHub.
4. **GitHub pushing is 4 manual steps across two websites.** The user makes
   a GitHub App by hand with the exact permission set (Webhook off,
   Contents Read and write only), pastes the App ID, then generates a `.pem`
   and pastes the whole multi-line key into what looks like a one-line input,
   then installs the App on one repository, then builds a branch ruleset
   (`RULESET_HOW`), then edits config. GitHub's App manifest flow could make
   the App in one click; the ruleset could be created by the App's own
   permissions or at least shown as a checklist. A project with no remote
   (like this one) is not told up front that step 2 can never pass.
5. **Steps that wait on others do not explain.** Auto pick shows step 2
   done before step 1; GitHub steps 2 to 4 are numbered circles with no
   reason shown for why they are locked; the Replica area's step 2 sends the
   user off to the Creds page (`#creds`), which has the keys the same step
   needs, with no way back and no sign of which two creds to fill.

## Confusing or wrong

6. **State shown does not match the step you are on.** An already-done step
   (Claude sign-in, Workers) still shows its to-do copy ("Press Next and
   splates checks that `claude` answers...", "Make this Mac a worker",
   "Press Next: this Mac takes agents unless its worker was removed") rather
   than a done message with what it found. Opening an area jumps to its first
   not-done step, so the done ones cannot be reviewed without clicking the
   left rail.
7. **The OpenCode models step defaults silently.** Main and auxiliary model
   are preselected to `beam-free`, and the switch "Use balance is off in my
   OpenCode Console" is a promise the page cannot check, off by default, with
   Next enabled. The install step names an npm package, `@opencode/cli`, that
   should be verified against OpenCode's published package.
8. **Server on a Droplet has one step and no context.** It asks for
   Spaces keys, but does not say that the user must already have made a
   Droplet, a Space and a bucket, nor how. It is the same two creds as the
   Replica area's keys step, listed again under a different area with no
   cross-link, and it has no Undo while its sibling areas do.
9. **Checks answer from the machine, not the project.** With an empty
   `SPLATES_HOME`, OpenCode shows 2 of 4 steps done and Claude, Codex and Kimi
   all done, because the tools and creds are found on the real machine. That
   is right for the machine but the index gives no sign of what a step found
   ("signed in as ...", "claude 2.1.0"), so a user cannot tell a real done
   from a stale one.
10. **Jargon in user copy.** "dictationWords", "TunnelProvider",
    "Zero Trust team name, only if your account has none yet", "Shallow /
    Moderate", "Any certainty" (Auto pick rules), "Spaces access key",
    "splates-evals/1". Each is correct, none says what it is for.
11. **Remote access Make the tunnel has three fields and no help.** The
    Zero Trust team name field has no way to tell whether the account has
    one; the token step asks for a list of permissions in one sentence.

## Slow, ugly or inconsistent

12. **Index copy and layout.** "1 steps" (Droplet, Evals) and "2 steps"
    (Replica) read wrong when the count is one; every area is called "Set
    up X" with nothing to say what it is for or whether it is needed; there is
    no "recommended first" order, and the list puts three alternatives
    (Claude, Codex, Kimi) in the first group without saying one is enough.
    A "Busy" badge sits beside the page title with no explanation.
13. **Inconsistent chrome between areas.** One-step areas (Workers, Evals,
    Droplet) drop the left step rail and use "1 of 1" and "Finish"; the rest
    use "Next". Only areas with a stored cred or file have Undo.
    "Set it up with an agent" is on every step, but the page does not say that
    it starts a conversation and that the agent can spend tokens.
14. **Validation is blunt.** Remote access Next with empty fields returns a
    422 (console error) and shows one red line, "Fill in "Host name" first.",
    below the fields; the button turns into "Try again", which suggests a
    retry rather than fixing a field, and nothing takes focus.
15. **Every page load logs a 404 / 422 in the console** on `/api/...` while
    the project is loading (seen first with no project, then once on each
    page with a step form).
16. **Mobile works** (390px, one column, "Step 1 of 4" progress bar), but the
    GitHub and Cloudflare steps need a laptop's worth of other tabs and a
    `.pem` file, so the journeys are not really phone-doable.

## Fix groups queued

Each is one task in lane 102. See `splates list` for the current state.

- first-open page for no project, 404s on a fresh server (finding 1, 15)
- the config-editing steps as forms or agent tasks (2)
- a done step shows what it found, and the index shows why steps wait (5, 6, 9, 12)
- Claude, Codex and Kimi sign-in without a terminal, and ordering of areas (3)
- GitHub pushing through the App manifest flow (4)
- Replica and Droplet keys: one place, cross-linked (5, 8)
- copy pass: jargon, plurals, validation, one-step areas (10, 11, 12, 13, 14)
- OpenCode install name and models defaults (7)
