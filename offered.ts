import type { Fs } from "webappwiz/system";
import type { Setting } from "./conversations";

/** The file's own format. */
const FORMAT = 1;

/**
 * What each agent's sessions last offered, from any project, kept under the
 * user's home: a project's first conversation with an agent can show its
 * Mode and Model before the agent starts, each where it was last left.
 */
export class Offered {
	/** Read once, then kept: this process is the one writing it. */
	private known: Promise<Record<string, Setting[]>> | null = null;
	/** Set when a newer arbor wrote the file, which this one leaves alone. */
	private newer = false;
	/** Writes one after another, so none is lost to another. */
	private writing: Promise<void> = Promise.resolve();

	constructor(
		/** `~/.arbor/offered.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/** Every agent's settings, by its id; none for one never started. */
	async all(): Promise<Record<string, Setting[]>> {
		this.known ??= this.read();
		return this.known;
	}

	/**
	 * Keeps `settings` as what `agent`'s sessions offer from now on, or, with
	 * `unlessKnown`, only when nothing is kept for it yet.
	 */
	async remember(
		agent: string,
		settings: Setting[],
		{ unlessKnown = false }: { unlessKnown?: boolean } = {},
	): Promise<void> {
		const all = await this.all();
		if (unlessKnown && all[agent] !== undefined) {
			return this.writing;
		}
		const known = { ...all, [agent]: settings };
		this.known = Promise.resolve(known);
		if (!this.newer) {
			this.writing = this.writing.then(() => this.write(known));
		}
		return this.writing;
	}

	private async read(): Promise<Record<string, Setting[]>> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		try {
			const parsed = JSON.parse(raw ?? "{}") as {
				format?: number;
				agents?: Record<string, Setting[]>;
			};
			// Only a cache: one it cannot read starts over rather than refusing.
			this.newer = (parsed.format ?? FORMAT) > FORMAT;
			return this.newer ? {} : (parsed.agents ?? {});
		} catch {
			return {};
		}
	}

	private async write(agents: Record<string, Setting[]>): Promise<void> {
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, agents }, null, "\t")}\n`,
		);
		await this.deps.fs.rename(tmp, this.path);
	}
}
