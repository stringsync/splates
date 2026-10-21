---
description: Where splates keeps its state (per project under .git/splates, per machine under ~/.splates), why none of it is in the working tree, and the Storage interface it all goes through
---

Splates state never lives in the working tree or on a branch. A project's
records are under `<repo>/.git/splates/`: in the shared `.git`, so every
worktree sees a change at once and there is nothing to commit. There:
`tasks/<N>.md` (one file per task, JSON front matter and a markdown body),
`tasks/last`, the journal `log.jsonl` and its rotated segments in `log/`,
`plans/<task>.md`, `finished/` (the last SPLATES.md of each ended task with
how it ended), `conversations/<id>.jsonl`, `hooks.json`, `creds.json`,
`note-uses.jsonl` and `format`.

Machine-wide state is under `~/.splates`, or `SPLATES_HOME` (tests set it):
`agents.json` (the roster), `projects.json`, `auto-pick.json`, `spend.jsonl`,
`adherence.jsonl`, `slots/`, `tunnel.json`, `worker.sock`, `coordinator/`.

Everything goes through `Storage` (`packages/server/storage/`): `document`,
`log`, `collection`, `lock`, `watch`, keyed by `/`-separated paths that keep
their extension, so `FsStorage` maps onto the old file names and
`MemoryStorage` stands in for tests. Writes go to a temp file renamed into
place, and logs are JSON lines that survive a torn last line.
