# arbor becomes Spinning Plates

arbor leaves webappwiz as its own product, **Spinning Plates**, and stays
open source. Nothing is sold now. The design keeps one door open: should
it ever earn money, it would do so the way Zed does, every line of code
public and only the running service sold, hosted workers and a hosted
coordinator, never a feature held back.

Each todo in the Spinning Plates lane points here. Decisions marked
*settled* were made with the user; those under *Open* are asked when their
todo starts, never decided by the agent alone.

## Name and owner (settled)

- Product: Spinning Plates, at spinningplates.tech.
- Command and repo: `splates`, short for spinningplates and free on npm,
  GitHub and Homebrew. `spin` is taken (Fermyon), and `plates`, `sp` and
  `spl` are too common; a user who wants two letters aliases it.
- Owner: the stringsync LLC. The repo is `stringsync/splates`, public; the
  package is `splates`, unscoped so `bunx splates` runs it with nothing
  installed, and its bin is `splates` too. The LLC owns the
  product, sells the service, and holds the right to relicense.
- Only `packages/arbor`, `skills/arbor` and `evals/arbor-skill` move;
  the rest of webappwiz stays in webappwiz.

## Open core, the Zed way (settled)

Selling compute is an option kept open, not a product being built. Nothing
here is built for it now; the work only avoids closing it off.

What holds now:

- **All code is public**: the CLI, the page, the coordinator, the worker
  protocol, `worker run`, every `WorkerProvider`, the Pulumi programs.
- **Self-hosting is the product**: home workers, your own Pulumi stack,
  your own coordinator, all documented and none hobbled, as arbor already
  works fully without the `arbor dev` harness.
- **Seams that keep the option**: `WorkerProvider` assumes nothing of where
  the cloud credentials live or where Pulumi runs (#288), so a provider
  could call a remote API instead; the Pulumi programs hold nothing only one
  operator runs (#289, #295); public code never depends on anything private.
- **The right to relicense**: the LLC holds every copyright, kept by a CLA
  before outside contributions (#310).

What it would look like, if the user chooses to sell (not planned):

- Cloud workers by the hour and an always-on hosted coordinator, run by
  stringsync from spinningplates.tech; "Add cloud workers" on the Workers
  page signs in and machines appear, as Zed's editor signs in to its own
  servers, with self-hosting beside it.
- Only operations would be private: API keys, Pulumi state, billing
  credentials and deploy config, in a secret store, never a repo. Prices
  and margins would live with the business, not in this repo.

## Leaving webappwiz (settled)

1. **Cut webappwiz's dependency on arbor** while still in one repo, so a
   public package never needs splates: `@webappwiz/cli` imports
   `@webappwiz/arbor/skills` and `@webappwiz/arbor/update`, and `wiz`
   imports `@webappwiz/arbor/heavy` and ships `skills/arbor`. What both
   need moves into `webappwiz` or `@webappwiz/cli`; the dependency then runs
   one way, splates on webappwiz from npm. Done: `ProjectSkills` is
   `webappwiz/skills`, the slots `HeavyJobs` in `webappwiz/system`;
   `webappwiz update` tells a project with the arbor skill to run
   `arbor update`; `packages/wiz/arbor.ts` holds what `wiz ship` and
   `wiz eval` do for arbor, and `packages/wiz/heavy.ts` reads arbor's slot
   names without importing it.
2. **Extract with history** into `stringsync/splates` with
   `git filter-repo`, keeping the three paths, `packages/arbor` at the
   root. The repo setup comes along (biome, tsconfig, scry config and the
   rules that apply, `bin/`, setup), and `webappwiz: workspace:*` becomes a
   version range. In-flight arbor tasks land first.
3. **Rename** in the new repo, so webappwiz's tasks never rebase over it:
   the command, the package, `arbor.config.ts`, `~/.arbor` and
   `.git/arbor`, `ARBOR_*`, `ARBOR.md`, the `[ARBOR …]` directives and the
   skill, with a one-time migration of existing projects (the global
   server already migrates older records forward).
4. **Retire `@webappwiz/arbor`**: `npm deprecate` it pointing at
   `splates` (npm allows unpublishing only in the first 72
   hours), remove the three paths from webappwiz, and use splates there as
   a dev tool installed on the machine, not a dependency, so webappwiz
   installs and passes CI for anyone without it.

webappwiz's public history keeps arbor; it was MIT, and rewriting the
history takes nothing back. Versions published so far stay MIT.

## Licensing

Versions up to 0.0.44 are MIT and stay so. The LLC can relicense new ones
while it is the only copyright holder, so a CLA (or a DCO with a
relicensing clause) comes before the first outside contribution. Zed keeps
its editor GPL and its server AGPL, so no one can host a closed fork of
the service.

## Open

Asked when their todo starts:

- License of the new repo: MIT throughout, or the coordinator and service
  under AGPL with the CLI and worker MIT (extraction todo).
- Whether the rename reaches `ARBOR.md`, the `[ARBOR …]` directives and the
  state directories, or only the command and package (rename todo).
- CLA or DCO, and which tool (CLA todo).

Not asked until the user chooses to sell: how a hosted service charges,
accounts and billing, and whether a hosted coordinator is a box per
customer or shared.
