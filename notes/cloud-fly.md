---
description: What a spike on 2026-10-22 measured of Fly Machines as runners (boot, image, suite and stop/start times, rootfs and auto_destroy behavior) and what it points to for the move off DigitalOcean
---

The person asked (2026-10-22) to try Fly.io for runners in place of
DigitalOcean (`cloud-digitalocean.md`), and to remove DigitalOcean rather
than keep both. Before any code moved, a spike measured Fly Machines by hand
from this Mac with a throwaway app, through the Machines API
(`https://api.machines.dev/v1`) and Fly's GraphQL API for the app's IPs, the
token read from the device cred `FLY_API_TOKEN`. Every machine and the app
were destroyed after.

## What was measured

The runner image was a slim one, not `docker/worker.Dockerfile`: `oven/bun`
Debian, git, curl, a `splates` user, bun's cache warmed from this checkout's
lockfile, and a small bun HTTP server on 8080 that runs a command and streams
its output; 241 MB. A job needs bun and git, not splates or Chromium.

- **Image**: `docker buildx build --platform linux/amd64` on this arm64 Mac
  took about 60 s cold and 18 s with layers cached; `docker push` to
  `registry.fly.io` took 45 s.
- **Cold start**, `POST /apps/{app}/machines` to the machine answering through
  the proxy at `<app>.fly.dev` with `fly-force-instance-id`: 13 s and 15 s
  for the first two machines (create itself 1.4 to 1.7 s), 20 to 24 s for two
  made later. DigitalOcean took 80 s from a snapshot and 2.5 minutes from
  stock.
- **Clone and `prepare`** (`bun install --frozen-lockfile --ignore-scripts`
  and the page build) on a fresh machine: 46 s on `shared-cpu-4x`, 21 s on
  `performance-4x`; a second `bun install` 16 ms.
- **The suite** (`splates dev test --local`, 1284 tests): bun's own time
  **88 s on `shared-cpu-4x` 8 GB** (2m10 wall) and 112 s on `performance-4x`
  8 GB (2m37 wall), run twice each with the same ordering. Shared was faster
  both times, so it is the size to default to; a DigitalOcean `s-4vcpu-8gb`
  ran the same suite in about 4 minutes wall. The one failing test was the
  WorkerDaemon pty flake already on the board (#1041), on the performance
  machine only.
- **Streaming through the proxy** held for the whole 2.5-minute run with the
  first byte at once; `fly-force-instance-id` routed every request to the
  machine named. With a stopped or destroyed machine it answers 502 or 503.
- **Stop and start**: `POST .../stop` to `stopped` in 0.8 to 1.5 s,
  `POST .../start` to `started` in 1.5 s, the machine serving again at once.
- **`auto_destroy: true` destroys the machine on stop too**: the first
  measured machine was gone after a stop. So a machine that may be stopped and
  kept must be made without it, and something else destroys it.
- **The root filesystem is reset by default**: after stop and start, a file
  written at `~` was gone and `/proc/uptime` said a fresh boot. With
  `guest.persist_rootfs: "restart"` in the create request the file survived a
  stop and start. Fly says it may still be wiped for maintenance, so a kept
  clone or bun cache is a speed-up, never state.
- The Machines API's `wait` takes a timeout of at most 60 s; `region` was
  `ewr`. The GraphQL `allocateIpAddress` with `shared_v4` answered null but
  the `fly.dev` name resolved and served HTTPS, with the `v6` allocated beside
  it.

## What it points to, pending the design talk

- Boot from a registry image (the released worker image, slim, built in a
  release step; a server from a checkout layers its own build at boot as
  `OwnBuild` does), no snapshot builder, no cloud-init: `userData` becomes the
  machine's `env` and `init`.
- The runner serves the pool's job channel over HTTPS behind Fly's proxy,
  reached by the server and by `splates run` alike with the machine's id in
  `fly-force-instance-id` and a per-machine bearer secret in its env, so
  runners never dial in and need no Cloudflare Access service token; SSH, the
  runner key and the `direct*` scripts go.
- Idle runners exit, and `auto_destroy` takes them; a warm runner is a
  machine made without `auto_destroy` and `persist_rootfs: "restart"`,
  stopped between uses (a stopped machine bills only its rootfs) and started
  in 1.5 s, destroyed by the keeper past its warm window.
- Sizes are a table (`shared-cpu-Nx`, `performance-Nx`, memory in GB) with
  Fly's list prices; `shared-cpu-4x` 8 GB is the default job's size.
- A Fly deploy token scoped to the runners' app is all splates needs, so the
  delete-only token question of the DigitalOcean watchdog does not arise.
