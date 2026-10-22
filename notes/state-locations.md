---
description: Where splates keeps its state (per project in a SQLite database under ~/.splates/projects/<id>, per machine under ~/.splates), why none of it is in the working tree, and the Storage interface it all goes through
---

Splates state never lives in the working tree or on a branch. A project's
records are one SQLite database, `~/.splates/projects/<id>/state.db` (under
`SPLATES_HOME` when set), opened as `SqliteStorage`; the `<id>` is kept in
`projects.json` under `ids`, against the checkout's path, and survives
`splates forget`. The server owning the records rather than the checkout is
what lets it run on the Mac or a cloud box: the clone there is a disposable
cache and `~/.splates` the one directory that matters. Keys, as they were
files: `tasks/<N>.md` (JSON front matter and a markdown body), `tasks/last`,
the journal `log.jsonl` and its rotated segments under `log/`,
`plans/<task>.md`, `finished/`, `conversations/<id>.jsonl`, `hooks.json`,
`creds.json`, `note-uses.jsonl` and `format` (the records' format number).
Beside the database sit `merge.lock`, `imports/` and the `state.db.files/`
cache `materialize` copies a record or blob into when an agent must open it
as a file (attachments, a conversation's log).

Records used to be files under `<repo>/.git/splates`. The last step of
`MIGRATIONS` (`TO_SQLITE`, see records-format-migrations) copies them in on
first open and `.git/splates` is left aside as `.git/splates.moved`; nothing
reads it again.

Machine-wide state is under `~/.splates`, or `SPLATES_HOME` (tests set it):
`agents.json` (the roster), `projects.json`, `auto-pick.json`, `spend.jsonl`,
`adherence.jsonl`, `slots/`, `tunnel.json`, `worker.sock`, `coordinator/`.
These stay files, through `FsStorage.ofMachine`.

Everything goes through `Storage` (`packages/server/storage/`): `document`,
`log`, `collection`, `lock`, `watch`, keyed by `/`-separated paths that keep
their extension, so `FsStorage` maps onto file names and stands in for
machine files and tests. `SqliteStorage` (`storage/sqlite.ts`, on
`bun:sqlite`), proved by the same contract suite, keeps documents and a
collection's records and blobs as rows in `kv`, a log one row per entry owned
by its key until rotated into a segment's, locks as rows judged stale by pid
or age, and watches told at once of this process's writes and by a poll of a
`changes` table of another's. `Testing` (`packages/server/testing.ts`) opens
a real `SqliteStorage` per test project; `Testing.legacyRecords()` reads the
old files, for the tests of the file migrations.
