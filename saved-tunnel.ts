import type { SecretStore } from "webappwiz/creds";
import type { Fs } from "webappwiz/system";
import { z } from "zod";

/** The file's own format. */
const FORMAT = 1;

/** The name the tunnel's token is kept under in the system's secret store. */
export const TUNNEL_TOKEN = "ARBOR_TUNNEL_TOKEN";

/** What `arbor tunnel setup` made, which a bare `arbor dev` runs. */
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
 * since one `arbor dev` serves every project: what it is in
 * `~/.arbor/tunnel.json`, and the token that runs it, a secret of this
 * machine, in the device's secret store, as the cred `TUNNEL_TOKEN`.
 */
export class SavedTunnel {
	constructor(
		/** `~/.arbor/tunnel.json`, or a test's own. */
		readonly path: string,
		private readonly deps: {
			fs: Fs;
			/** The device's store, which `arbor tunnel setup` saves the token in. */
			store: SecretStore;
		},
	) {}

	/** What was saved, or null when nothing was, or its format is newer. */
	async read(): Promise<TunnelRecord | null> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return null;
		}
		const parsed = Saved.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(
				`${this.path} is not a tunnel arbor saved: remove it, or run \`arbor tunnel setup\` again`,
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
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")), {
			recursive: true,
		});
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, ...record }, null, "\t")}\n`,
		);
		await this.deps.fs.rename(tmp, this.path);
	}
}
