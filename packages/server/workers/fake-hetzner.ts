/** A server as `FakeHetzner` keeps it, in Hetzner's own JSON. */
export interface FakeServer {
	id: number;
	name: string;
	status: string;
	server_type: { name: string };
	datacenter: { location: { name: string } };
	public_net: { ipv4: { ip: string } | null };
	labels: Record<string, string>;
	protection: { delete: boolean; rebuild: boolean };
	backup_window: string | null;
	/** When it was made, as Hetzner writes it. */
	created: string;
	image: string;
	user_data: string;
	ssh_keys: number[];
	firewalls: { firewall: number }[];
}

/** A request `FakeHetzner` was sent. */
export interface FakeHetznerRequest {
	method: string;
	/** Its path under `/v1`, without the query. */
	path: string;
	query: URLSearchParams;
	body: Record<string, unknown> | null;
}

/**
 * The Hetzner Cloud API in memory, as `HetznerApi` calls it, for tests: its
 * `fetch` answers servers, snapshots, SSH keys, firewalls and actions.
 */
export class FakeHetzner {
	/** Server type names orderable now, by location. */
	stock: Record<string, string[]> = {};
	readonly servers = new Map<number, FakeServer>();
	readonly images = new Map<
		number,
		{ id: number; labels: Record<string, string> }
	>();
	readonly sshKeys = new Map<
		number,
		{ id: number; name: string; public_key: string }
	>();
	readonly firewalls = new Map<
		number,
		{ id: number; name: string; rules: unknown[] }
	>();
	readonly requests: FakeHetznerRequest[] = [];
	/** When set, creating a server is refused with it. */
	refuseCreate: string | null = null;
	/** Whether each action runs until it is first looked at, rather than being done at once. */
	actionsRun = false;
	/** The status a server is made with. */
	bootStatus = "running";
	private next = 42;

	constructor(private readonly token = "token") {}

	readonly fetch = (async (url: string, init?: RequestInit) => {
		const auth = new Headers(init?.headers).get("Authorization");
		if (auth !== `Bearer ${this.token}`) {
			return error(401, "unauthorized");
		}
		const { pathname, searchParams } = new URL(url);
		const path = pathname.replace(/^\/v1/, "");
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as Record<string, unknown>)
				: null;
		this.requests.push({ method, path, query: searchParams, body });
		return this.answer(method, path.split("/").slice(1), searchParams, body);
	}) as unknown as typeof globalThis.fetch;

	/** Puts a server in place as though it had been made, with `fields` over a running one's. */
	put(fields: Partial<FakeServer>): FakeServer {
		const id = this.next++;
		const server: FakeServer = {
			id,
			name: `server-${id}`,
			status: "running",
			server_type: { name: "cpx22" },
			datacenter: { location: { name: "nbg1" } },
			public_net: { ipv4: { ip: `203.0.113.${id % 256}` } },
			labels: {},
			protection: { delete: false, rebuild: false },
			backup_window: null,
			created: new Date().toISOString(),
			image: "ubuntu-24.04",
			user_data: "",
			ssh_keys: [],
			firewalls: [],
			...fields,
		};
		this.servers.set(id, server);
		return server;
	}

	/** Each request as `METHOD /path`. */
	calls(): string[] {
		return this.requests.map((each) => `${each.method} ${each.path}`);
	}

	/** The servers carrying label `key`, or `key=value`. */
	labelled(selector: string): FakeServer[] {
		return [...this.servers.values()].filter((server) =>
			matches(server.labels, selector),
		);
	}

	private answer(
		method: string,
		[kind, id, sub, verb]: string[],
		query: URLSearchParams,
		body: Record<string, unknown> | null,
	): Response {
		const key = `${method} ${kind}${id === undefined ? "" : "/:id"}${sub === undefined ? "" : `/${sub}/${verb}`}`;
		switch (key) {
			case "GET server_types":
				return Response.json({ server_types: this.types() });
			case "GET datacenters":
				return Response.json({
					datacenters: Object.entries(this.stock).map(([name, types]) => ({
						location: { name },
						server_types: {
							available: types.map((type) => this.typeId(type)),
						},
					})),
				});
			case "GET servers":
				return Response.json({
					servers: this.labelled(query.get("label_selector") ?? ""),
				});
			case "GET servers/:id": {
				const server = this.servers.get(Number(id));
				return server === undefined
					? error(404, "not found")
					: Response.json({ server });
			}
			case "POST servers":
				return this.createServer(body ?? {});
			case "DELETE servers/:id": {
				const server = this.servers.get(Number(id));
				if (server === undefined) {
					return error(404, "not found");
				}
				if (server.protection.delete) {
					return error(423, "server is delete protected");
				}
				this.servers.delete(server.id);
				return Response.json({ action: this.action() });
			}
			case "POST servers/:id/actions/change_protection":
			case "POST servers/:id/actions/enable_backup":
			case "POST servers/:id/actions/create_image":
				return this.serverAction(Number(id), verb as string, body ?? {});
			case "GET images":
				return Response.json({
					images: [...this.images.values()].filter((image) =>
						matches(image.labels, query.get("label_selector") ?? ""),
					),
				});
			case "DELETE images/:id":
				return this.images.delete(Number(id))
					? new Response(null, { status: 204 })
					: error(404, "not found");
			case "GET ssh_keys":
				return Response.json({
					ssh_keys: [...this.sshKeys.values()].filter(
						(each) => each.name === query.get("name"),
					),
				});
			case "POST ssh_keys": {
				const made = {
					id: this.next++,
					name: String(body?.name),
					public_key: String(body?.public_key),
				};
				this.sshKeys.set(made.id, made);
				return Response.json({ ssh_key: made }, { status: 201 });
			}
			case "DELETE ssh_keys/:id":
				return this.sshKeys.delete(Number(id))
					? new Response(null, { status: 204 })
					: error(404, "not found");
			case "GET firewalls":
				return Response.json({
					firewalls: [...this.firewalls.values()].filter(
						(each) => each.name === query.get("name"),
					),
				});
			case "POST firewalls": {
				const made = {
					id: this.next++,
					name: String(body?.name),
					rules: (body?.rules as unknown[]) ?? [],
				};
				this.firewalls.set(made.id, made);
				return Response.json({ firewall: made, actions: [] }, { status: 201 });
			}
			case "POST firewalls/:id/actions/set_rules": {
				const firewall = this.firewalls.get(Number(id));
				if (firewall === undefined) {
					return error(404, "not found");
				}
				firewall.rules = (body?.rules as unknown[]) ?? [];
				return Response.json({ actions: [] }, { status: 201 });
			}
			case "DELETE firewalls/:id": {
				const used = [...this.servers.values()].some((server) =>
					server.firewalls.some((each) => each.firewall === Number(id)),
				);
				if (used) {
					return error(422, "firewall is still in use");
				}
				return this.firewalls.delete(Number(id))
					? new Response(null, { status: 204 })
					: error(404, "not found");
			}
			case "GET actions/:id":
				return Response.json({
					action: { id: Number(id), status: "success" },
				});
			default:
				return error(404, `no fake for ${key}`);
		}
	}

	private createServer(body: Record<string, unknown>): Response {
		if (this.refuseCreate !== null) {
			return error(403, this.refuseCreate);
		}
		const id = this.next++;
		const server: FakeServer = {
			id,
			name: String(body.name),
			status: this.bootStatus,
			server_type: { name: String(body.server_type) },
			datacenter: { location: { name: String(body.location) } },
			public_net: { ipv4: { ip: `203.0.113.${id % 256}` } },
			labels: (body.labels as Record<string, string>) ?? {},
			protection: { delete: false, rebuild: false },
			backup_window: null,
			created: new Date().toISOString(),
			image: String(body.image),
			user_data: String(body.user_data ?? ""),
			ssh_keys: (body.ssh_keys as number[]) ?? [],
			firewalls: (body.firewalls as { firewall: number }[]) ?? [],
		};
		this.servers.set(id, server);
		return Response.json({ server, action: this.action() }, { status: 201 });
	}

	private serverAction(
		id: number,
		verb: string,
		body: Record<string, unknown>,
	): Response {
		const server = this.servers.get(id);
		if (server === undefined) {
			return error(404, "not found");
		}
		if (verb === "change_protection") {
			server.protection = {
				delete: Boolean(body.delete),
				rebuild: Boolean(body.rebuild),
			};
		} else if (verb === "enable_backup") {
			server.backup_window = "22-02";
		} else {
			const image = {
				id: this.next++,
				labels: (body.labels as Record<string, string>) ?? {},
			};
			this.images.set(image.id, image);
			return Response.json({ image, action: this.action() }, { status: 201 });
		}
		return Response.json({ action: this.action() }, { status: 201 });
	}

	/** A new action, as `actionsRun` says. */
	private action(): { id: number; status: string } {
		return { id: this.next++, status: this.actionsRun ? "running" : "success" };
	}

	private types(): { id: number; name: string }[] {
		const names = [...new Set(Object.values(this.stock).flat())].sort();
		return names.map((name) => ({ id: this.typeId(name), name }));
	}

	private typeId(name: string): number {
		return [...name].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7);
	}
}

/** Whether `labels` match a selector of `key` or `key=value`. */
function matches(labels: Record<string, string>, selector: string): boolean {
	const [key, value] = selector.split("=");
	if (key === undefined || !(key in labels)) {
		return false;
	}
	return value === undefined || labels[key] === value;
}

function error(status: number, message: string): Response {
	return Response.json({ error: { code: "fake", message } }, { status });
}
