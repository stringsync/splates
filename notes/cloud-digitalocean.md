---
description: Why DigitalOcean is the cloud runners are made in, behind the CloudProvider seam, what a runner is and costs, and how DigitalOcean bills it
---

Clouds went Hetzner (2026-10-17), DigitalOcean beside it (10-19), AWS alone
(10-21), then back to DigitalOcean alone (2026-10-22): a box is one API call
to make and one to delete with nothing attached that can get stuck, which
is what AWS and Pulumi did. No Pulumi or other orchestrator: splates calls
the API itself, since it scales runners up and down on its own.

`CloudProvider` (`packages/server/cloud/provider.ts`) stays the seam with
`DigitalOceanCloud` its only implementation, and `CloudWorkers` makes it a
`WorkerProvider`. A provider finds what it made by tags (bare names in
DigitalOcean, so a tag `key:value` is kept as `key` and `key:value`) and
keeps no state of its own. It makes runners only: no coordinator box, backups,
SSH keys, firewalls or spot. The token is the device cred `DIGITALOCEAN_TOKEN`
(setup step `cloud-token`); the same cred pulls invoices into the spend
ledger (`spend/adapters.ts`).

A runner is `c-16`, CPU-Optimized dedicated, 16 vCPU and 32 GB, $0.50 an
hour at list ($336 a month), picked for 3 jobs of about 7 cores and 7 GB at
once (Basic stops at 8 vCPU; General Purpose 16 vCPU has 64 GB). The type
and its hourly price are recorded on each runner's record when made.

Billing is per second with a minute at least (bundled droplets also cap at
672 hours a month), so `billing: "second"`: an idle runner is destroyed as
soon as it is idle, with no paid hour to wait out. Sizes and stock are read
from `/v2/sizes`; the price above is the list price, not read from the API.

No vendor lock-in: only `cloud/digitalocean*.ts`, `machineCloud` (the one
place that picks the cloud) and the spend adapter name DigitalOcean. Setup,
`CloudWorkers`, the scheduler and provisioning go through `CloudProvider`
and `WorkerProvider`, and read the token's cred, label and help from
`CloudProvider.token`; another cloud is a new `CloudProvider` and a billing
adapter, or a `workerProvider` of your own in `splates.config.ts`.
