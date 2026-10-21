/** The user splates runs as on the box, as on a worker. */
const BOX_USER = "splates";

/** Where the latest cloudflared for the box's Ubuntu comes from. */
const CLOUDFLARED_DEB =
	"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb";

/**
 * The box's first-boot script: git, bun and cloudflared, which carries the
 * tunnel to the coordinator once `splates server deploy` starts it, and the
 * user it runs as. The deploy then installs the release of splates it runs.
 * No credentials: the box reads those from Parameter Store under its role.
 */
export function userData(): string {
	return [
		"#!/bin/sh",
		"set -eu",
		"export DEBIAN_FRONTEND=noninteractive",
		"apt-get update",
		"apt-get install -y --no-install-recommends ca-certificates curl git unzip",
		`curl -fsSL -o /tmp/cloudflared.deb ${CLOUDFLARED_DEB}`,
		"dpkg -i /tmp/cloudflared.deb",
		"rm /tmp/cloudflared.deb",
		`id ${BOX_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${BOX_USER}`,
		`su - ${BOX_USER} -c 'curl -fsSL https://bun.sh/install | bash'`,
		"apt-get clean",
		"rm -rf /var/lib/apt/lists/*",
		"",
	].join("\n");
}
