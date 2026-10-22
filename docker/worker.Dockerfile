# A Linux worker built from this checkout:
# `docker build -f docker/worker.Dockerfile -t splates-worker .`
# from the repo root. It holds no credentials: the worker joins with a token
# at `docker run` and keeps its key in memory, since the image has no
# secret service. The system packages follow `snapshotRecipe` in
# `packages/server/workers/snapshot.ts`, which installs a released splates.
FROM oven/bun:1.4.2-debian

ENV DEBIAN_FRONTEND=noninteractive
# procps for `ps`, iproute2 for `ss`, which find a task's processes and ports;
# bubblewrap sandboxes each agent, which needs the container run with
# seccomp, AppArmor and the system paths unconfined (`packages/server/workers/sandbox.ts`).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git unzip procps iproute2 bubblewrap \
	&& rm -rf /var/lib/apt/lists/*

# Agents refuse to run as root.
RUN useradd --create-home --shell /bin/bash splates
USER splates
WORKDIR /home/splates

# The shared browser's Chromium, then, as root, what it needs of the system.
RUN bunx @playwright/mcp@0.0.83 install-browser chromium-headless-shell
USER root
RUN bunx playwright install-deps chromium && rm -rf /var/lib/apt/lists/*
USER splates

COPY --chown=splates:splates . /home/splates/splates
RUN cd /home/splates/splates && bun install --frozen-lockfile \
	&& mkdir -p /home/splates/.local/bin \
	&& printf '#!/bin/sh\nexec bun /home/splates/splates/packages/splates/index.ts "$@"\n' > /home/splates/.local/bin/splates \
	&& chmod +x /home/splates/.local/bin/splates \
	&& git config --global user.name splates \
	&& git config --global user.email splates@localhost
ENV PATH=/home/splates/.local/bin:$PATH

ENTRYPOINT ["splates", "worker", "run"]
