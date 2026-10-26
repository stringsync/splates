---
description: One page shows every registered project; ?project= picks the focused one, EverywhereFeed reads the rest read-only, the sidebar and inbox list one project at a time with the others one line each, and only the project's own pages wear its switcher
---

A `splates server` serves every project in `~/.splates/projects.json`. The
page's own project comes from `?project=<slug>`, or none for the project
the server started in; `ProjectApp` (`project-app.tsx`) keeps feeds per
project so switching draws at once. `EverywhereFeed` reads `/api/everywhere`
and its stream for every project's tasks and conversations, each tagged
`InProject<T>`, and is read-only: a write goes to the item's own project
through `scoped(path, slug)` and the stream brings the change back. It
streams only while something holds it. It keeps its last listing in
IndexedDB, as the project's own feeds do (web-stale-page), and a page
opened again draws its folders from that copy at once; a server that
refuses the listing takes the copy's folders off again.

The sidebar and the phone inbox list one project at a time, the same way,
from `foldersOf` (`project-folders.ts`): Needs you, the waiting-on-you rows
of every project, each naming its project; then the focused project's own,
pinned, working, then the rest, each newest first, flat but for subagents
nested under the conversation that handed them out; then Other projects,
one line for each other project with visible conversations, saying how many
are at work and waiting, that switches the page to it. Lanes do not group
rows: lanes belong to the board. Automations (persistent agents such as the
groomer, and each run of an agent hook, marked by its conversation's
`automation`; see `automated` in `conversation-rows.ts`) sit among them, set
apart only by a bolt for their mark, and leave the list once archived: a
persistent agent's run archives itself as it ends, so the groomer shows only
while a run is open. Archiving another project's last conversation drops its
line; unarchiving brings it back. The focused project shows even when empty.
Both lists offer Add a project and Remove project; removal uses the existing
forget API, keeping files and conversation history and refusing while
conversations are under way. The desktop home, with no conversation open,
is the new-conversation screen, with one line atop the sidebar's agents
counting those waiting on you.

Both lists hold a placeholder until the first listing of every project is in,
so their rows do not jump and remount under a click.

Which pages follow the project is said in one place, `scope` on `PAGES`
(`page-route.tsx`): Board, Creds, Automations and Notes are the project's,
Queue, Stats, Evals, Billing and Setup span every project. The sidebar and
the phone drawer list the project's pages under a switcher heading the
group, then the rest under Everywhere, and their heads name the server, not
a project, since the conversations under them span every project. A
project's page passes `scoped` to its `TopBar`, which then heads its title
with the project's switcher, `name ▾ / Board`, from the shell's
`TopBarFrame` `project`; a bar without it shows every project, and a pick
from it stays on the same page.
