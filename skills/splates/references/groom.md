# Grooming tasks

`[SPLATES GROOM #N]` comes from `splates server`: an agent added task N from
its task and moved on, leaving its calls to you, the project's groomer.
You work in the main tree, change no code and start no task: each task is
a few `splates` commands, then your turn ends. splates tells you of each
task added from then on, one directive each, queued behind your turn while
it runs, so take every one a message names.

For each:

1. `splates task show N`. When it is gone, taken, or already in a lane,
   someone made its calls first: leave it.
2. **One that already asks it.** Scan `splates task list` by subject, and
   `splates task show` those that look like the same request. When an open
   one asks it, fold what N adds into that one's detail (`splates task
   update <id> '<detail>'` replaces it, so pass all of it), then `splates
   task remove N`, and you are done with N. One only near it is a link, at
   step 4.
3. **Choose its lane** as Lanes in [queue.md](queue.md) says: read
   `splates lane list`, then the lane whose work it builds on, a new lane
   (`splates lane add '<name>'`) when it starts a chain, or none, leaving it
   untriaged. Tasks that change the same files go in one lane, so their
   agents never fight over rebases.
4. **Link what blocks it**, read from `splates list --files` and the
   lane's other tasks: `splates task update N --blocked-by <id>` when it
   needs another task's code or data, or would change files another task
   changes, or a started task changes, linking it by the queued task that one took.
   Link a task that needs N's code by N the same way. Never link for
   priority.
5. **Move it in and name its model**, last and in one `splates task update
   N --lane <n> --agent <a> --model <m>`, since a running lane starts a
   task as soon as it holds one that names an agent and nothing blocks.
   Keep the agent and model the adding agent named, if it named them;
   otherwise `splates agents` lists each model's strengths and cost: pick
   the cheapest whose strengths cover the task as its detail stands,
   weighing it as Handing on work another model fits better in
   [handoff.md](handoff.md) does, with `--effort <level>` only when it
   needs a thinking level other than the agent's own. Left untriaged, name
   them all the same, without `--lane`. It goes to the bottom of the lane;
   a position is the user's, so leave it there.

Make every call a revert would undo yourself. When N asks the opposite of
another task, or undoes a task under way, leave it untriaged, name no
agent, and ask the user which wins, as numbered questions in your reply. A
lane's orchestrator that works the lane you put N in hears of it and may
change what you chose: let it.

Reply with one line per task on where it went, such as `#12: lane 3 Stats,
after #9, claude sonnet` or `#13: folded into #8`, and nothing more, then
end your turn. Never wait, sleep or poll for the next task: splates tells
you.
