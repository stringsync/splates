import { z } from "zod";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";

/** The file's own format. */
const FORMAT = 1;

/** What `--ports-host` takes to forget the saved base host. */
export const NO_PORTS_HOST = "none";

const Saved = z.object({ format: z.number(), base: z.string() });

/**
 * The wildcard base host this machine serves task ports under, as
 * `<task>-<port>.<base>`: saved by `splates server --ports-host`, per machine as
 * the tunnel is, in `~/.splates/ports.json`, so a bare `splates server` serves it.
 */
export class SavedPortsHost {
	constructor(
		/** `~/.splates/ports.json`, or a test's own. */
		private readonly file: Document<unknown>,
	) {}

	/** The ports host saved in `storage`. */
	static in(storage: Storage): SavedPortsHost {
		return new SavedPortsHost(storage.document("ports.json"));
	}

	/** The saved base, or null when none is, or its format is newer. */
	async read(): Promise<string | null> {
		const raw = await this.file.read();
		if (raw === null) {
			return null;
		}
		const parsed = Saved.safeParse(raw);
		if (!parsed.success) {
			throw new Error(
				`${this.file.key} is not a ports host splates saved: remove it, or run \`splates server --ports-host\` again`,
			);
		}
		return parsed.data.format > FORMAT ? null : parsed.data.base;
	}

	/** Keeps `base`, over what was there, or forgets it for null. */
	async save(base: string | null): Promise<void> {
		if (base === null) {
			await this.file.remove();
			return;
		}
		await this.file.write({ format: FORMAT, base });
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
			`invalid ports host '${flag}': give a host name such as ports.example.com, its wildcard *.ports.example.com routed to splates server`,
			{ host: flag },
		);
	}
	return base;
}
