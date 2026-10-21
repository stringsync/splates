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
streams only while something holds it.

The sidebar's folders (`project-folders.ts`) are these per-project groups:
persistent agents (automations such as the groomer, above a rule) first,
then pinned, then working, then the rest. The phone inbox pulls waiting-on-
you rows from every project into one Needs you group; desktop has no inbox,
showing the new-conversation home with no conversation open and one line
atop the agents counting those waiting on you.
