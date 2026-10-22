import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import { DigitalOceanError } from "./digitalocean-error";
import type { CloudSize } from "./provider";

/** The device cred the DigitalOcean API token is kept as, named as DigitalOcean's own tools read it. */
export const DIGITALOCEAN_TOKEN = "DIGITALOCEAN_TOKEN";

const API = "https://api.digitalocean.com/v2";

/** The most of anything one page lists; splates makes far fewer. */
const PAGE = 200;

/**
 * The DigitalOcean API, as far as splates makes machines in the user's own
 * account: which sizes can be ordered where right now, and making, finding
 * and deleting droplets and snapshots. Tags are how splates finds what it
 * made: it keeps no
 * state of its own about them.
 */
export class DigitalOceanApi {
	constructor(
		private readonly token: string,
		private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
		private readonly wait: (duration: Duration) => Promise<void> = sleep,
	) {}

	/**
	 * Each size orderable now in some region, GPU sizes left out. Basic
	 * sizes, `s-`, share their CPUs; the rest have their own. DigitalOcean
	 * bills a droplet by the second, at least a minute.
	 */
	async sizes(): Promise<CloudSize[]> {
		const { sizes } = await this.request(
			"GET",
			`/sizes?per_page=${PAGE}`,
			Answers.sizes,
		);
		return sizes
			.filter(
				(size) =>
					size.available &&
					size.regions.length > 0 &&
					size.gpu_info == null &&
					!size.slug.startsWith("gpu-"),
			)
			.map((size) => ({
				name: size.slug,
				cpus: size.vcpus,
				memory: size.memory / 1024,
				disk: size.disk,
				dedicated: !size.slug.startsWith("s-"),
				dollarsPerHour: size.price_hourly,
				billing: "second",
				locations: new Set(size.regions),
			}));
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
			},
		});
		for (const action of made.links.actions) {
			await this.settle(action.id);
		}
		return (
			(await this.droplet(String(made.droplet.id))) ?? dropletOf(made.droplet)
		);
	}

	/** Deletes droplet `id`; silent when it is already gone. */
	async deleteDroplet(id: string): Promise<void> {
		await this.request("DELETE", `/droplets/${id}`, Answers.any, {
			missing: true,
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
		return (await this.images(tag)).map((image) => String(image.id));
	}

	/** The snapshots tagged `tag`, each with the size DigitalOcean bills it by. */
	async images(tag: string): Promise<{ id: string; gigabytes: number }[]> {
		const found = await this.request(
			"GET",
			`/images?private=true&per_page=${PAGE}&tag_name=${encodeURIComponent(tag)}`,
			Answers.images,
		);
		return found.images.map((image) => ({
			id: String(image.id),
			gigabytes: image.size_gigabytes ?? 0,
		}));
	}

	/** Deletes image `id`; silent when it is already gone. */
	async deleteImage(id: string): Promise<void> {
		await this.request("DELETE", `/images/${id}`, Answers.any, {
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
			throw new DigitalOceanError(
				response.status,
				await reason(response),
				`${method} ${path.replace(/\?.*/, "")}`,
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
}

/** How long an action is waited on before it counts as stuck. */
const ACTION_POLL = Duration.secs(2);
const ACTION_LIMIT = Duration.mins(20);

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
	created_at: z.string(),
});

const Action = z.object({
	id: z.number(),
	status: z.string(),
	type: z.string(),
});

const Answers = {
	sizes: z.object({
		sizes: z.array(
			z.object({
				slug: z.string(),
				available: z.boolean(),
				regions: z.array(z.string()),
				price_hourly: z.number(),
				vcpus: z.number(),
				// In MB, and the disk in GB.
				memory: z.number(),
				disk: z.number(),
				gpu_info: z.unknown().optional(),
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
	images: z.object({
		images: z.array(
			z.object({ id: z.number(), size_gigabytes: z.number().optional() }),
		),
	}),
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
		createdAt: Date.parse(json.created_at),
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
