---
description: `splates config export/import` moves a project's hooks, tasks, plans and conversations plus the agent roster and Auto pick rules as one JSON file, never creds, and stops on files that differ unless --force
---

`packages/server/transfer/` reads an allowlist of files (`PROJECT_STATE` under
`.git/splates`, `MACHINE_STATE` under the splates home) into one bundle and
writes them back. `creds.json` and `.lock` paths are refused on both ends, so a
hand-edited bundle cannot plant one. The registry (`projects.json`), journal,
spend and workers stay behind: they name this machine. Adding a state file to
the move means adding it to the allowlist, and nothing else.
