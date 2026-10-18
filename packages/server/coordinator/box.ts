import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { z } from "zod";
import { splatesHome } from "../models";
import { HCLOUD_TOKEN, Pulumi } from "../workers";

/**
 * The coordinator's always-on box in the user's own Hetzner Cloud account,
 * made through Pulumi as the workers are: the Hetzner token and Pulumi's
 * state and passphrase the Cloud workers setup readied, one stack in the
 * file backend on this machine. The box has splates installed and serves
 * nothing until `CoordinatorMove` moves the coordinator onto it.
 */
export class CoordinatorBox {
	private readonly pulumi: Pulumi;
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
		this.pulumi = new Pulumi({
			ps: this.ps,
			fs: this.fs,
			home,
			store: this.store,
		});
		this.key = `${home}/coordinator/id_ed25519`;
	}

	/**
	 * Makes the box, or brings it to its program: its type, location and
	 * install script. Hetzner rebuilds nothing for a new script, which runs
	 * only on a box's first boot.
	 */
	async up(): Promise<BoxStanding> {
		const env = await this.env();
		const dir = await this.dir();
		await this.select(dir);
		const set = (key: string, value: string) =>
			this.pulumi.run(dir, ["config", "set", key, value, "--stack", STACK]);
		await set("serverType", this.opts.serverType ?? BOX_TYPE);
		await set("location", this.opts.location ?? BOX_LOCATION);
		await set("publicKey", await this.publicKey());
		await set("protect", "true");
		await set("userData", installScript(this.opts.version));
		await this.pulumi.run(dir, upArgs(), { env });
		const standing = await this.status();
		if (standing === null) {
			throw new Error(
				"Pulumi made the coordinator's box but did not say its address",
			);
		}
		return standing;
	}

	/** The box as its stack last left it, or null when there is none. */
	async status(): Promise<BoxStanding | null> {
		const dir = await this.dir();
		if (!(await this.made(dir))) {
			return null;
		}
		const outputs = Outputs.parse(
			JSON.parse(
				await this.pulumi.run(dir, [
					"stack",
					"output",
					"--json",
					"--stack",
					STACK,
				]),
			),
		);
		if (outputs.ipv4 === undefined || outputs.serverId === undefined) {
			return null;
		}
		return {
			ipv4: outputs.ipv4,
			serverId: outputs.serverId,
			serverType: outputs.serverType ?? BOX_TYPE,
			location: outputs.location ?? BOX_LOCATION,
			key: this.key,
		};
	}

	/**
	 * Destroys the box, its backups with it, and forgets its stack: first
	 * lifting the delete protection that keeps a stray `destroy` off it.
	 */
	async remove(): Promise<void> {
		const dir = await this.dir();
		if (!(await this.made(dir))) {
			return;
		}
		const env = await this.env();
		await this.pulumi.run(dir, [
			"config",
			"set",
			"protect",
			"false",
			"--stack",
			STACK,
		]);
		await this.pulumi.run(dir, upArgs(), { env });
		await this.pulumi.run(
			dir,
			["destroy", "--yes", "--skip-preview", "--stack", STACK],
			{ env },
		);
		await this.pulumi.run(dir, ["stack", "rm", "--yes", STACK]);
	}

	private dir(): Promise<string> {
		return this.pulumi.program(BOX_PROJECT, BOX_PROGRAM);
	}

	private async env(): Promise<Record<string, string>> {
		const token = await this.store.get(HCLOUD_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no Hetzner Cloud API token: do the setup step \`hetzner-token\`, which keeps it as ${HCLOUD_TOKEN}`,
			);
		}
		return { [HCLOUD_TOKEN]: token };
	}

	private async select(dir: string): Promise<void> {
		await this.pulumi.run(dir, [
			"stack",
			"select",
			"--create",
			"--secrets-provider",
			"passphrase",
			STACK,
		]);
	}

	private async made(dir: string): Promise<boolean> {
		const listed = StackList.parse(
			JSON.parse(await this.pulumi.run(dir, ["stack", "ls", "--json"])),
		);
		return listed.some((stack) => stack.name === STACK);
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
	/** splates's home, where Pulumi and the box's SSH key are. */
	home?: string;
	/** Where `HCLOUD_TOKEN` and Pulumi's passphrase are kept: the device's creds. */
	store?: SecretStore;
}

/** The box as its stack says it stands. */
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

/** The hcloud Pulumi provider, pinned with the workers'. */
const HCLOUD_VERSION = "1.43.1";

/** The password that unlocks the box's keyring, readable by root alone. */
export const KEYRING_PASSWORD = "/root/splates-keyring";

/** The user splates runs as on the box, as on a worker. */
export const BOX_USER = "splates";

const BOX_PROJECT = "splates-coordinator";
const STACK = "coordinator";

const Outputs = z.object({
	ipv4: z.string().optional(),
	serverId: z.string().optional(),
	serverType: z.string().optional(),
	location: z.string().optional(),
});

const StackList = z.array(z.object({ name: z.string() }));

/** A Pulumi YAML interpolation of `name`, as `${server.id}`. */
function ref(name: string): string {
	return `\${${name}}`;
}

function upArgs(): string[] {
	return ["up", "--yes", "--skip-preview", "--stack", STACK];
}

/**
 * The box's program: one server with Hetzner's daily backups, protected
 * from deletion and rebuilds, reached by SSH alone. Nothing in it is any one
 * operator's: what differs goes in its stack's config.
 */
const BOX_PROGRAM = {
	config: {
		serverType: { type: "string" },
		location: { type: "string" },
		publicKey: { type: "string" },
		protect: { type: "boolean" },
		userData: { type: "string" },
	},
	resources: {
		key: {
			type: "hcloud:SshKey",
			properties: {
				name: "splates-coordinator",
				publicKey: ref("publicKey"),
			},
			options: { version: HCLOUD_VERSION },
		},
		firewall: {
			type: "hcloud:Firewall",
			properties: {
				name: "splates-coordinator",
				rules: [
					{
						direction: "in",
						protocol: "tcp",
						port: "22",
						sourceIps: ["0.0.0.0/0", "::/0"],
					},
				],
			},
			options: { version: HCLOUD_VERSION },
		},
		server: {
			type: "hcloud:Server",
			properties: {
				name: "splates-coordinator",
				serverType: ref("serverType"),
				image: BOX_IMAGE,
				location: ref("location"),
				backups: true,
				deleteProtection: ref("protect"),
				rebuildProtection: ref("protect"),
				sshKeys: [ref("key.id")],
				firewallIds: [ref("firewall.id")],
				userData: ref("userData"),
				labels: { "splates-coordinator": ref("pulumi.stack") },
			},
			options: { version: HCLOUD_VERSION, ignoreChanges: ["userData"] },
		},
	},
	outputs: {
		ipv4: ref("server.ipv4Address"),
		serverId: ref("server.id"),
		serverType: ref("server.serverType"),
		location: ref("server.location"),
	},
};

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
