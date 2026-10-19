import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import { type Duration, sleep } from "webappwiz/time";
import {
	DIGITALOCEAN_TOKEN,
	DigitalOceanApi,
	type DigitalOceanDroplet,
} from "./digitalocean-api";
import type {
	CloudDefaults,
	CloudMachine,
	CloudProvider,
	CloudToken,
	FirewallRule,
	NewMachine,
	SnapshotOptions,
} from "./provider";

/**
 * DigitalOcean, in the user's own account, through its API with the token
 * the setup keeps as `DIGITALOCEAN_TOKEN`. Its tags are bare names, so a
 * tag `key` with `value` is kept as two, `key` and `key:value`, which lets a
 * lookup by either filter on DigitalOcean's side. It has no protection
 * against deleting a droplet, so `protect` does nothing. Name it in
 * `splates.config.ts` for the project's workers:
 *
 * ```ts
 * import { DigitalOceanCloud } from "@stringsync/splates-server/cloud";
 *
 * export default { cloud: new DigitalOceanCloud() } satisfies ConfigFile;
 * ```
 */
export class DigitalOceanCloud implements CloudProvider {
	readonly name = "DigitalOcean";
	readonly configSource = "new DigitalOceanCloud()";
	readonly token: CloudToken = TOKEN;
	readonly defaults: CloudDefaults;
	private readonly store: SecretStore;
	private readonly fetch: typeof globalThis.fetch | undefined;
	private readonly wait: (duration: Duration) => Promise<void>;

	constructor(opts: DigitalOceanCloudOptions = {}) {
		this.store = opts.store ?? SystemSecretStore.device();
		this.fetch = opts.fetch;
		this.wait = opts.wait ?? sleep;
		this.defaults = {
			...DIGITALOCEAN_DEFAULTS,
			...(opts.regions === undefined ? {} : { workerLocations: opts.regions }),
		};
	}

	async accepted(): Promise<boolean> {
		const token = await this.store.get(DIGITALOCEAN_TOKEN);
		return (
			token !== undefined &&
			(await new DigitalOceanApi(token, this.fetch, this.wait).accepted())
		);
	}

	async orderable(): Promise<Map<string, Set<string>>> {
		return (await this.api()).orderable();
	}

	async machine(id: string): Promise<CloudMachine | null> {
		const droplet = await (await this.api()).droplet(id);
		return droplet === null ? null : machineOf(droplet);
	}

	async machines(tag: string, value?: string): Promise<CloudMachine[]> {
		const droplets = await (await this.api()).droplets(tagName(tag, value));
		return droplets.map(machineOf);
	}

	async create(spec: NewMachine): Promise<CloudMachine> {
		const api = await this.api();
		const droplet = await api.createDroplet({
			name: spec.name,
			size: spec.type,
			image: spec.image,
			region: spec.location,
			userData: spec.userData,
			tags: tagsOf(spec.tags),
			...(spec.sshKeys === undefined ? {} : { sshKeys: spec.sshKeys }),
		});
		for (const firewall of spec.firewalls ?? []) {
			await api.addToFirewall(firewall, droplet.id);
		}
		return machineOf(droplet);
	}

	async delete(id: string): Promise<void> {
		await (await this.api()).deleteDroplet(id);
	}

	/** DigitalOcean cannot refuse deleting a droplet, so there is nothing to turn on. */
	async protect(_id: string, _on: boolean): Promise<void> {}

	async enableBackups(id: string): Promise<void> {
		await (await this.api()).enableBackups(id);
	}

	async snapshot(id: string, opts: SnapshotOptions): Promise<string> {
		const api = await this.api();
		// Named for when it was taken too, since a droplet's snapshots are found by name.
		const made = await api.snapshot(
			id,
			`${opts.description} ${new Date().toISOString()}`,
		);
		await api.tagImage(made, tagsOf(opts.tags));
		return made;
	}

	async snapshots(tag: string, value?: string): Promise<string[]> {
		return (await this.api()).snapshots(tagName(tag, value));
	}

	async deleteSnapshot(id: string): Promise<void> {
		await (await this.api()).deleteImage(id);
	}

	async ensureSshKey(name: string, publicKey: string): Promise<string> {
		const api = await this.api();
		const key = await api.sshKey(name);
		if (key !== null && key.publicKey.trim() === publicKey.trim()) {
			return key.id;
		}
		if (key !== null) {
			await api.deleteSshKey(key.id);
		}
		return api.createSshKey(name, publicKey);
	}

	async removeSshKey(name: string): Promise<void> {
		const api = await this.api();
		const key = await api.sshKey(name);
		if (key !== null) {
			await api.deleteSshKey(key.id);
		}
	}

	async ensureFirewall(name: string, rules: FirewallRule[]): Promise<string> {
		const api = await this.api();
		const firewall = await api.firewall(name);
		if (firewall === null) {
			return api.createFirewall(name, rules);
		}
		await api.setFirewallRules(firewall, name, rules);
		return firewall.id;
	}

	async removeFirewall(name: string): Promise<void> {
		const api = await this.api();
		const firewall = await api.firewall(name);
		if (firewall !== null) {
			await api.deleteFirewall(firewall.id);
		}
	}

	private async api(): Promise<DigitalOceanApi> {
		const token = await this.store.get(DIGITALOCEAN_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no ${this.token.label}: do the setup step \`cloud-token\`, which keeps it as ${DIGITALOCEAN_TOKEN}`,
			);
		}
		return new DigitalOceanApi(token, this.fetch, this.wait);
	}
}

/** What a `DigitalOceanCloud` runs on; the real ones by default. */
export interface DigitalOceanCloudOptions {
	/** Where workers may go, in the order tried; New York 3, New York 1, San Francisco 3 by default. */
	regions?: readonly string[];
	/** Where `DIGITALOCEAN_TOKEN` is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at a DigitalOcean action. */
	wait?: (duration: Duration) => Promise<void>;
}

/** The DigitalOcean token as the setup page asks for it. */
const TOKEN: CloudToken = {
	cred: DIGITALOCEAN_TOKEN,
	label: "DigitalOcean API token",
	help: "In the [DigitalOcean control panel](https://cloud.digitalocean.com/account/api/tokens), **Generate New Token** with **Full Access**, and paste it.",
	refused:
		"DigitalOcean does not take that token: generate a Full Access one and paste it again.",
};

/**
 * What splates makes in DigitalOcean. Prices are DigitalOcean's list prices
 * of October 2026 in US dollars; it bills each droplet by the second, at
 * least a minute, up to the size's monthly price.
 */
export const DIGITALOCEAN_DEFAULTS: CloudDefaults = {
	workerTypes: [
		// Basic, 8 shared vCPU and 16 GB: four slots at the 4 GB each one takes.
		{
			name: "s-8vcpu-16gb",
			platform: "linux",
			slots: 4,
			dollarsPerHour: 0.14286,
			billing: "second",
		},
	],
	// New York first, nearest to New Jersey.
	workerLocations: ["nyc3", "nyc1", "sfo3"],
	// Small, with room to install splates; a snapshot boots on any disk at least its size.
	builderTypes: ["s-1vcpu-2gb", "s-2vcpu-4gb"],
	image: "ubuntu-24-04-x64",
	box: {
		// 2 vCPU and 4 GB: the server takes ~0.6 GB with 7 sessions, and
		// agents and their tests run on workers.
		type: "s-2vcpu-4gb",
		location: "nyc3",
		about:
			"a DigitalOcean Basic droplet, 2 vCPU and 4 GB, in New York, with DigitalOcean's daily backups: about $24 a month, its backups 30% more",
	},
};

/** The tag naming `tag` with `value`, or `tag` alone, as `tagsOf` keeps them. */
function tagName(tag: string, value?: string): string {
	return value === undefined ? tag : `${tag}:${value}`;
}

/** `tags` as DigitalOcean keeps them: each key alone, and with its value. */
function tagsOf(tags: Record<string, string>): string[] {
	return Object.entries(tags).flatMap(([key, value]) => [
		key,
		tagName(key, value),
	]);
}

function machineOf(droplet: DigitalOceanDroplet): CloudMachine {
	const tags: Record<string, string> = {};
	for (const tag of droplet.tags) {
		const at = tag.indexOf(":");
		if (at > 0) {
			tags[tag.slice(0, at)] = tag.slice(at + 1);
		} else {
			tags[tag] ??= "";
		}
	}
	return {
		id: droplet.id,
		name: droplet.name,
		status:
			droplet.status === "active"
				? "running"
				: droplet.status === "new"
					? "starting"
					: droplet.status,
		type: droplet.size,
		location: droplet.region,
		ipv4: droplet.ipv4,
		tags,
		protected: false,
		backups: droplet.backups,
		createdAt: droplet.createdAt,
	};
}
