---
description: Restoring a project's records from its replica and moving the splates server to another machine; bears on splates replica restore, retire and status
---

`splates replica restore`, with the server stopped, rebuilds the project's
`state.db` from the replica its config names. Moving the server is a
restore on the new machine and a `splates replica retire` on the old one.

## Restoring

- Values and joined log chunks are written as the files the records once
  were.
- They are imported through `ProjectHome.import` into a database beside
  the live one and renamed into place.
- The database is stamped with the replica's format, refused if newer than
  this splates's.
- Records already there stop it unless `--force`, which leaves them aside
  as `state.db.moved`.
- It adopts the manifest's origin through `Replicator.adopt`, so the
  server started next replicates on into the same replica.
- A bucket's creds are read from the stores, never requested.
- The roster and Auto pick rules are not in the replica.

## Moving the server

1. Checkpoint the agents.
2. Stop the server.
3. Check `splates replica status` says caught up.
4. Run `splates replica restore` on the new machine, from a checkout of the
   project whose config names the replica.
5. Start the server there.
6. Run `splates replica retire <where>` here.

Retire leaves the database aside and writes `moved.txt` beside it. That
makes any command run here refuse with `uninitialized`, saying where the
server went, until a restore here clears it.

`docker/prove-restore.sh` proves the round trip with a `dir` replica.

## Where

- `packages/server/replica/restore.ts`: restore
- `packages/server/records/home.ts`: `ProjectHome.import`, `moved.txt`
- `docker/prove-restore.sh`
