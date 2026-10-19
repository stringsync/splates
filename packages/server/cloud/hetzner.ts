import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import { type Duration, sleep } from "webappwiz/time";
import { HCLOUD_TOKEN, HetznerApi, type HetznerServer } from "./hetzner-api";
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
 * Hetzner Cloud, in the user's own account, through its API with the token
 * the setup keeps as `HCLOUD_TOKEN`: tags are Hetzner's labels. Name it in
 * `splates.config.ts` for the project's workers:
 *
 * ```ts
 * import { HetznerCloud } from "@stringsync/splates-server/cloud";
 *
 * export default { cloud: new HetznerCloud() } satisfies ConfigFile;
 * ```
 */
export class HetznerCloud implements CloudProvider {
	readonly name = "Hetzner Cloud";
	readonly configSource = "new HetznerCloud()";
	readonly token: CloudToken = HETZNER_TOKEN;
	readonly defaults: CloudDefaults;
	private readonly store: SecretStore;
	private readonly fetch: typeof globalThis.fetch | undefined;
	private readonly wait: (duration: Duration) => Promise<void>;

	constructor(opts: HetznerCloudOptions = {}) {
		this.store = opts.store ?? SystemSecretStore.device();
		this.fetch = opts.fetch;
		this.wait = opts.wait ?? sleep;
		this.defaults = {
			...HETZNER_DEFAULTS,
			...(opts.locations === undefined
				? {}
				: { workerLocations: opts.locations }),
		};
	}

	async accepted(): Promise<boolean> {
		const token = await this.store.get(HCLOUD_TOKEN);
		return (
			token !== undefined &&
			(await new HetznerApi(token, this.fetch, this.wait).accepted())
		);
	}

	async orderable(): Promise<Map<string, Set<string>>> {
		return (await this.api()).orderable();
	}

	async machine(id: string): Promise<CloudMachine | null> {
		const server = await (await this.api()).server(id);
		return server === null ? null : machineOf(server);
	}

	async machines(tag: string, value?: string): Promise<CloudMachine[]> {
		const selector = value === undefined ? tag : `${tag}=${value}`;
		return (await (await this.api()).servers(selector)).map(machineOf);
	}

	async create(spec: NewMachine): Promise<CloudMachine> {
		const { tags, ...rest } = spec;
		return machineOf(
			await (await this.api()).createServer({ ...rest, labels: tags }),
		);
	}

	async delete(id: string): Promise<void> {
		await (await this.api()).deleteServer(id);
	}

	async protect(id: string, on: boolean): Promise<void> {
		await (await this.api()).protect(id, { delete: on, rebuild: on });
	}

	async enableBackups(id: string): Promise<void> {
		await (await this.api()).enableBackups(id);
	}

	async snapshot(id: string, opts: SnapshotOptions): Promise<string> {
		return (await this.api()).snapshot(id, {
			description: opts.description,
			labels: opts.tags,
		});
	}

	async snapshots(tag: string, value?: string): Promise<string[]> {
		const selector = value === undefined ? tag : `${tag}=${value}`;
		return (await this.api()).snapshots(selector);
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
		await api.setFirewallRules(firewall, rules);
		return firewall;
	}

	async removeFirewall(name: string): Promise<void> {
		const api = await this.api();
		const firewall = await api.firewall(name);
		if (firewall !== null) {
			await api.deleteFirewall(firewall);
		}
	}

	private async api(): Promise<HetznerApi> {
		const token = await this.store.get(HCLOUD_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no ${this.token.label}: do the setup step \`cloud-token\`, which keeps it as ${HCLOUD_TOKEN}`,
			);
		}
		return new HetznerApi(token, this.fetch, this.wait);
	}
}

/** What a `HetznerCloud` runs on; the real ones by default. */
export interface HetznerCloudOptions {
	/** Where workers may go, in the order tried; Nuremberg, Falkenstein, Helsinki by default. */
	locations?: readonly string[];
	/** Where `HCLOUD_TOKEN` is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at a Hetzner action. */
	wait?: (duration: Duration) => Promise<void>;
}

/** The Hetzner token as the setup page asks for it. */
const HETZNER_TOKEN: CloudToken = {
	cred: HCLOUD_TOKEN,
	label: "Hetzner Cloud API token",
	help: "In the [Hetzner Console](https://console.hetzner.com/projects), open a project for splates (or make one), then **Security › API tokens › Generate API token** with **Read & Write**, and paste it.",
	refused:
		"Hetzner does not take that token: generate a Read & Write one and paste it again.",
};

/**
 * What splates makes in Hetzner. Worker prices are estimates from Hetzner's
 * EU list prices of 15 June 2026, in US dollars without VAT or IPv4; Hetzner
 * bills each started hour in full, up to the type's monthly price.
 */
export const HETZNER_DEFAULTS: CloudDefaults = {
	// Eight slots each, as Sizing in `designs/worker-pool.md` has it.
	workerTypes: [
		// 16 shared vCPU, 32 GB; often not orderable, so offered only while it is.
		{
			name: "cx53",
			platform: "linux",
			slots: 8,
			dollarsPerHour: 0.0561,
			billing: "hour",
		},
		// 16 shared vCPU, 32 GB.
		{
			name: "cpx62",
			platform: "linux",
			slots: 8,
			dollarsPerHour: 0.2452,
			billing: "hour",
		},
	],
	// Nuremberg, Falkenstein, Helsinki.
	workerLocations: ["nbg1", "fsn1", "hel1"],
	// The smallest x86 disks, since a snapshot boots only on a disk at least its size.
	builderTypes: ["cx23", "cpx22", "cpx32"],
	image: "ubuntu-24.04",
	box: {
		// CPX21, 3 shared vCPU and 4 GB: the server takes ~0.6 GB with 7
		// sessions, and agents and their tests run on workers. About $38 a
		// month in Ashburn after Hetzner's 15 June 2026 prices, its daily
		// backups 20% more.
		type: "cpx21",
		// Ashburn, Virginia: Hetzner's nearest to New Jersey; then Hillsboro, Oregon.
		locations: ["ash", "hil"],
		about:
			"a Hetzner CPX21 in Ashburn, Virginia, or Hillsboro, Oregon, when Ashburn has none, with Hetzner's daily backups: about $38 a month, its backups 20% more",
	},
};

function machineOf(server: HetznerServer): CloudMachine {
	return {
		id: server.id,
		name: server.name,
		status: server.status === "initializing" ? "starting" : server.status,
		type: server.type,
		location: server.location,
		ipv4: server.ipv4,
		tags: server.labels,
		protected: server.protected.delete && server.protected.rebuild,
		backups: server.backups,
		createdAt: server.createdAt,
	};
}
