---
description: Why DigitalOcean is the cloud runners are made in, behind the CloudProvider seam, how a runner's size is picked from CPUs and memory, sizes an account may not order, and how DigitalOcean bills it
---

This describes the legacy DigitalOcean runner path, still selected by this
repository until the Fly transport lands. `notes/cloud-fly.md` covers the
replacement. Setup's `cloud-token` step now requests `FLY_API_TOKEN`; existing
DigitalOcean runners continue reading the already-kept `DIGITALOCEAN_TOKEN`.
The box-shaped `CloudProvider` is only for that legacy path, not a seam Fly
implements.

Clouds went Hetzner (2026-10-17), DigitalOcean beside it (10-19), AWS alone
(10-21), then back to DigitalOcean alone (2026-10-22): a box is one API call
to make and one to delete with nothing attached that can get stuck, which
is what AWS and Pulumi did. No Pulumi or other orchestrator: splates calls
the API itself, since it scales runners up and down on its own.

`CloudProvider` (`packages/server/cloud/provider.ts`) is the legacy seam with
`DigitalOceanCloud` its only implementation, and `CloudWorkers` makes it a
`WorkerProvider`. A provider finds what it made by tags (bare names in
DigitalOcean, so a tag `key:value` is kept as `key` and `key:value`) and
keeps no state of its own. It makes runners only: no coordinator box, backups,
firewalls or spot. Every droplet is made with one account SSH key,
`splates-runners`, found by name or made on first use from a throwaway
ed25519 pair whose private half is dropped: a droplet with no key has its
root password emailed to the user. Any later provider should attach a key
for the same reason (Hetzner mails a password too). The token is the device cred `DIGITALOCEAN_TOKEN`
(previously setup step `cloud-token`); the same cred pulls invoices into the spend
ledger (`spend/adapters.ts`).

A runner's size is never named in splates: `CloudProvider.sizes` lists
each size orderable now with its CPUs, memory, disk, shared or dedicated,
hourly price and regions (DigitalOcean's `/v2/sizes`, GPU sizes left out),
and `CloudWorkers.types` offers those that hold one of the project's heavy
jobs (`job` in `splates.config.ts`, 4 CPUs and 8 GB unset), up to 16 CPUs,
shared allowed, with a disk that holds the snapshot, the cheapest first,
which is what is made: with the default job that is `s-4vcpu-8gb`, Basic
shared, about $0.07 an hour. Until 2026-10-22 the types were fixed in
`DIGITALOCEAN_DEFAULTS`, `c-16` then `s-4vcpu-8gb` with `c-4` beside it.

A new DigitalOcean account orders nothing over 4 vCPU, a limit its API
does not list. A create refused with a 422 naming the size becomes
`TypeRefused`; `CloudWorkers` leaves that size out for an hour and the
runner keeper makes the next cheapest at once, with no backoff, so a bigger
job still gets a runner once support raises the limit. A 422 naming no
size, as the droplet limit, is an ordinary failure, backed off a minute.

A run of the suite is about 7 cores and 7 GB, so 8 GB holds one. The
time from job queued to tests running on these sizes is still to measure
(see `heavy-jobs-on-runners.md`).

Runners go to New York first, then any region that stocks the type, since
a runner need not be near the person. A snapshot boots droplets only in its
own region, so the worker image is built where the cheapest runner type
would be made.

The type, its CPUs and memory and its hourly price are recorded on each
runner's record when made, and in the spend ledger for the Billing page
(see `billing-pulled-only.md`). Setup and Billing describe a runner as
"4 CPUs, 8 GB, $0.07/h" (`sizeLabel`); the size's name stays in the
ledger only as what the bill names it by.

Billing is per second with a minute at least (bundled droplets also cap at
672 hours a month), so `billing: "second"`: an idle runner is destroyed as
soon as it is idle, with no paid hour to wait out. Sizes, stock and each
size's `price_hourly` are read from `/v2/sizes`, and `CloudWorkers.types`
gives a runner the API's price, so its estimate follows what DigitalOcean
charges.

The worker snapshot costs to keep, which `/v2/sizes` does not price: the
Runners section of Billing lists it with the `size_gigabytes` that
`/v2/images` reports, at $0.06 a gigabyte a month (`WorkerProvider.images`,
`CloudProvider.snapshotCosts`). It is shown, never counted into a runner's
estimate.

