# The package's tests on Linux, for `splates dev test --linux`, built from
# this checkout: `docker build -f docker/test.Dockerfile -t splates-test .`
# from the repo root, then `docker run --rm splates-test bun test`. The
# system packages are the worker image's (`worker.Dockerfile`) without the
# shared browser's Chromium, which no test opens; the user is `splates`
# since agents refuse to run as root and the server's box runs as it.
FROM oven/bun:1.4.2-debian

ENV DEBIAN_FRONTEND=noninteractive
# procps for `ps`, iproute2 for `ss`, which find a task's processes and ports;
# bubblewrap for the sandbox probe.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git unzip procps iproute2 bubblewrap \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash splates
USER splates
WORKDIR /home/splates/splates

# The dependencies first, a layer that lasts across source changes: the
# install's scripts build the page, which needs the source, so they wait.
COPY --chown=splates:splates package.json bun.lock ./
COPY --chown=splates:splates packages/server/package.json packages/server/
COPY --chown=splates:splates packages/splates/package.json packages/splates/
COPY --chown=splates:splates packages/web/package.json packages/web/
RUN bun install --frozen-lockfile --ignore-scripts

# Then the checkout (`.dockerignore` leaves out node_modules and .git), and
# the page built on this platform.
COPY --chown=splates:splates . .
RUN bun run --cwd packages/web build \
	&& git config --global user.name splates \
	&& git config --global user.email splates@localhost
