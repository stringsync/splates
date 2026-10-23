---
description: The replica, a copy of a project's records seconds behind in a bucket or folder; bears on naming one, replicating, and refusing another server's replica
---

The replica is a copy of a project's records a few seconds behind, in an
S3-compatible bucket or a folder that `splates.config.ts` names as
`replica`. It is the handoff between servers, the Mac and a Droplet, not
only a backup. So it is key-shaped and engine-neutral: it restores into
any `Storage`.

## Naming one

A project's `splates.config.ts` names its replica by provider, none by
default:

- `{ provider: "s3", endpoint, bucket, region?, prefix? }` for any store
  that speaks S3's API: DigitalOcean Spaces first, then R2, B2, Tigris,
  MinIO. It is addressed by path and signed with SigV4 over fetch, no SDK.
- `{ provider: "dir", path }` for a folder, for tests and a backup on a
  disk of the machine's own.

Nothing checked in names one store: the endpoint is wherever the config
points.

A bucket's key and secret are the creds `REPLICA_ACCESS_KEY` and
`REPLICA_SECRET_KEY`, the project's then the device's, read at each
request. The first request without them asks for both on the Creds page.
It fails until they are filled, retried with backoff up to five minutes.

## How it works

- `Replica` puts, gets, lists and deletes by key. A listing gives each
  object's size and MD5, an S3 ETag.
- `S3Replica` and `DirReplica` implement it. `FakeReplica` and `FakeS3`, a
  fake fetch checking signatures, are in `testing.ts`. All run under one
  contract suite.
- `Replicator` watches the whole project storage (`watch("", { recursive
  })`). So it hears a CLI process's writes through the database's poll,
  which is why it is a watcher and not a `Storage` wrapper.
- It gathers changed keys for three seconds from the first, and ships each
  as it stands through `Storage.copy`.
- A value ships whole at `values/<key>`.
- A log's new lines ship as one more chunk at
  `logs/<key>/<to>-<hash>.jsonl`: `to` is the line count through it,
  `hash` its last line's.
- A log that no longer begins with what was shipped, as a rotation leaves
  it, is shipped again from its first line. A rotated segment is a key of
  its own.
- `manifest.json` holds the origin, the host and when it last held every
  change.
- `replicated(key)` keeps back `creds.json`, locks and `replica.json`, on
  the way in and the way out.
- Machine state (`agents.json`, Auto pick rules) is not replicated: it is
  shared by every project on the machine.

## Catching up

On start the replicator lists the replica and diffs it against
`Storage.keys`. It ships only what differs: values by MD5, logs from their
last chunk. So changes made while the server was down catch up.

A failing replicator tries again at once when `creds.json` changes, as
when the Creds page fills the bucket's key, rather than when its backoff
ends.

## One origin a replica

The replicator only writes into an empty replica or one whose manifest
names its own origin. The origin is a random id kept in the project's
`replica.json`. A replica begun by another server is refused with an
error, since two servers writing one prefix would delete each other's
records. A restore adopts the replica's origin.

## Under the server

- Every registered project replicates from the server's start.
- A project no page has asked for is opened apart from serving.
- One project has one replicator, kept by `Replicas`; `serveProject` finds
  it running.
- The server flushes each one's last batch for up to ten seconds as it
  stops.
- `replica.json` also keeps the status as of the last batch, which
  `splates replica status` prints with the server stopped or not.
- Setup's Replica area says the same on the page, live from the running
  replicator: naming one, the bucket's creds, and where it stands, a
  failure as the step's warning.

Restoring and moving the server are in
[replica-restore.md](replica-restore.md).

## Where

- `packages/server/replica/`: `Replica`, `S3Replica`, `DirReplica`,
  `Replicator`
- `packages/server/replica/testing.ts`: `FakeReplica`, `FakeS3`
- `packages/server/replica/shipped.ts`: `replicated`
- `packages/server/server/replicas.ts`: `Replicas`
- `packages/server/setup/area-replica.ts`: Setup's Replica area
