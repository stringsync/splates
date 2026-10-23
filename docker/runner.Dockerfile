# Release image, built with --platform linux/amd64 and SPLATES_VERSION after npm publishes.
FROM oven/bun:1.4.2-debian AS base
LABEL org.opencontainers.image.source="https://github.com/stringsync/splates"
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git curl procps \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --shell /bin/bash splates
USER splates
WORKDIR /home/splates
ENV BUN_INSTALL=/home/splates/.bun
# The base image points global bins at root-owned /usr/local/bin.
ENV BUN_INSTALL_BIN=/home/splates/.bun/bin
ENV PATH=/home/splates/.bun/bin:$PATH
# Only the warmed cache crosses into the final image, never the checkout.
FROM base AS warm
COPY --chown=splates:splates . /tmp/splates-cache
RUN cd /tmp/splates-cache && bun install --frozen-lockfile --ignore-scripts \
	&& cd /home/splates && rm -rf /tmp/splates-cache
FROM base
ARG SPLATES_VERSION
COPY --from=warm --chown=splates:splates /home/splates/.bun/install/cache /home/splates/.bun/install/cache
RUN test -n "$SPLATES_VERSION" && bun add -g "@stringsync/splates@$SPLATES_VERSION"
COPY --chmod=755 docker/runner-entrypoint.sh /usr/local/bin/runner-entrypoint
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
