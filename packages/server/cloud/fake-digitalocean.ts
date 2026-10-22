/** A droplet as `FakeDigitalOcean` keeps it, in DigitalOcean's own JSON. */
export interface FakeDroplet {
	id: number;
	name: string;
	status: string;
	size_slug: string;
	region: { slug: string };
	networks: { v4: { ip_address: string; type: string }[] };
	tags: string[];
	/** When it was made, as DigitalOcean writes it. */
	created_at: string;
	image: string | number;
	user_data: string;
	snapshots: { id: number; name: string }[];
}

/** A request `FakeDigitalOcean` was sent. */
export interface FakeDigitalOceanRequest {
	method: string;
	/** Its path under `/v2`, without the query. */
	path: string;
	query: URLSearchParams;
	body: Record<string, unknown> | null;
}

/**
 * The DigitalOcean API in memory, as `DigitalOceanApi` calls it, for tests:
 * its `fetch` answers droplets, snapshots, tags and actions.
 */
export class FakeDigitalOcean {
	/** Size slugs orderable now, by region. */
	stock: Record<string, string[]> = {};
	/** What each size slug costs an hour, as `/v2/sizes` says; $0.50 for one not named. */
	prices: Record<string, number> = {};
	readonly droplets = new Map<number, FakeDroplet>();
	readonly images = new Map<
		number,
		{ id: number; tags: string[]; size_gigabytes?: number }
	>();
	readonly tags = new Set<string>();
	readonly requests: FakeDigitalOceanRequest[] = [];
	/** When set, creating a droplet is refused with it. */
	refuseCreate: string | null = null;
	/** Whether each action runs until it is first looked at, rather than being done at once. */
	actionsRun = false;
	private readonly running = new Set<number>();
	private next = 42;

	constructor(private readonly token = "token") {}

	readonly fetch = (async (url: string, init?: RequestInit) => {
		const auth = new Headers(init?.headers).get("Authorization");
		if (auth !== `Bearer ${this.token}`) {
			return error(401, "unauthorized");
		}
		const { pathname, searchParams } = new URL(url);
		const path = pathname.replace(/^\/v2/, "");
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as Record<string, unknown>)
				: null;
		this.requests.push({ method, path, query: searchParams, body });
		const segments = path.split("/").slice(1);
		// Ids are numbers, firewall ids `fw-`, and whatever names a tag.
		const isId = (each: string, at: number) =>
			/^\d+$/.test(each) ||
			each.startsWith("fw-") ||
			segments[at - 1] === "tags";
		const id = segments.find(isId);
		const key = `${method} ${segments.map((each, at) => (isId(each, at) ? ":id" : each)).join("/")}`;
		return this.answer(key, id, searchParams, body);
	}) as unknown as typeof globalThis.fetch;

	/** Each request as `METHOD /path`. */
	calls(): string[] {
		return this.requests.map((each) => `${each.method} ${each.path}`);
	}

	/** The droplets carrying tag `tag`. */
	tagged(tag: string): FakeDroplet[] {
		return [...this.droplets.values()].filter((droplet) =>
			droplet.tags.includes(tag),
		);
	}

	private answer(
		key: string,
		id: string | undefined,
		query: URLSearchParams,
		body: Record<string, unknown> | null,
	): Response {
		switch (key) {
			case "GET account":
				return Response.json({ account: { status: "active" } });
			case "GET sizes": {
				const slugs = [...new Set(Object.values(this.stock).flat())];
				return Response.json({
					sizes: slugs.map((slug) => ({
						slug,
						available: true,
						regions: Object.keys(this.stock).filter((region) =>
							this.stock[region]?.includes(slug),
						),
						price_hourly: this.prices[slug] ?? 0.5,
					})),
				});
			}
			case "GET droplets":
				return Response.json({
					droplets: this.tagged(query.get("tag_name") ?? ""),
				});
			case "GET droplets/:id": {
				const droplet = this.droplets.get(Number(id));
				return droplet === undefined
					? error(404, "not found")
					: Response.json({ droplet });
			}
			case "POST droplets":
				return this.createDroplet(body ?? {});
			case "DELETE droplets/:id":
				if (!this.droplets.delete(Number(id))) {
					return error(404, "not found");
				}
				return new Response(null, { status: 204 });
			case "POST droplets/:id/actions":
				return this.dropletAction(Number(id), body ?? {});
			case "GET droplets/:id/snapshots": {
				const droplet = this.droplets.get(Number(id));
				return droplet === undefined
					? error(404, "not found")
					: Response.json({ snapshots: droplet.snapshots });
			}
			case "GET images":
				return Response.json({
					images: [...this.images.values()].filter((image) =>
						image.tags.includes(query.get("tag_name") ?? ""),
					),
				});
			case "DELETE images/:id":
				return this.images.delete(Number(id))
					? new Response(null, { status: 204 })
					: error(404, "not found");
			case "POST tags": {
				const name = String(body?.name);
				if (this.tags.has(name)) {
					return error(422, "tag already exists");
				}
				this.tags.add(name);
				return Response.json({ tag: { name } }, { status: 201 });
			}
			case "POST tags/:id/resources": {
				const tag = decodeURIComponent(id as string);
				if (!this.tags.has(tag)) {
					return error(404, "no such tag");
				}
				for (const resource of (body?.resources ?? []) as {
					resource_id: string;
				}[]) {
					this.images.get(Number(resource.resource_id))?.tags.push(tag);
				}
				return new Response(null, { status: 204 });
			}
			case "GET actions/:id": {
				const action = Number(id);
				// A running action is done once it has been looked at.
				const status = this.running.delete(action)
					? "in-progress"
					: "completed";
				return Response.json({ action: { id: action, status, type: "fake" } });
			}
			default:
				return error(404, `no fake for ${key}`);
		}
	}

	private createDroplet(body: Record<string, unknown>): Response {
		if (this.refuseCreate !== null) {
			return error(422, this.refuseCreate);
		}
		const id = this.next++;
		const droplet: FakeDroplet = {
			id,
			name: String(body.name),
			status: "new",
			size_slug: String(body.size),
			region: { slug: String(body.region) },
			networks: {
				v4: [
					{ ip_address: `10.0.0.${id % 256}`, type: "private" },
					{ ip_address: `203.0.113.${id % 256}`, type: "public" },
				],
			},
			tags: (body.tags as string[]) ?? [],
			created_at: new Date().toISOString(),
			image: body.image as string | number,
			user_data: String(body.user_data ?? ""),
			snapshots: [],
		};
		this.droplets.set(id, droplet);
		const action = this.action();
		// It is up once its create action is.
		droplet.status = "active";
		return Response.json(
			{
				droplet: { ...droplet, status: "new" },
				links: { actions: [{ id: action }] },
			},
			{ status: 202 },
		);
	}

	private dropletAction(id: number, body: Record<string, unknown>): Response {
		const droplet = this.droplets.get(id);
		if (droplet === undefined) {
			return error(404, "not found");
		}
		if (body.type === "snapshot") {
			const image = { id: this.next++, tags: [] };
			this.images.set(image.id, image);
			droplet.snapshots.push({ id: image.id, name: String(body.name) });
		} else {
			return error(422, `no fake for action ${String(body.type)}`);
		}
		return Response.json(
			{ action: { id: this.action(), status: "in-progress", type: body.type } },
			{ status: 201 },
		);
	}

	/** A new action's id, running as `actionsRun` says. */
	private action(): number {
		const id = this.next++;
		if (this.actionsRun) {
			this.running.add(id);
		}
		return id;
	}
}

function error(status: number, message: string): Response {
	return Response.json({ id: "fake", message }, { status });
}
