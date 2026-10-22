#!/bin/sh
# The server box's entry (`coordinator.Dockerfile`): a session bus and
# an unlocked login keyring (a password makes one), as a Linux with a secret service has, written to
# ~/session.env for what `docker exec` runs; then the forwarder that
# publishes the server's port, `forward.ts <from> <to>`.
set -eu
eval "$(dbus-launch --sh-syntax)"
printf prove | gnome-keyring-daemon --unlock --components=secrets --daemonize >/dev/null
printf 'export DBUS_SESSION_BUS_ADDRESS=%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$HOME/session.env"
bun /home/splates/splates/docker/forward.ts "$1" "$2" &
exec sleep infinity
