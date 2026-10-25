---
description: One page shows every registered project; ?project= picks the focused one, EverywhereFeed reads the rest read-only, and the sidebar's folders are those per-project groups
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

Both lists hold a placeholder until the first listing of every project is in:
drawn flat and then moved into folders as it came, their rows would jump
and remount under a click.

The sidebar and inbox show folders only for projects with visible
conversations, including the focused project only when it has some. Archiving
the last conversation hides its folder; unarchiving brings it back. Both lists offer Add a project and Remove project; removal uses the
existing forget API, keeping files and conversation history and refusing while
conversations are under way.

The sidebar's folders (`project-folders.ts`) are these per-project groups.
Each lists pinned, working, and the rest, each newest first. Automations
(persistent agents such as the groomer, and each run of an agent hook,
marked by its conversation's `automation`; see `automated` in
`conversation-rows.ts`) sit among them, set apart only by a bolt for their
mark, and leave the list once archived: a persistent agent's run archives
itself as it ends, so the groomer shows only while a run is open. The phone inbox pulls waiting-on-
you rows from every project into one Needs you group; desktop has no inbox,
showing the new-conversation home with no conversation open and one line
atop the agents counting those waiting on you.
