import { CLOUDFLARE_API } from "./cloudflare-api";

interface Zone {
	id: string;
	name: string;
	account: { id: string };
}

interface Tunnel {
	id: string;
	name: string;
	config_src: string;
}

interface DnsRecord {
	id: string;
	type: string;
	name: string;
	content: string;
	proxied: boolean;
}

interface Policy {
	id: string;
	name: string;
	decision: string;
	include: Record<string, unknown>[];
}

interface App {
	id: string;
	type: string;
	name: string;
	domain: string;
	aud: string;
	policies: { id: string; precedence: number }[];
}

/**
 * Cloudflare's v4 API as far as `arbor tunnel setup` calls it, kept in
 * memory: a test seeds an account, hands `fetch` to the setup, then reads
 * back what is there and each call that changed it.
 */
export class FakeCloudflare {
	readonly zones: Zone[] = [];
	readonly tunnels: Tunnel[] = [];
	readonly records: DnsRecord[] = [];
	readonly policies: Policy[] = [];
	readonly apps: App[] = [];
	/** `auth_domain` of the Zero Trust organization, or null for none set up. */
	team: string | null = "team.cloudflareaccess.com";
	/** Every call but a GET, as `METHOD /path`, in order. */
	readonly changes: string[] = [];
	/** The bearer token each call carried. */
	readonly tokens = new Set<string>();
	private next = 1;

	/** Adds the zone `name` to account `account`. */
	zone(name: string, account = "acct"): this {
		this.zones.push({ id: `zone-${name}`, name, account: { id: account } });
		return this;
	}

	readonly fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			const method = init?.method ?? "GET";
			const path = url.pathname.slice(new URL(CLOUDFLARE_API).pathname.length);
			this.tokens.add(new Headers(init?.headers).get("authorization") ?? "");
			if (method !== "GET") {
				this.changes.push(`${method} ${path}`);
			}
			const body = init?.body ? JSON.parse(String(init.body)) : undefined;
			const result = this.answer(method, path, url.searchParams, body);
			return result === undefined
				? Response.json(
						{ success: false, errors: [{ code: 7003, message: "No route" }] },
						{ status: 404 },
					)
				: Response.json({
						success: true,
						errors: [],
						result,
						...(Array.isArray(result)
							? { result_info: { total_pages: 1 } }
							: {}),
					});
		},
		{ preconnect: () => {} },
	);

	private answer(
		method: string,
		path: string,
		query: URLSearchParams,
		body: Record<string, unknown> | undefined,
	): unknown {
		const parts = path.split("/").slice(1);
		const id = () => `id-${this.next++}`;
		if (path === "/zones") {
			return this.zones.filter((zone) => zone.name === query.get("name"));
		}
		if (parts[0] === "zones" && parts[2] === "dns_records") {
			const record = this.records.find((each) => each.id === parts[3]);
			if (method === "GET") {
				return this.records.filter(
					(each) => each.name === query.get("name.exact"),
				);
			}
			if (method === "POST") {
				const made = { id: id(), ...body } as DnsRecord;
				this.records.push(made);
				return made;
			}
			return record && Object.assign(record, body);
		}
		const [, , area, kind, item, extra] = parts;
		if (area === "access" && kind === "organizations") {
			if (method === "POST") {
				this.team = String(body?.auth_domain);
			}
			return this.team === null ? undefined : { auth_domain: this.team };
		}
		if (area === "cfd_tunnel") {
			if (method === "POST") {
				const made = { id: id(), ...body } as Tunnel;
				this.tunnels.push(made);
				return made;
			}
			if (kind !== undefined && item === "token") {
				return `token-of-${kind}`;
			}
			return this.tunnels.filter((tunnel) => tunnel.name === query.get("name"));
		}
		if (area === "access" && kind === "policies") {
			return this.keep(this.policies, method, item, body, id);
		}
		if (area === "access" && kind === "apps" && extra === undefined) {
			if (method === "GET") {
				return this.apps.filter((app) => app.domain === query.get("domain"));
			}
			return this.keep(
				this.apps,
				method,
				item,
				method === "POST" ? { ...body, aud: `aud-${this.next}` } : body,
				id,
			);
		}
		return undefined;
	}

	/** Lists, makes, or replaces an item of `items`, as the method says. */
	private keep<T extends { id: string }>(
		items: T[],
		method: string,
		item: string | undefined,
		body: Record<string, unknown> | undefined,
		id: () => string,
	): unknown {
		if (method === "GET") {
			return items;
		}
		if (method === "POST") {
			const made = { id: id(), ...body } as unknown as T;
			items.push(made);
			return made;
		}
		const found = items.find((each) => each.id === item);
		return found && Object.assign(found, body);
	}
}
