---
description: `splates config export/import` moves a project's hooks, tasks, plans and conversations plus the person's agent settings as one JSON file, with the creds to ask for again but never their values, and stops on files that differ unless --force
---

`packages/server/transfer/` reads an allowlist of files (`PROJECT_STATE` under
`.git/splates`, `MACHINE_STATE` under the splates home) into one bundle and
writes them back. `creds.json` and `.lock` paths are refused on both ends, so a
hand-edited bundle cannot plant one. The registry (`projects.json`), journal,
spend and workers stay behind: they name this machine. Adding a state file to
the move means adding it to the allowlist, and nothing else.

The bundle's `creds` names each cred the project's agents asked for and the
person did not dismiss, with its scope, purpose and instructions, never a
value; `askAgain` opens a request for each the new machine's stores do not
keep, so the Creds page lists what to fill. A saved request stays in
`creds.json`, so a kept cred's How shows how it was got.

Agents learn the workflow from `skills/splates/references/transfer.md`, which
SKILL.md points to in one line under "only when their moment comes", so the
skill's main file says nothing more of it. An import runs with
`splates server` stopped: the server caches files such as `offered.json` and
would write its copy back over the import.
