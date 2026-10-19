import type { SecretStore } from "webappwiz/creds";
import { z } from "zod";
import type { Document, Storage } from "../storage";

/** The file's own format. */
const FORMAT = 1;

/** The name the tunnel's token is kept under in the system's secret store. */
export const TUNNEL_TOKEN = "SPLATES_TUNNEL_TOKEN";

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
	 * The cred its token is kept as, when not `TUNNEL_TOKEN`: a slot's own,
	 * since every slot runs a tunnel of its own.
	 */
	token?: string;
}

const Saved = z.object({
	format: z.number(),
	host: z.string(),
	team: z.string(),
	aud: z.string(),
	tunnel: z.string(),
	token: z.string().optional(),
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
		},
	) {}

	/** The tunnel saved in `storage`, a machine's or a slot's. */
	static in(storage: Storage, store: SecretStore): SavedTunnel {
		return new SavedTunnel(storage.document("tunnel.json"), { store });
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

	/** The token that runs the saved tunnel, or undefined when the store lost it. */
	async token(): Promise<string | undefined> {
		const record = await this.read();
		return this.deps.store.get(record?.token ?? TUNNEL_TOKEN);
	}

	/** Keeps `record` in the file, over what was there; its token is a cred. */
	async save(record: TunnelRecord): Promise<void> {
		await this.file.write({ format: FORMAT, ...record });
	}
}
