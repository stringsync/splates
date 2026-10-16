import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { fail } from "./exit";

/** The file's own format. */
const FORMAT = 1;

/** What `--ports-host` takes to forget the saved base host. */
export const NO_PORTS_HOST = "none";

const Saved = z.object({ format: z.number(), base: z.string() });

/**
 * The wildcard base host this machine serves task ports under, as
 * `<task>-<port>.<base>`: saved by `arbor dev --ports-host`, per machine as
 * the tunnel is, in `~/.arbor/ports.json`, so a bare `arbor dev` serves it.
 */
export class SavedPortsHost {
	constructor(
		/** `~/.arbor/ports.json`, or a test's own. */
		readonly path: string,
		private readonly fs: Fs,
	) {}

	/** The saved base, or null when none is, or its format is newer. */
	async read(): Promise<string | null> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return null;
		}
		const parsed = Saved.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(
				`${this.path} is not a ports host arbor saved: remove it, or run \`arbor dev --ports-host\` again`,
			);
		}
		return parsed.data.format > FORMAT ? null : parsed.data.base;
	}

	/** Keeps `base`, over what was there, or forgets it for null. */
	async save(base: string | null): Promise<void> {
		if (base === null) {
			await this.fs.rm(this.path, { force: true });
			return;
		}
		await this.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")), {
			recursive: true,
		});
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, base }, null, "\t")}\n`,
		);
		await this.fs.rename(tmp, this.path);
	}
}

/**
 * What `--ports-host` asks for: a base host to save, null to forget the
 * saved one, or undefined to serve whatever was saved.
 */
export function portsHostFlag(flag: string): string | null | undefined {
	const base = flag.trim().toLowerCase().replace(/^\*\./, "");
	if (base === "") {
		return undefined;
	}
	if (base === NO_PORTS_HOST) {
		return null;
	}
	if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(base)) {
		fail(
			"usage",
			`invalid ports host '${flag}': give a host name such as ports.example.com, its wildcard *.ports.example.com routed to arbor dev`,
			{ host: flag },
		);
	}
	return base;
}
