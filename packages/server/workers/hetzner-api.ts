import { z } from "zod";

/** The device cred the Hetzner Cloud API token is kept as, named as Pulumi's hcloud provider reads it. */
export const HCLOUD_TOKEN = "HCLOUD_TOKEN";

const API = "https://api.hetzner.cloud/v1";

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

const Server = z.object({ server: z.object({ status: z.string() }) });

const Servers = z.object({
	servers: z.array(
		z.object({
			name: z.string(),
			server_type: z.object({ name: z.string() }),
			labels: z.record(z.string(), z.string()),
		}),
	),
});

/**
 * What the Hetzner Cloud API tells that Pulumi does not: which server types
 * can be ordered where right now, and how a machine stands. Pulumi still
 * makes and destroys every machine.
 */
export class HetznerApi {
	constructor(
		private readonly token: string,
		private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
	) {}

	/** The locations each server type can be ordered in now, by type name. */
	async orderable(): Promise<Map<string, Set<string>>> {
		const [types, datacenters] = await Promise.all([
			this.get("/server_types?per_page=50", ServerTypes),
			this.get("/datacenters", Datacenters),
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

	/** Server `id`'s status, as "running" or "off". */
	async status(id: string): Promise<string> {
		return (await this.get(`/servers/${id}`, Server)).server.status;
	}

	/** The servers carrying `label`, with that label's value. */
	async labelled(
		label: string,
	): Promise<{ name: string; type: string; value: string }[]> {
		const found = await this.get(
			`/servers?per_page=50&label_selector=${encodeURIComponent(label)}`,
			Servers,
		);
		return found.servers.map((server) => ({
			name: server.name,
			type: server.server_type.name,
			value: server.labels[label] ?? "",
		}));
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

	private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
		const response = await this.fetch(`${API}${path}`, {
			headers: { Authorization: `Bearer ${this.token}` },
		});
		if (!response.ok) {
			throw new Error(`Hetzner answered ${response.status} to GET ${path}`);
		}
		return schema.parse(await response.json());
	}
}
