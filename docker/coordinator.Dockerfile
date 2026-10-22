# The box `prove-coordinator.sh` runs `splates server` on: the worker image
# (`worker.Dockerfile`, built first as splates-worker) with a secret service.
# Creds and the keys of workers are kept in the machine's store, which on
# Linux is libsecret's. SPLATES_SECRET_STORE=file would do without it; the
# keyring proves the path most Linux take.
FROM splates-worker

USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libsecret-1-0 gnome-keyring dbus dbus-x11 \
	&& rm -rf /var/lib/apt/lists/*
USER splates
