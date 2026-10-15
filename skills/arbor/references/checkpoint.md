# Checkpoint

`[ARBOR CHECKPOINT]`, sent by the `arbor dev` page, means your process is
about to stop, as for a restart, and the next prompt picks the work up. Stop
where you are and start nothing new:

1. Leave a step you are in the middle of as it is, unless it is an `arbor
   merge`: finish that first.
2. Bring `ARBOR.md` up to date: `## Done` and `## Next` as they stand, each
   open question under `## Blocked`, and under `## Notes` what you were doing
   when stopped and what comes next. With no task, there is no `ARBOR.md`.
3. Reply with one line on where you stand, and end your turn.

`[ARBOR RESUME]`, sent after a checkpoint, means carry on: read `ARBOR.md`
again and go on from where `## Notes` says you stopped. With no task, carry on
with what you were asked; a lane orchestrator reads `arbor lane show` for each
lane again first, since its tasks may have moved on without it.
