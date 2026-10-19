import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";

/** The device cred the Hetzner Cloud API token is kept as, named as Hetzner's own tools read it. */
export const HCLOUD_TOKEN = "HCLOUD_TOKEN";

const API = "https://api.hetzner.cloud/v1";

/**
 * The Hetzner Cloud API, as far as splates makes machines in the user's own
 * account: which server types can be ordered where right now, and making,
 * finding and deleting servers, snapshots, SSH keys and firewalls. Labels,
 * and names for keys and firewalls, are how splates finds what it made:
 * it keeps no state of its own about them.
 */
export class HetznerApi {
	constructor(
		private readonly token: string,
		private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
		private readonly wait: (duration: Duration) => Promise<void> = sleep,
	) {}

	/** The locations each server type can be ordered in now, by type name. */
	async orderable(): Promise<Map<string, Set<string>>> {
		const [types, datacenters] = await Promise.all([
			this.request("GET", "/server_types?per_page=50", ServerTypes),
			this.request("GET", "/datacenters", Datacenters),
		]);
		const names = new Map(
			types.server_types.map((type) => [type.id, type.name]),
		);
		const where = new Map<string, Set<string>>();
		for (const datacenter of datacenters.datacenters) {
			for (const id of datacenter.server_types.available) {
				const name = names.get(id);
				if (name !== undefined) {
					const locations = where.get(name) ?? new Set<string>();
					locations.add(datacenter.location.name);
					where.set(name, locations);
				}
			}
		}
		return where;
	}

	/** Server `id`, or null when there is none. */
	async server(id: string): Promise<HetznerServer | null> {
		const found = await this.request("GET", `/servers/${id}`, Answers.server, {
			missing: true,
		});
		return found === null ? null : serverOf(found.server);
	}

	/** The servers `selector` picks, as `splates-worker` or `splates-worker=abc`. */
	async servers(selector: string): Promise<HetznerServer[]> {
		const found = await this.request(
			"GET",
			`/servers?per_page=50&label_selector=${encodeURIComponent(selector)}`,
			Answers.servers,
		);
		return found.servers.map(serverOf);
	}

	/** Makes a server, answering it once Hetzner has made it and it is booting. */
	async createServer(server: NewServer): Promise<HetznerServer> {
		const made = await this.request("POST", "/servers", Answers.made, {
			body: {
				name: server.name,
				server_type: server.type,
				image: server.image,
				location: server.location,
				user_data: server.userData,
				labels: server.labels,
				start_after_create: true,
				ssh_keys: (server.sshKeys ?? []).map(Number),
				firewalls: (server.firewalls ?? []).map((id) => ({
					firewall: Number(id),
				})),
			},
		});
		await this.settle(made.action);
		return serverOf(made.server);
	}

	/** Deletes server `id`, its backups with it, waiting until it is gone; silent when it already is. */
	async deleteServer(id: string): Promise<void> {
		const deleted = await this.request(
			"DELETE",
			`/servers/${id}`,
			Answers.action,
			{ missing: true },
		);
		if (deleted !== null) {
			await this.settle(deleted.action);
		}
	}

	/** Turns server `id`'s delete and rebuild protection on or off. */
	async protect(
		id: string,
		protection: { delete: boolean; rebuild: boolean },
	): Promise<void> {
		await this.act(`/servers/${id}/actions/change_protection`, protection);
	}

	/** Turns on Hetzner's daily backups of server `id`. */
	async enableBackups(id: string): Promise<void> {
		await this.act(`/servers/${id}/actions/enable_backup`, {});
	}

	/** Snapshots server `id`, answering the snapshot's id once it is made. */
	async snapshot(id: string, opts: SnapshotOptions): Promise<string> {
		const made = await this.request(
			"POST",
			`/servers/${id}/actions/create_image`,
			Answers.image,
			{ body: { type: "snapshot", ...opts } },
		);
		await this.settle(made.action);
		return String(made.image.id);
	}

	/** The snapshots `selector` picks, by id. */
	async snapshots(selector: string): Promise<string[]> {
		const found = await this.request(
			"GET",
			`/images?type=snapshot&per_page=50&label_selector=${encodeURIComponent(selector)}`,
			Answers.images,
		);
		return found.images.map((image) => String(image.id));
	}

	/** Deletes image `id`; silent when it is already gone. */
	async deleteImage(id: string): Promise<void> {
		await this.request("DELETE", `/images/${id}`, Answers.any, {
			missing: true,
		});
	}

	/** The SSH key named `name`, or null when there is none. */
	async sshKey(
		name: string,
	): Promise<{ id: string; publicKey: string } | null> {
		const found = await this.request(
			"GET",
			`/ssh_keys?name=${encodeURIComponent(name)}`,
			Answers.sshKeys,
		);
		const key = found.ssh_keys[0];
		return key === undefined
			? null
			: { id: String(key.id), publicKey: key.public_key };
	}

	/** Adds an SSH key, answering its id. */
	async createSshKey(name: string, publicKey: string): Promise<string> {
		const made = await this.request("POST", "/ssh_keys", Answers.sshKey, {
			body: { name, public_key: publicKey },
		});
		return String(made.ssh_key.id);
	}

	/** Deletes SSH key `id`; silent when it is already gone. */
	async deleteSshKey(id: string): Promise<void> {
		await this.request("DELETE", `/ssh_keys/${id}`, Answers.any, {
			missing: true,
		});
	}

	/** The id of the firewall named `name`, or null when there is none. */
	async firewall(name: string): Promise<string | null> {
		const found = await this.request(
			"GET",
			`/firewalls?name=${encodeURIComponent(name)}`,
			Answers.firewalls,
		);
		const firewall = found.firewalls[0];
		return firewall === undefined ? null : String(firewall.id);
	}

	/** Makes a firewall with `rules` alone, answering its id. */
	async createFirewall(name: string, rules: FirewallRule[]): Promise<string> {
		const made = await this.request("POST", "/firewalls", Answers.firewall, {
			body: { name, rules: rules.map(ruleJson) },
		});
		return String(made.firewall.id);
	}

	/** Makes firewall `id`'s rules `rules`, and only those. */
	async setFirewallRules(id: string, rules: FirewallRule[]): Promise<void> {
		await this.request(
			"POST",
			`/firewalls/${id}/actions/set_rules`,
			Answers.any,
			{ body: { rules: rules.map(ruleJson) } },
		);
	}

	/** Deletes firewall `id`; silent when it is already gone. */
	async deleteFirewall(id: string): Promise<void> {
		await this.request("DELETE", `/firewalls/${id}`, Answers.any, {
			missing: true,
		});
	}

	/** Whether the token is one the API takes. */
	async accepted(): Promise<boolean> {
		const response = await this.fetch(`${API}/servers?per_page=1`, {
			headers: { Authorization: `Bearer ${this.token}` },
		});
		if (response.status === 401 || response.status === 403) {
			return false;
		}
		if (!response.ok) {
			throw new Error(`Hetzner answered ${response.status}`);
		}
		return true;
	}

	/** Runs the action at `path`, waiting until it is done. */
	private async act(path: string, body: object): Promise<void> {
		const started = await this.request("POST", path, Answers.action, {
			body,
		});
		await this.settle(started.action);
	}

	/** Waits for `action` to finish, throwing Hetzner's reason when it failed. */
	private async settle(action: z.infer<typeof Action>): Promise<void> {
		let now = action;
		for (let waited = 0; now.status === "running"; waited += ACTION_POLL.ms) {
			if (waited >= ACTION_LIMIT.ms) {
				throw new Error(
					`Hetzner's action ${now.id} did not finish within ${ACTION_LIMIT.mins} minutes`,
				);
			}
			await this.wait(ACTION_POLL);
			now = (await this.request("GET", `/actions/${now.id}`, Answers.action))
				.action;
		}
		if (now.status === "error") {
			throw new Error(
				`Hetzner's action failed: ${now.error?.message ?? now.error?.code ?? "no reason given"}`,
			);
		}
	}

	private async request<T>(
		method: string,
		path: string,
		schema: z.ZodType<T>,
		opts: RequestOptions & { missing: true },
	): Promise<T | null>;
	private async request<T>(
		method: string,
		path: string,
		schema: z.ZodType<T>,
		opts?: RequestOptions,
	): Promise<T>;
	private async request<T>(
		method: string,
		path: string,
		schema: z.ZodType<T>,
		opts: RequestOptions = {},
	): Promise<T | null> {
		const response = await this.fetch(`${API}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.token}`,
				...(opts.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
		});
		if (opts.missing === true && response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Error(
				`Hetzner answered ${response.status} to ${method} ${path.replace(/\?.*/, "")}: ${await reason(response)}`,
			);
		}
		const text = await response.text();
		return schema.parse(text === "" ? {} : JSON.parse(text));
	}
}

/** What `HetznerApi.snapshot` takes of a server. */
export interface SnapshotOptions {
	description: string;
	labels: Record<string, string>;
}

/** How `HetznerApi` sends one request. */
interface RequestOptions {
	/** Sent as JSON. */
	body?: object;
	/** Answer null for a 404, as for something already gone. */
	missing?: boolean;
}

/** A server as Hetzner has it. */
export interface HetznerServer {
	id: string;
	name: string;
	/** As "running", "initializing" or "off". */
	status: string;
	type: string;
	location: string;
	/** Its public IPv4 address, or null while it has none. */
	ipv4: string | null;
	labels: Record<string, string>;
	protected: { delete: boolean; rebuild: boolean };
	/** Whether Hetzner's daily backups are on. */
	backups: boolean;
	/** When it was made, epoch milliseconds. */
	createdAt: number;
}

/** What `HetznerApi.createServer` makes. */
export interface NewServer {
	name: string;
	type: string;
	/** An image's name, as "ubuntu-24.04", or a snapshot's id. */
	image: string;
	location: string;
	/** Run once on first boot by cloud-init. */
	userData: string;
	labels: Record<string, string>;
	sshKeys?: string[];
	firewalls?: string[];
}

/** One inbound rule of a Hetzner firewall. */
export interface FirewallRule {
	direction: "in";
	protocol: "tcp" | "udp" | "icmp";
	port: string;
	sourceIps: string[];
}

/** How long an action is waited on before it counts as stuck. */
const ACTION_POLL = Duration.secs(2);
const ACTION_LIMIT = Duration.mins(20);

const ServerTypes = z.object({
	server_types: z.array(z.object({ id: z.number(), name: z.string() })),
});

const Datacenters = z.object({
	datacenters: z.array(
		z.object({
			location: z.object({ name: z.string() }),
			server_types: z.object({ available: z.array(z.number()) }),
		}),
	),
});

const ServerJson = z.object({
	id: z.number(),
	name: z.string(),
	status: z.string(),
	server_type: z.object({ name: z.string() }),
	datacenter: z.object({ location: z.object({ name: z.string() }) }),
	public_net: z.object({
		ipv4: z.object({ ip: z.string() }).nullable(),
	}),
	labels: z.record(z.string(), z.string()),
	protection: z.object({ delete: z.boolean(), rebuild: z.boolean() }),
	backup_window: z.string().nullable(),
	created: z.string(),
});

const Action = z.object({
	id: z.number(),
	status: z.string(),
	error: z.object({ code: z.string(), message: z.string() }).nullish(),
});

const Image = z.object({
	id: z.number(),
	labels: z.record(z.string(), z.string()),
});

const SshKey = z.object({
	id: z.number(),
	name: z.string(),
	public_key: z.string(),
});

const Firewall = z.object({ id: z.number(), name: z.string() });

const Answers = {
	server: z.object({ server: ServerJson }),
	servers: z.object({ servers: z.array(ServerJson) }),
	made: z.object({ server: ServerJson, action: Action }),
	action: z.object({ action: Action }),
	image: z.object({ image: Image, action: Action }),
	images: z.object({ images: z.array(Image) }),
	sshKey: z.object({ ssh_key: SshKey }),
	sshKeys: z.object({ ssh_keys: z.array(SshKey) }),
	firewall: z.object({ firewall: Firewall }),
	firewalls: z.object({ firewalls: z.array(Firewall) }),
	any: z.unknown(),
};

function serverOf(json: z.infer<typeof ServerJson>): HetznerServer {
	return {
		id: String(json.id),
		name: json.name,
		status: json.status,
		type: json.server_type.name,
		location: json.datacenter.location.name,
		ipv4: json.public_net.ipv4?.ip ?? null,
		labels: json.labels,
		protected: json.protection,
		backups: json.backup_window !== null,
		createdAt: Date.parse(json.created),
	};
}

function ruleJson(rule: FirewallRule): object {
	return {
		direction: rule.direction,
		protocol: rule.protocol,
		port: rule.port,
		source_ips: rule.sourceIps,
	};
}

/** Hetzner's message for a refusal, which names what was wrong. */
async function reason(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	try {
		const parsed = JSON.parse(text) as { error?: { message?: string } };
		return parsed.error?.message ?? (text || "no reason given");
	} catch {
		return text || "no reason given";
	}
}
