import type { SecretStore } from "webappwiz/creds";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import { type CloudProvider, type FirewallRule, machineCloud } from "../cloud";
import { splatesHome } from "../models";

/**
 * The coordinator's always-on box in the user's own cloud account, made
 * through its API as the workers are, with the token the setup keeps: a
 * machine tagged `splates-coordinator`, and the SSH key and firewall of that
 * name. The box has splates installed and serves nothing until
 * `CoordinatorMove` moves the coordinator onto it.
 */
export class CoordinatorBox {
	private readonly ps: Ps;
	private readonly fs: Fs;
	/** The cloud it is made in: the machine's, unless `cloud` says another. */
	readonly cloud: CloudProvider;
	/** splates's home, under whose `coordinator` the box's SSH files are kept. */
	readonly home: string;
	/** Where its SSH key pair is kept: the private key, with `.pub` beside it. */
	readonly key: string;

	constructor(private readonly opts: CoordinatorBoxOptions) {
		this.ps = opts.ps ?? new NodePs();
		this.fs = opts.fs ?? new NodeFs();
		this.cloud =
			opts.cloud ??
			machineCloud({
				...(opts.store === undefined ? {} : { store: opts.store }),
				...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
				...(opts.wait === undefined ? {} : { wait: opts.wait }),
			});
		this.home = opts.home ?? splatesHome(this.ps);
		this.key = `${this.home}/coordinator/id_ed25519`;
	}

	/**
	 * Makes the box, or puts right what is not so already: its key, its
	 * firewall's rules, its backups and its protection. An existing box keeps
	 * its type, location and install script, which runs only on first boot.
	 */
	async up(): Promise<BoxStanding> {
		const { cloud } = this;
		const keyId = await cloud.ensureSshKey(BOX_NAME, await this.publicKey());
		const firewall = await cloud.ensureFirewall(BOX_NAME, BOX_RULES);
		const machine =
			(await cloud.machines(BOX_TAG))[0] ??
			(await cloud.create({
				name: BOX_NAME,
				type: this.opts.type ?? cloud.defaults.box.type,
				image: cloud.defaults.image,
				location: this.opts.location ?? cloud.defaults.box.location,
				userData: installScript(this.opts.version),
				tags: { [BOX_TAG]: "coordinator" },
				sshKeys: [keyId],
				firewalls: [firewall],
			}));
		if (!machine.backups) {
			await cloud.enableBackups(machine.id);
		}
		if (!machine.protected) {
			await cloud.protect(machine.id, true);
		}
		const standing = await this.status();
		if (standing === null) {
			throw new Error(
				`${cloud.name} made the coordinator's box but did not say its address`,
			);
		}
		return standing;
	}

	/** The box as its cloud has it, or null when there is none. */
	async status(): Promise<BoxStanding | null> {
		const [machine] = await this.cloud.machines(BOX_TAG);
		if (machine === undefined || machine.ipv4 === null) {
			return null;
		}
		return {
			ipv4: machine.ipv4,
			serverId: machine.id,
			serverType: machine.type,
			location: machine.location,
			key: this.key,
		};
	}

	/**
	 * Destroys the box, its backups with it, then its firewall and key: first
	 * lifting the protection that keeps a stray delete off it.
	 */
	async remove(): Promise<void> {
		const { cloud } = this;
		for (const machine of await cloud.machines(BOX_TAG)) {
			await cloud.protect(machine.id, false);
			await cloud.delete(machine.id);
		}
		await cloud.removeFirewall(BOX_NAME);
		await cloud.removeSshKey(BOX_NAME);
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
	/** The cloud it is made in; `machineCloud()` by default, made with `store`, `fetch` and `wait`. */
	cloud?: CloudProvider;
	/** Its machine type; the cloud's default box type unless set. */
	type?: string;
	/** Its location; the cloud's default box location unless set. */
	location?: string;
	ps?: Ps;
	fs?: Fs;
	/** splates's home, where the box's SSH key is. */
	home?: string;
	/** Where the cloud's token is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at the cloud's actions. */
	wait?: (duration: Duration) => Promise<void>;
}

/** The box as its cloud says it stands. */
export interface BoxStanding {
	ipv4: string;
	/** The cloud's id for its machine. */
	serverId: string;
	serverType: string;
	location: string;
	/** The private key that logs in as root, its public half beside it as `.pub`. */
	key: string;
}

/** The password that unlocks the box's keyring, readable by root alone. */
export const KEYRING_PASSWORD = "/root/splates-keyring";

/** The user splates runs as on the box, as on a worker. */
export const BOX_USER = "splates";

/** What the box, its SSH key and its firewall are named. */
const BOX_NAME = "splates-coordinator";

/** The tag the box carries, which is how splates finds it. */
const BOX_TAG = "splates-coordinator";

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
