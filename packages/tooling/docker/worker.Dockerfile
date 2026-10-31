# A Linux worker built from this checkout, with the mono root as the context:
# `docker build -f splates/packages/tooling/docker/worker.Dockerfile -t splates-worker .`
# It holds no credentials: the worker joins with a token at `docker run` and
# keeps its key in memory, since the image has no secret service.
FROM oven/bun:1.4.2-debian

ENV DEBIAN_FRONTEND=noninteractive
# procps for `ps`, iproute2 for `ss`, which find a task's processes and ports;
# bubblewrap sandboxes each agent, which needs the container run with
# seccomp, AppArmor and the system paths unconfined (`splates/packages/server/workers/sandbox.ts`).
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

# bun resolves `workspace:*` from the manifests, so every workspace package's
# package.json has to land before the install, whichever project it is in.
# --filter then installs only splates's packages and what they depend on; the
# root postinstall builds the web page, which a worker never serves.
WORKDIR /home/splates/mono
COPY --chown=splates:splates package.json bun.lock bunfig.toml ./
COPY --chown=splates:splates core/packages/core/package.json core/packages/core/
COPY --chown=splates:splates mdom/packages/cli/package.json mdom/packages/cli/
COPY --chown=splates:splates mdom/packages/e2e/package.json mdom/packages/e2e/
COPY --chown=splates:splates mdom/packages/mdom/package.json mdom/packages/mdom/
COPY --chown=splates:splates sound2score/packages/api/package.json sound2score/packages/api/
COPY --chown=splates:splates sound2score/packages/e2e/package.json sound2score/packages/e2e/
COPY --chown=splates:splates sound2score/packages/player/package.json sound2score/packages/player/
COPY --chown=splates:splates sound2score/packages/s2s/package.json sound2score/packages/s2s/
COPY --chown=splates:splates sound2score/packages/timing/package.json sound2score/packages/timing/
COPY --chown=splates:splates sound2score/packages/web/package.json sound2score/packages/web/
COPY --chown=splates:splates splates/packages/evals/package.json splates/packages/evals/
COPY --chown=splates:splates splates/packages/server/package.json splates/packages/server/
COPY --chown=splates:splates splates/packages/splates/package.json splates/packages/splates/
COPY --chown=splates:splates splates/packages/tooling/package.json splates/packages/tooling/
COPY --chown=splates:splates splates/packages/web/package.json splates/packages/web/
COPY --chown=splates:splates vet/packages/vet/package.json vet/packages/vet/
COPY --chown=splates:splates vexml/packages/benchmarks/package.json vexml/packages/benchmarks/
COPY --chown=splates:splates vexml/packages/integration/package.json vexml/packages/integration/
COPY --chown=splates:splates vexml/packages/renderer/package.json vexml/packages/renderer/
COPY --chown=splates:splates vexml/packages/site/package.json vexml/packages/site/
COPY --chown=splates:splates vexml/packages/vex/package.json vexml/packages/vex/
COPY --chown=splates:splates vexml/packages/vexml/package.json vexml/packages/vexml/
RUN bun install --frozen-lockfile --ignore-scripts --filter './splates/packages/*'

COPY --chown=splates:splates tsconfig.base.json ./
COPY --chown=splates:splates core core
COPY --chown=splates:splates splates splates
RUN mkdir -p /home/splates/.local/bin \
	&& printf '#!/bin/sh\nexec bun /home/splates/mono/splates/packages/splates/index.ts "$@"\n' > /home/splates/.local/bin/splates \
	&& chmod +x /home/splates/.local/bin/splates \
	&& git config --global user.name splates \
	&& git config --global user.email splates@localhost
ENV PATH=/home/splates/.local/bin:$PATH

ENTRYPOINT ["splates", "worker", "run"]
