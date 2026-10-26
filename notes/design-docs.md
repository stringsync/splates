---
description: What the design records under designs/ are, how settled each is, and why to read their dates before trusting a decision
---

`designs/` holds design records whose settled decisions were made with the
user, not live documentation; each marks what is settled and what is open.
A design is updated as its lane lands (dated "built" paragraphs), so read the
dates: a settled paragraph may have been superseded by a later one.

## The records

- `splates.md`: arbor left webappwiz to become Spinning Plates, MIT and open
  source under the stringsync LLC, every line public. Hosted workers and a
  hosted coordinator were the only thing that could ever be sold, never a
  held-back feature; hence the CLA.
- `worker-pool.md`: a short record of `splates server` split into a
  coordinator and dial-out workers that ran agents, and what stays of it
  (the local worker and protocol). On 2026-10-22 only this machine was to
  run agents, cloud boxes coming back as runners for tests and installs; that was
  superseded on 2026-10-23 when remote workers and runners were removed
  entirely.
- `simplify.md` ("One task, one queue"): todos, lane orchestrators and
  handoffs replaced by tasks moving through stages, a dependency-ordered
  queue workers take from, and hooks on events. Its "agents never start
  agents" is now enforced.
- `opencode-acp.md`: the opt-in OpenCode plan, partly historical, its
  evidence synthetic.
- `resource-scheduler.md`: the 2026-10-25 decision to replace the premerge
  lock, the suite grants and the run-command card for load with a batch job
  scheduler in `splates server` (`packages/server/jobs/`), modelled on
  HyperQueue with Slurm's backfill and preemption, after a search found no
  library for it; lane 83 carries it out.
- `runners-leave-the-product.md`: the 2026-10-22 decision to remove product
  runners, followed by the 2026-10-23 decision to remove them from
  `splates dev` too. Runner provisioning and billing, remote workers, images
  and proofs are gone. Work that needs the machine waits its turn as a job (see
  `resource-scheduler.md`); the merge gate runs here.
