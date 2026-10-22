---
description: The replica is a copy of a project's records a few seconds behind, in an S3-compatible bucket or a folder named as `replica` in splates.config.ts; how the Replicator batches, lays out and catches up, and why it refuses another server's replica
---

A project's `splates.config.ts` names its replica by provider, none by
default: `{ provider: "s3", endpoint, bucket, region?, prefix? }` for any
store that speaks S3's API (DigitalOcean Spaces first, then R2, B2, Tigris,
MinIO; addressed by path, signed with SigV4 over fetch, no SDK), or
`{ provider: "dir", path }` for a folder, for tests and a backup on a disk of
the machine's own. Nothing checked in names one store: the endpoint is
wherever the config points. A bucket's key and secret are the creds
`REPLICA_ACCESS_KEY` and `REPLICA_SECRET_KEY`, the project's then the
device's, read at each request; the first request without them asks for both
on the Creds page and fails until they are filled, retried with backoff up
to five minutes.

The replica is the handoff between servers, the Mac and a Droplet, not only
a backup, so it is key-shaped and engine-neutral: it restores into any
`Storage`. `packages/server/replica/`:

- `Replica`: put, get, list (with each object's size and MD5, an S3 ETag)
  and delete by key. `S3Replica`, `DirReplica`, and `FakeReplica` and
  `FakeS3` (a fake fetch checking signatures) in `testing.ts`, under one
  contract suite.
- `Replicator` watches the whole project storage (`watch("", { recursive })`,
  so it hears a CLI process's writes through the database's poll, which is
  why it is a watcher and not a `Storage` wrapper), gathers changed keys for
  three seconds from the first, and ships each as it stands through
  `Storage.copy`: a value whole at `values/<key>`, a log's new lines as one
  more chunk at `logs/<key>/<to>-<hash>.jsonl` (`to` the line count through
  it, `hash` its last line's). A log that no longer begins with what was
  shipped, as a rotation leaves it, is shipped again from its first line;
  a rotated segment is a key of its own. `manifest.json` holds the origin,
  the host and when it last held every change.
- `replicated(key)` keeps back `creds.json`, locks and `replica.json`, on the
  way in and the way out, as `config export` does.

On start it lists the replica and diffs it against `Storage.keys`, shipping
only what differs (values by MD5, logs from their last chunk), so changes
made while the server was down catch up. It only writes into an empty
replica or one whose manifest names its own origin, a random id kept in the
project's `replica.json`; one begun by another server is refused with an
error, since two servers writing one prefix would delete each other's
records. A restore (task #992) adopts the replica's origin.

Every served project replicates (`serveProject`), flushing its last batch
for up to ten seconds as the server stops. `replica.json` also keeps the
status as of the last batch, which `splates replica status` prints with the
server stopped or not. Machine state (`agents.json`, Auto pick rules) is not
replicated: it is shared by every project on the machine.
