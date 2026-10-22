# Moving splates state

Splates keeps nothing in the working tree: a project's tasks, lanes, plans,
conversations and hooks are under `.git/splates`, and the agent roster and
Auto pick rules under `~/.splates`, so a clone or a push carries none of it.
When the user asks to move that state to another machine or project, back it
up, or bring it back, use `splates config`, never a copy of those
directories, which takes along locks, leases and paths of this machine.
The `splates server` page does the same from Setup, under "Move to another
machine": point a user who has the page open there rather than running it
for them, since it downloads the file to their device and imports while the
server runs.

## Export

```sh
splates config export ~/splates-<project>.json
```

Give it a file: conversations make the export large, too large for stdout.
`splates config --help` lists what goes in and what stays behind. No cred's
value goes, only each one agents asked for, with what for and how to get it:
tell the user the import asks for them again on the new machine's Creds page,
and that the export holds their conversations, so it is theirs to carry, not
something to commit or send anywhere.

## Import

On the machine or in the project that takes it, from its main tree:

1. Ask the user to stop `splates server` there, which rewrites the settings
   it holds and would undo the import.
2. `splates config import <file>`.
3. When it stops on `exists`, it names each file here that differs from the
   export. Show the user the list and ask before running it again with
   `--force`, which overwrites them: tasks, plans and conversations of the
   same names here are lost.
4. When it names creds it requested, tell the user to fill them on the Creds
   page, each with the instructions it was first asked with, once
   `splates server` runs.
5. Ask the user to start `splates server` again.

The export holds task records, not their worktrees or branches, so a task
open when it was made has nothing checked out on the other side. Before
exporting, ask the user whether to land or remove the open ones first.
