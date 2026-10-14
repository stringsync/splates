# Working a lane

A lane is a named, ordered queue of todos for one agent, worked top to
bottom, one task per todo. It keeps a chain of todos that build on each other
with one agent, so each step starts from the context the last one built, and
runs beside other lanes without the agents stepping on each other. Lanes are
the columns of the `arbor dev` board; a todo in none is untriaged. Agents
place the todos they add (see Lanes in `todos.md`), and the user rearranges them. Each has a number, which commands and the prompt use, and a name,
which says what its todos are for: `arbor lane list` shows both.

`[ARBOR LANE N]`, copied from the `arbor dev` page, asks you to work down
lane N. The lane is arbor's, not the prompt's, so read it from arbor each
time:

1. `arbor lane show N` prints the steps and what to do next. When it says
   the lane is done or gone, stop and say so.
2. When its next todo is blocked by a todo in another lane, `arbor todo wait
   <id>` for that one, again on `timeout`, rather than skip ahead: a lane is in
   order for reasons the board knows and you do not. When the wait ends
   because the other task is escalated, tell the user you are blocked on it
   and stop.
3. Take the next todo with `arbor add <task> --todo <id>`, and do it as any
   other task (see Workflow in `SKILL.md`), through `arbor merge`.
4. After the merge, `cd` to the main tree and go back to step 1. Report each
   merge as usual, but do not wait for the user between steps unless a task
   escalates.

Never take a todo from another lane, or one the lane has not reached; when
the user moves todos while you work, the next `lane show` has them.
