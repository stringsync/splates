import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { type Duration, sleep } from "webappwiz/time";
import { splatesHome } from "../models";
import { type FirewallRule, HCLOUD_TOKEN, HetznerApi } from "../workers";

/**
 * The coordinator's always-on box in the user's own Hetzner Cloud account,
 * made through its API as the workers are, with the Hetzner token the Cloud
 * workers setup keeps: a server labelled `splates-coordinator`, and the SSH
 * key and firewall of that name. The box has splates installed and serves
 * nothing until `CoordinatorMove` moves the coordinator onto it.
 */
export class CoordinatorBox {
	private readonly ps: Ps;
	private readonly fs: Fs;
	private readonly store: SecretStore;
	/** Where its SSH key pair is kept: the private key, with `.pub` beside it. */
	readonly key: string;

	constructor(private readonly opts: CoordinatorBoxOptions) {
		this.ps = opts.ps ?? new NodePs();
		this.fs = opts.fs ?? new NodeFs();
		this.store = opts.store ?? SystemSecretStore.device();
		const home = opts.home ?? splatesHome(this.ps);
		this.key = `${home}/coordinator/id_ed25519`;
	}

	/**
	 * Makes the box, or puts right what is not so already: its key, its
	 * firewall's rules, its backups and its protection. An existing box keeps
	 * its type, location and install script, which runs only on first boot.
	 */
	async up(): Promise<BoxStanding> {
		const api = await this.api();
		const publicKey = await this.publicKey();
		let key = await api.sshKey(BOX_NAME);
		if (key !== null && key.publicKey.trim() !== publicKey) {
			await api.deleteSshKey(key.id);
			key = null;
		}
		const keyId = key?.id ?? (await api.createSshKey(BOX_NAME, publicKey));
		let firewall = await api.firewall(BOX_NAME);
		if (firewall === null) {
			firewall = await api.createFirewall(BOX_NAME, BOX_RULES);
		} else {
			await api.setFirewallRules(firewall, BOX_RULES);
		}
		const server =
			(await api.servers(BOX_LABEL))[0] ??
			(await api.createServer({
				name: BOX_NAME,
				type: this.opts.serverType ?? BOX_TYPE,
				image: BOX_IMAGE,
				location: this.opts.location ?? BOX_LOCATION,
				userData: installScript(this.opts.version),
				labels: { [BOX_LABEL]: "coordinator" },
				sshKeys: [keyId],
				firewalls: [firewall],
			}));
		if (!server.backups) {
			await api.enableBackups(server.id);
		}
		if (!(server.protected.delete && server.protected.rebuild)) {
			await api.protect(server.id, { delete: true, rebuild: true });
		}
		const standing = await this.status();
		if (standing === null) {
			throw new Error(
				"Hetzner made the coordinator's box but did not say its address",
			);
		}
		return standing;
	}

	/** The box as Hetzner has it, or null when there is none. */
	async status(): Promise<BoxStanding | null> {
		const [server] = await (await this.api()).servers(BOX_LABEL);
		if (server === undefined || server.ipv4 === null) {
			return null;
		}
		return {
			ipv4: server.ipv4,
			serverId: server.id,
			serverType: server.type,
			location: server.location,
			key: this.key,
		};
	}

	/**
	 * Destroys the box, its backups with it, then its firewall and key: first
	 * lifting the delete protection that keeps a stray delete off it.
	 */
	async remove(): Promise<void> {
		const api = await this.api();
		for (const server of await api.servers(BOX_LABEL)) {
			if (server.protected.delete || server.protected.rebuild) {
				await api.protect(server.id, { delete: false, rebuild: false });
			}
			await api.deleteServer(server.id);
		}
		const firewall = await api.firewall(BOX_NAME);
		if (firewall !== null) {
			await api.deleteFirewall(firewall);
		}
		const key = await api.sshKey(BOX_NAME);
		if (key !== null) {
			await api.deleteSshKey(key.id);
		}
	}

	private async api(): Promise<HetznerApi> {
		const token = await this.store.get(HCLOUD_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no Hetzner Cloud API token: do the setup step \`hetzner-token\`, which keeps it as ${HCLOUD_TOKEN}`,
			);
		}
		return new HetznerApi(token, this.opts.fetch, this.opts.wait ?? sleep);
	}

	/** Its SSH public key, making the pair first when there is none. */
	private async publicKey(): Promise<string> {
		const pub = `${this.key}.pub`;
		if (!(await this.fs.exists(pub))) {
			await this.fs.mkdir(this.key.slice(0, this.key.lastIndexOf("/")), {
				recursive: true,
			});
			const made = await this.ps.spawnCapture([
				"ssh-keygen",
				"-q",
				"-t",
				"ed25519",
				"-N",
				"",
				"-C",
				"splates-coordinator",
				"-f",
				this.key,
			]);
			if (made.exitCode !== 0) {
				throw new Error(
					`ssh-keygen could not make the coordinator's key: ${made.stderr.trim()}`,
				);
			}
		}
		return (await this.fs.read(pub)).trim();
	}
}

/** What a `CoordinatorBox` runs on; the real ones by default. */
export interface CoordinatorBoxOptions {
	/** The splates the box installs, the coordinator's own release. */
	version: string;
	/** Its Hetzner server type; `BOX_TYPE` by default. */
	serverType?: string;
	/** Its Hetzner location; `BOX_LOCATION` by default. */
	location?: string;
	ps?: Ps;
	fs?: Fs;
	/** splates's home, where the box's SSH key is. */
	home?: string;
	/** Where `HCLOUD_TOKEN` is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at a Hetzner action. */
	wait?: (duration: Duration) => Promise<void>;
}

/** The box as Hetzner says it stands. */
export interface BoxStanding {
	ipv4: string;
	serverId: string;
	serverType: string;
	location: string;
	/** The private key that logs in as root, its public half beside it as `.pub`. */
	key: string;
}

/** The box's Hetzner server type, unless `serverType` says another. */
// Hetzner's CPX21, 3 shared vCPU and 4 GB: the server takes ~0.6 GB with 7
// sessions, and agents and their tests run on workers. About $38 a month in
// Ashburn after Hetzner's 15 June 2026 prices, its daily backups 20% more.
export const BOX_TYPE = "cpx21";

/** Ashburn, Virginia: Hetzner's nearest to New Jersey. */
export const BOX_LOCATION = "ash";

/** The image the box runs. */
const BOX_IMAGE = "ubuntu-24.04";

/** The password that unlocks the box's keyring, readable by root alone. */
export const KEYRING_PASSWORD = "/root/splates-keyring";

/** The user splates runs as on the box, as on a worker. */
export const BOX_USER = "splates";

/** What the box, its SSH key and its firewall are named. */
const BOX_NAME = "splates-coordinator";

/** The label the box carries, which is how splates finds it. */
const BOX_LABEL = "splates-coordinator";

/** The box's firewall: SSH in, and nothing else. */
const BOX_RULES: FirewallRule[] = [
	{
		direction: "in",
		protocol: "tcp",
		port: "22",
		sourceIps: ["0.0.0.0/0", "::/0"],
	},
];

/**
 * The box's first-boot script: git, bun and splates `version` for
 * `BOX_USER`; cloudflared, which carries the saved tunnel to the
 * coordinator once it runs here; and GNOME Keyring, the Secret Service
 * `Bun.secrets` keeps creds in on Linux, with the password that unlocks it
 * at boot made now, readable by root alone, for the service to be handed.
 * No credentials: those come with the move.
 */
export function installScript(version: string): string {
	const as = (command: string) => `su - ${BOX_USER} -c '${command}'`;
	const bun = `/home/${BOX_USER}/.bun/bin`;
	return [
		"#!/bin/sh",
		"set -eu",
		"export DEBIAN_FRONTEND=noninteractive",
		"apt-get update",
		"apt-get install -y --no-install-recommends ca-certificates curl git unzip dbus-user-session gnome-keyring libsecret-1-0",
		"curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb",
		"dpkg -i /tmp/cloudflared.deb",
		"rm /tmp/cloudflared.deb",
		`test -s ${KEYRING_PASSWORD} || (umask 077 && head -c 32 /dev/urandom | base64 > ${KEYRING_PASSWORD})`,
		`id ${BOX_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${BOX_USER}`,
		as("curl -fsSL https://bun.sh/install | bash"),
		as(`${bun}/bun add -g @stringsync/splates@${version}`),
		"apt-get clean",
		"rm -rf /var/lib/apt/lists/*",
		"",
	].join("\n");
}
