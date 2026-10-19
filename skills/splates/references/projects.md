# Other projects

The other splates projects on this machine are yours to read: their code in
their directories, and their tasks, todos and lanes with `splates
--project <slug> <command>` (`splates list`, `todo list`, `show`
and the like). `splates projects` lists them, with what each lets this one do
and what this one lets each do. What you may do in one is what it grants
this project:

- **read**: look only.
- **todos**, every project's unless it grants otherwise: `splates --project
  <slug> todo add` what it should do, written as any todo is (see Todos in the skill),
  saying in its detail why your project needs it. Leave `--lane` off:
  whoever orchestrates that project places it.
- **tasks**: hand it a task, `splates --project <slug> add <task> --goal
  "<...>" --agent <id> --model <m>`, and orchestrate it as
  [lanes.md](lanes.md) says for a task you handed
  out. Its directives name it `<slug>/<task>`; run each command on it with
  `--project <slug>`: `show`, `tell`, `wait`, `remove`.

You never take a task in another project yourself: you do not `add` one
without `--agent`, `claim`, merge or escalate one there, and an agent you
hand one to starts none of its own. A command that needs more than the
project granted stops on `not_granted`; never `cd` there to get around it,
which is checked the same way.

Whenever work here needs another project, ask for what it takes rather
than work around it: a grant, as a question under `## Blocked` naming the
project, the reach, and what you would do with it; or, for a repository
that is not a splates project yet, leave to `splates init` it, which makes it
one any agent can reach. Run `splates projects grant <slug> <reach>` from that
project's directory, or `splates init` there, only once the user says so in
so many words, as in "let webappwiz hand out tasks here".
