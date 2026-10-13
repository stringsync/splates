import type { Fs } from "webappwiz/system";
import { heard, type Limit } from "./conversations";

/** The file's own format. */
const FORMAT = 1;

/**
 * Each agent's plan limits as it last said, from any project, kept under the
 * user's home: a new conversation shows how much of the plan is left before
 * any conversation in its project has said.
 */
export class Limits {
	/** Read once, then kept: this process is the one writing it. */
	private known: Promise<Record<string, Limit[]>> | null = null;
	/** Set when a newer arbor wrote the file, which this one leaves alone. */
	private newer = false;
	/** Writes one after another, so none is lost to another. */
	private writing: Promise<void> = Promise.resolve();

	constructor(
		/** `~/.arbor/limits.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/** Every agent's limits, by its id; none for one that never said. */
	async all(): Promise<Record<string, Limit[]>> {
		this.known ??= this.read();
		return this.known;
	}

	/**
	 * Keeps each of `limits` that is newer than what `agent` said of its
	 * window before: a log read back can be older than another project's.
	 */
	async remember(agent: string, limits: Limit[]): Promise<void> {
		const all = await this.all();
		const before = all[agent] ?? [];
		const news = limits.filter((each) => {
			const was = before.find((known) => known.window === each.window);
			return was === undefined || (each.at ?? "") > (was.at ?? "");
		});
		if (news.length === 0) {
			return this.writing;
		}
		const known = { ...all, [agent]: heard(before, news) };
		this.known = Promise.resolve(known);
		if (!this.newer) {
			this.writing = this.writing.then(() => this.write(known));
		}
		return this.writing;
	}

	private async read(): Promise<Record<string, Limit[]>> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		try {
			const parsed = JSON.parse(raw ?? "{}") as {
				format?: number;
				agents?: Record<string, Limit[]>;
			};
			// Only a cache: one it cannot read starts over rather than refusing.
			this.newer = (parsed.format ?? FORMAT) > FORMAT;
			return this.newer ? {} : (parsed.agents ?? {});
		} catch {
			return {};
		}
	}

	private async write(agents: Record<string, Limit[]>): Promise<void> {
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, agents }, null, "\t")}\n`,
		);
		await this.deps.fs.rename(tmp, this.path);
	}
}
