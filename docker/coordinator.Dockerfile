# The box `prove-coordinator.sh` runs `splates server` on: the worker image
# (`worker.Dockerfile`, built first as splates-worker) with a secret service.
# Creds and the keys of workers are kept in the machine's store, which on
# Linux is libsecret's, or Parameter Store under an EC2 instance role as the
# real box has, which Docker cannot stand in for; a server on a Linux with
# neither does not start.
FROM splates-worker

USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libsecret-1-0 gnome-keyring dbus dbus-x11 \
	&& rm -rf /var/lib/apt/lists/*
USER splates
