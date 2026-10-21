import type { SecretStore } from "webappwiz/creds";
import { z } from "zod";
import type { Document, Storage } from "../storage";
import { CloudflareApi } from "./cloudflare-api";

/** The file's own format, which a box's record from its stack is written in too. */
export const FORMAT = 1;

/** The name the tunnel's token is kept under in the system's secret store. */
export const TUNNEL_TOKEN = "SPLATES_TUNNEL_TOKEN";

/**
 * The cred the Cloudflare API token is kept as, on the device, since the
 * account is the person's. Not `CLOUDFLARE_API_TOKEN`, which scry's Workers
 * AI token goes by in the same store.
 */
export const API_TOKEN = "SPLATES_CLOUDFLARE_API_TOKEN";

/** What `splates tunnel setup` made, which a bare `splates server` runs. */
export interface TunnelRecord {
	/** The public host name the tunnel carries to the page. */
	host: string;
	/** The Zero Trust team, as in `<team>.cloudflareaccess.com`. */
	team: string;
	/** The AUD tag of the Access application in front of `host`. */
	aud: string;
	/** The Cloudflare tunnel's id. */
	tunnel: string;
	/**
	 * The account a slot's tunnel is in, whose token is asked of the API at
	 * each start rather than kept, so slots leave no creds behind. The
	 * machine's tunnel has none: its token is kept as `TUNNEL_TOKEN`.
	 */
	account?: string;
}

const Saved = z.object({
	format: z.number(),
	host: z.string(),
	team: z.string(),
	aud: z.string(),
	tunnel: z.string(),
	account: z.string().optional(),
});

/**
 * The tunnel this machine set up, kept per machine rather than per project,
 * since one `splates server` serves every project: what it is in
 * `~/.splates/tunnel.json`, and the token that runs it, a secret of this
 * machine, in the device's secret store, as the cred `TUNNEL_TOKEN`.
 */
export class SavedTunnel {
	constructor(
		/** `~/.splates/tunnel.json`, or a test's own. */
		private readonly file: Document<unknown>,
		private readonly deps: {
			/** The device's store, which `splates tunnel setup` saves the token in. */
			store: SecretStore;
			/** How a slot's token is asked of the Cloudflare API. */
			fetch?: typeof fetch;
		},
	) {}

	/** The tunnel saved in `storage`, a machine's or a slot's. */
	static in(
		storage: Storage,
		store: SecretStore,
		fetch?: typeof globalThis.fetch,
	): SavedTunnel {
		return new SavedTunnel(storage.document("tunnel.json"), { store, fetch });
	}

	/** Where it is kept, as a key of the storage it is in. */
	get key(): string {
		return this.file.key;
	}

	/** Forgets what was saved; its token is a cred, left to the caller. */
	forget(): Promise<void> {
		return this.file.remove();
	}

	/** What was saved, or null when nothing was, or its format is newer. */
	async read(): Promise<TunnelRecord | null> {
		const raw = await this.file.read();
		if (raw === null) {
			return null;
		}
		const parsed = Saved.safeParse(raw);
		if (!parsed.success) {
			throw new Error(
				`${this.file.key} is not a tunnel splates saved: remove it, or run \`splates tunnel setup\` again`,
			);
		}
		if (parsed.data.format > FORMAT) {
			return null;
		}
		const { format: _, ...record } = parsed.data;
		return record;
	}

	/**
	 * The token that runs the saved tunnel, or undefined when the store lost
	 * it: a slot's asked of the API with the token kept as `API_TOKEN`.
	 */
	async token(): Promise<string | undefined> {
		const record = await this.read();
		if (record?.account === undefined) {
			return this.deps.store.get(TUNNEL_TOKEN);
		}
		const apiToken = await this.deps.store.get(API_TOKEN);
		if (apiToken === undefined) {
			return undefined;
		}
		return new CloudflareApi(apiToken, { fetch: this.deps.fetch }).get(
			`/accounts/${record.account}/cfd_tunnel/${record.tunnel}/token`,
			z.string(),
		);
	}

	/** Keeps `record` in the file, over what was there; its token is a cred. */
	async save(record: TunnelRecord): Promise<void> {
		await this.file.write({ format: FORMAT, ...record });
	}
}
