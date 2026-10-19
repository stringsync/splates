import type { Fs } from "webappwiz/system";
import { fail } from "../exit";

/** The format of `auto-run.json`, which a newer splates may write past this one. */
const AUTO_RUN_FORMAT = 1;

/**
 * Whether the queue queues each ready task itself, the person's alone and
 * off until they turn it on, kept in one file under their home as the
 * roster is: one choice for every project on the machine.
 */
export class AutoRunStore {
	constructor(
		/** `~/.splates/auto-run.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/** Whether auto-run is on; off when there is no file. */
	async on(): Promise<boolean> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return false;
		}
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
		const { format, on } = (json ?? {}) as { format?: unknown; on?: unknown };
		if (typeof format === "number" && format > AUTO_RUN_FORMAT) {
			fail(
				"outdated",
				`${this.path} is in format ${format}, written by a newer splates; this one understands up to ${AUTO_RUN_FORMAT}, so it leaves it alone.`,
				{ path: this.path, format, understood: AUTO_RUN_FORMAT },
			);
		}
		return on === true;
	}

	/** Turns auto-run on or off. */
	async set(on: boolean): Promise<void> {
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")), {
			recursive: true,
		});
		await this.deps.fs.write(
			this.path,
			`${JSON.stringify({ format: AUTO_RUN_FORMAT, on }, null, "\t")}\n`,
		);
	}

	/** Forgets the choice, back to off. */
	async remove(): Promise<void> {
		await this.deps.fs.rm(this.path, { force: true });
	}
}
