import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import type { FirewallRule } from "./provider";

/** The device cred the DigitalOcean API token is kept as, named as DigitalOcean's own tools read it. */
export const DIGITALOCEAN_TOKEN = "DIGITALOCEAN_TOKEN";

const API = "https://api.digitalocean.com/v2";

/** The most of anything one page lists; splates makes far fewer. */
const PAGE = 200;

/**
 * The DigitalOcean API, as far as splates makes machines in the user's own
 * account: which sizes can be ordered where right now, and making, finding
 * and deleting droplets, snapshots, SSH keys and firewalls. Tags, and names
 * for keys and firewalls, are how splates finds what it made: it keeps no
 * state of its own about them.
 */
export class DigitalOceanApi {
	constructor(
		private readonly token: string,
		private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
		private readonly wait: (duration: Duration) => Promise<void> = sleep,
	) {}

	/** The regions each size can be ordered in now, by size slug. */
	async orderable(): Promise<Map<string, Set<string>>> {
		const { sizes } = await this.request(
			"GET",
			`/sizes?per_page=${PAGE}`,
			Answers.sizes,
		);
		return new Map(
			sizes
				.filter((size) => size.available)
				.map((size) => [size.slug, new Set(size.regions)]),
		);
	}

	/** Droplet `id`, or null when there is none. */
	async droplet(id: string): Promise<DigitalOceanDroplet | null> {
		const found = await this.request(
			"GET",
			`/droplets/${id}`,
			Answers.droplet,
			{ missing: true },
		);
		return found === null ? null : dropletOf(found.droplet);
	}

	/** The droplets tagged `tag`. */
	async droplets(tag: string): Promise<DigitalOceanDroplet[]> {
		const found = await this.request(
			"GET",
			`/droplets?per_page=${PAGE}&tag_name=${encodeURIComponent(tag)}`,
			Answers.droplets,
		);
		return found.droplets.map(dropletOf);
	}

	/** Makes a droplet, answering it once DigitalOcean has made it and it is booting. */
	async createDroplet(droplet: NewDroplet): Promise<DigitalOceanDroplet> {
		const made = await this.request("POST", "/droplets", Answers.made, {
			body: {
				name: droplet.name,
				size: droplet.size,
				// A snapshot is named by its numeric id, an image by its slug.
				image: /^\d+$/.test(droplet.image)
					? Number(droplet.image)
					: droplet.image,
				region: droplet.region,
				user_data: droplet.userData,
				tags: droplet.tags,
				ssh_keys: (droplet.sshKeys ?? []).map(Number),
			},
		});
		for (const action of made.links.actions) {
			await this.settle(action.id);
		}
		return (
			(await this.droplet(String(made.droplet.id))) ?? dropletOf(made.droplet)
		);
	}

	/** Deletes droplet `id`, its backups with it; silent when it is already gone. */
	async deleteDroplet(id: string): Promise<void> {
		await this.request("DELETE", `/droplets/${id}`, Answers.any, {
			missing: true,
		});
	}

	/** Turns on DigitalOcean's daily backups of droplet `id`. */
	async enableBackups(id: string): Promise<void> {
		await this.act(id, {
			type: "enable_backups",
			// 04:00 UTC, the small hours in the Americas.
			backup_policy: { plan: "daily", hour: 4 },
		});
	}

	/** Snapshots droplet `id` as `name`, answering the snapshot's id once it is made. */
	async snapshot(id: string, name: string): Promise<string> {
		await this.act(id, { type: "snapshot", name });
		const { snapshots } = await this.request(
			"GET",
			`/droplets/${id}/snapshots?per_page=${PAGE}`,
			Answers.snapshots,
		);
		const made = snapshots.findLast((each) => each.name === name);
		if (made === undefined) {
			throw new Error(
				`DigitalOcean snapshotted droplet ${id} but lists no snapshot ${name}`,
			);
		}
		return String(made.id);
	}

	/** Tags image `id` with each of `tags`, making each tag first. */
	async tagImage(id: string, tags: string[]): Promise<void> {
		for (const tag of tags) {
			await this.request("POST", "/tags", Answers.any, {
				body: { name: tag },
				exists: true,
			});
			await this.request(
				"POST",
				`/tags/${encodeURIComponent(tag)}/resources`,
				Answers.any,
				{ body: { resources: [{ resource_id: id, resource_type: "image" }] } },
			);
		}
	}

	/** The ids of the snapshots tagged `tag`. */
	async snapshots(tag: string): Promise<string[]> {
		const found = await this.request(
			"GET",
			`/images?private=true&per_page=${PAGE}&tag_name=${encodeURIComponent(tag)}`,
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
			`/account/keys?per_page=${PAGE}`,
			Answers.sshKeys,
		);
		const key = found.ssh_keys.find((each) => each.name === name);
		return key === undefined
			? null
			: { id: String(key.id), publicKey: key.public_key };
	}

	/** Adds an SSH key, answering its id. */
	async createSshKey(name: string, publicKey: string): Promise<string> {
		const made = await this.request("POST", "/account/keys", Answers.sshKey, {
			body: { name, public_key: publicKey },
		});
		return String(made.ssh_key.id);
	}

	/** Deletes SSH key `id`; silent when it is already gone. */
	async deleteSshKey(id: string): Promise<void> {
		await this.request("DELETE", `/account/keys/${id}`, Answers.any, {
			missing: true,
		});
	}

	/** The firewall named `name`, or null when there is none. */
	async firewall(name: string): Promise<DigitalOceanFirewall | null> {
		const found = await this.request(
			"GET",
			`/firewalls?per_page=${PAGE}`,
			Answers.firewalls,
		);
		const firewall = found.firewalls.find((each) => each.name === name);
		return firewall === undefined
			? null
			: { id: firewall.id, dropletIds: firewall.droplet_ids.map(String) };
	}

	/** Makes a firewall letting in only what `rules` say, answering its id. */
	async createFirewall(name: string, rules: FirewallRule[]): Promise<string> {
		const made = await this.request("POST", "/firewalls", Answers.firewall, {
			body: firewallJson(name, rules, []),
		});
		return made.firewall.id;
	}

	/** Makes firewall `firewall`'s rules `rules`, and only those, keeping its droplets. */
	async setFirewallRules(
		firewall: DigitalOceanFirewall,
		name: string,
		rules: FirewallRule[],
	): Promise<void> {
		await this.request("PUT", `/firewalls/${firewall.id}`, Answers.any, {
			body: firewallJson(name, rules, firewall.dropletIds),
		});
	}

	/** Puts droplet `dropletId` behind firewall `id`. */
	async addToFirewall(id: string, dropletId: string): Promise<void> {
		await this.request("POST", `/firewalls/${id}/droplets`, Answers.any, {
			body: { droplet_ids: [Number(dropletId)] },
		});
	}

	/** Deletes firewall `id`; silent when it is already gone. */
	async deleteFirewall(id: string): Promise<void> {
		await this.request("DELETE", `/firewalls/${id}`, Answers.any, {
			missing: true,
		});
	}

	/** Whether the token is one the API takes. */
	async accepted(): Promise<boolean> {
		const response = await this.fetch(`${API}/account`, {
			headers: { Authorization: `Bearer ${this.token}` },
		});
		if (response.status === 401 || response.status === 403) {
			return false;
		}
		if (!response.ok) {
			throw new Error(`DigitalOcean answered ${response.status}`);
		}
		return true;
	}

	/** Runs action `body` on droplet `id`, waiting until it is done. */
	private async act(id: string, body: object): Promise<void> {
		const started = await this.request(
			"POST",
			`/droplets/${id}/actions`,
			Answers.action,
			{ body },
		);
		await this.settle(started.action.id);
	}

	/** Waits for action `id` to finish, throwing when it failed. */
	private async settle(id: number): Promise<void> {
		for (let waited = 0; ; waited += ACTION_POLL.ms) {
			const { action } = await this.request(
				"GET",
				`/actions/${id}`,
				Answers.action,
			);
			if (action.status === "completed") {
				return;
			}
			if (action.status === "errored") {
				throw new Error(`DigitalOcean's ${action.type} action ${id} failed`);
			}
			if (waited >= ACTION_LIMIT.ms) {
				throw new Error(
					`DigitalOcean's action ${id} did not finish within ${ACTION_LIMIT.mins} minutes`,
				);
			}
			await this.wait(ACTION_POLL);
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
		if (opts.exists === true && response.status === 422) {
			return schema.parse({});
		}
		if (!response.ok) {
			throw new Error(
				`DigitalOcean answered ${response.status} to ${method} ${path.replace(/\?.*/, "")}: ${await reason(response)}`,
			);
		}
		const text = await response.text();
		return schema.parse(text === "" ? {} : JSON.parse(text));
	}
}

/** How `DigitalOceanApi` sends one request. */
interface RequestOptions {
	/** Sent as JSON. */
	body?: object;
	/** Answer null for a 404, as for something already gone. */
	missing?: boolean;
	/** Take a 422 as done, as for a tag that is already there. */
	exists?: boolean;
}

/** A droplet as DigitalOcean has it. */
export interface DigitalOceanDroplet {
	id: string;
	name: string;
	/** As "new", "active", "off" or "archive". */
	status: string;
	size: string;
	region: string;
	/** Its public IPv4 address, or null while it has none. */
	ipv4: string | null;
	tags: string[];
	/** Whether DigitalOcean's backups are on. */
	backups: boolean;
	/** When it was made, epoch milliseconds. */
	createdAt: number;
}

/** What `DigitalOceanApi.createDroplet` makes. */
export interface NewDroplet {
	name: string;
	size: string;
	/** An image's slug, as "ubuntu-24-04-x64", or a snapshot's id. */
	image: string;
	region: string;
	/** Run once on first boot by cloud-init. */
	userData: string;
	tags: string[];
	sshKeys?: string[];
}

/** A firewall as `DigitalOceanApi` finds it. */
export interface DigitalOceanFirewall {
	id: string;
	dropletIds: string[];
}

/** How long an action is waited on before it counts as stuck. */
const ACTION_POLL = Duration.secs(2);
const ACTION_LIMIT = Duration.mins(20);

/** Anywhere, IPv4 and IPv6 alike: where a machine may reach out to. */
const ANYWHERE = ["0.0.0.0/0", "::/0"];

const DropletJson = z.object({
	id: z.number(),
	name: z.string(),
	status: z.string(),
	size_slug: z.string(),
	region: z.object({ slug: z.string() }),
	networks: z.object({
		v4: z.array(z.object({ ip_address: z.string(), type: z.string() })),
	}),
	tags: z.array(z.string()),
	features: z.array(z.string()),
	created_at: z.string(),
});

const Action = z.object({
	id: z.number(),
	status: z.string(),
	type: z.string(),
});

const SshKey = z.object({
	id: z.number(),
	name: z.string(),
	public_key: z.string(),
});

const Firewall = z.object({
	id: z.string(),
	name: z.string(),
	droplet_ids: z
		.array(z.number())
		.nullable()
		.transform((ids) => ids ?? []),
});

const Answers = {
	sizes: z.object({
		sizes: z.array(
			z.object({
				slug: z.string(),
				available: z.boolean(),
				regions: z.array(z.string()),
			}),
		),
	}),
	droplet: z.object({ droplet: DropletJson }),
	droplets: z.object({ droplets: z.array(DropletJson) }),
	made: z.object({
		droplet: DropletJson,
		links: z.object({ actions: z.array(z.object({ id: z.number() })) }),
	}),
	action: z.object({ action: Action }),
	snapshots: z.object({
		snapshots: z.array(z.object({ id: z.number(), name: z.string() })),
	}),
	images: z.object({ images: z.array(z.object({ id: z.number() })) }),
	sshKey: z.object({ ssh_key: SshKey }),
	sshKeys: z.object({ ssh_keys: z.array(SshKey) }),
	firewall: z.object({ firewall: Firewall }),
	firewalls: z.object({ firewalls: z.array(Firewall) }),
	any: z.unknown(),
};

function dropletOf(json: z.infer<typeof DropletJson>): DigitalOceanDroplet {
	return {
		id: String(json.id),
		name: json.name,
		status: json.status,
		size: json.size_slug,
		region: json.region.slug,
		ipv4:
			json.networks.v4.find((each) => each.type === "public")?.ip_address ??
			null,
		tags: json.tags,
		backups: json.features.includes("backups"),
		createdAt: Date.parse(json.created_at),
	};
}

/**
 * A firewall's body: `rules` in, and everything out, since a DigitalOcean
 * firewall with no outbound rules lets nothing out.
 */
function firewallJson(
	name: string,
	rules: FirewallRule[],
	dropletIds: string[],
): object {
	return {
		name,
		inbound_rules: rules.map((rule) => ({
			protocol: rule.protocol,
			...(rule.protocol === "icmp" ? {} : { ports: rule.port }),
			sources: { addresses: rule.sourceIps },
		})),
		outbound_rules: (["tcp", "udp", "icmp"] as const).map((protocol) => ({
			protocol,
			...(protocol === "icmp" ? {} : { ports: "all" }),
			destinations: { addresses: ANYWHERE },
		})),
		droplet_ids: dropletIds.map(Number),
	};
}

/** DigitalOcean's message for a refusal, which names what was wrong. */
async function reason(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	try {
		const parsed = JSON.parse(text) as { message?: string };
		return parsed.message ?? (text || "no reason given");
	} catch {
		return text || "no reason given";
	}
}
