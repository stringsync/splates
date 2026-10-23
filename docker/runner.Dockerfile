# Generic runner base, built with --platform linux/amd64. It holds no project's
# toolchain and no splates: a project's `prepare` fills the toolchain, and
# splates arrives at boot, fetched by the bootstrap. Fly hands each machine
# the bootstrap in its files, so any image with sh and curl or wget serves;
# this one runs it as its entrypoint too, for hosting outside splates.
FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/stringsync/splates"
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git curl procps build-essential unzip \
	&& install -dm 755 /etc/apt/keyrings \
	&& curl -fsSL https://mise.jdx.dev/gpg-key.pub -o /etc/apt/keyrings/mise-archive-keyring.asc \
	&& echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.asc] https://mise.jdx.dev/deb stable main" > /etc/apt/sources.list.d/mise.list \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends mise \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --shell /bin/bash splates
USER splates
WORKDIR /home/splates
ENV PATH=/home/splates/.local/share/mise/shims:/home/splates/.local/bin:$PATH
COPY --chmod=755 packages/server/cloud/bootstrap.sh.txt /etc/splates/bootstrap.sh
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/etc/splates/bootstrap.sh"]
