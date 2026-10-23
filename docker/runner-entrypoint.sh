#!/bin/sh
set -eu

# A checkout's build is mandatory when supplied: running the release after a
# failed download could silently speak a different job protocol.
splates="/home/splates/.bun/bin/splates"
if [ -n "${SPLATES_BUILD_URL:-}" ]; then
	: "${SPLATES_BUILD_TOKEN:?a build URL needs its token}"
	mkdir -p /home/splates/.local/bin
	build=/home/splates/.local/bin/splates-own
	# curl reads the token on stdin, keeping it out of process arguments.
	printf 'header = "x-splates-build: %s"\n' "$SPLATES_BUILD_TOKEN" |
		curl --config - --fail --silent --show-error --retry 3 \
		--connect-timeout 15 --max-time 180 "$SPLATES_BUILD_URL" -o "$build.tmp"
	chmod +x "$build.tmp"
	mv "$build.tmp" "$build"
	splates="$build"
fi
unset SPLATES_BUILD_URL SPLATES_BUILD_TOKEN
exec "$splates" runners serve "$@"
