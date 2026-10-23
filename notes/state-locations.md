---
description: Where splates keeps its state, per project and per machine under ~/.splates and never in the working tree; read before adding or moving any stored record
---

Splates state never lives in the working tree or on a branch. A project's
records are one SQLite database under `~/.splates/projects/<id>/`, and
machine-wide state is files under `~/.splates`. Everything goes through the
`Storage` interface.

## Per project

The records are `~/.splates/projects/<id>/state.db`, under `SPLATES_HOME`
when set, opened as `SqliteStorage`. The `<id>` is kept in `projects.json`
under `ids`, against the checkout's path, and survives `splates forget`.

The server owns the records rather than the checkout. That is what lets it
run on the Mac or a cloud box: the clone there is a disposable cache, and
`~/.splates` is the one directory that matters.

Keys, named as they were when they were files:

- `tasks/<N>.md`: JSON front matter and a markdown body
- `tasks/last`
- `log.jsonl`, the journal, and its rotated segments under `log/`
- `plans/<task>.md`
- `finished/`
- `conversations/<id>.jsonl`
- `hooks.json`
- `creds.json`
- `note-uses.jsonl`
- `replica.json`: the replica's origin and status (see replica)
- `format`: the records' format number

Beside the database sit `merge.lock` and the `state.db.files/` cache.
`materialize` copies a record or blob into that cache when an agent must
open it as a file, such as attachments or a conversation's log.

## Per machine

Machine-wide state is under `~/.splates`, or `SPLATES_HOME`, which tests
set. It stays files, through `FsStorage.ofMachine`. Among them:

- `agents.json`, the roster
- `projects.json`
- `auto-pick.json`
- `spend.jsonl`
- `adherence.jsonl`
- `slots/`
- `tunnel.json`
- `worker.sock`
- `server.log` and `server-supervisor.log`: timestamped server diagnostics and
  supervisor exit/restart reasons, kept separately so they never rotate the same file
- `worker.log`: the worker's joins, disconnects and process lifecycle

Each diagnostic log rotates at 1 MiB, retaining the preceding file as `.1`.
A delayed server event loop is logged once it runs again, so a heartbeat
timeout can be distinguished from a session or process failure.

## The Storage interface

`Storage` offers `document`, `log`, `collection`, `lock` and `watch`, and
`keys` and `copy` for a replica. Keys are `/`-separated paths that keep
their extension. So `FsStorage` maps onto file names, and stands in for
machine files and tests.

`SqliteStorage`, on `bun:sqlite`, passes the same contract suite. It keeps:

- documents, and a collection's records and blobs, as rows in `kv`
- a log as one row per entry, owned by its key until rotated into a
  segment's
- locks as rows, judged stale by pid or age
- watches, told at once of this process's writes, and of another's by a
  poll of a `changes` table

`Testing` opens a real `SqliteStorage` per test project.
`Testing.legacyRecords()` reads the old files, for the tests of the file
migrations.

## Before SQLite

Records used to be files under `<repo>/.git/splates`. The last step of
`MIGRATIONS`, `TO_SQLITE` (see records-format-migrations), copies them in on
first open. `.git/splates` is left aside as `.git/splates.moved`, and
nothing reads it again.

## Where

- `packages/server/storage/`: `Storage`, `FsStorage`
- `packages/server/storage/sqlite.ts`: `SqliteStorage`
- `packages/server/records/to-sqlite.ts`: `TO_SQLITE`
- `packages/server/projects/projects.ts`: `projects.json` and its `ids`
- `packages/server/testing.ts`: `Testing`
