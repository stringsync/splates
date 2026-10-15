import type { Fs } from "webappwiz/system";
import type { Conversations } from "./conversations";
import type { StopWhy } from "./events";
import type { Journal } from "./journal";

/**
 * A project's run of `arbor dev`, logged as a start and a stop with the
 * conversations that were running across them, so each shows why its thread
 * has a gap. The server keeps its own record of who is running, beside the
 * journal, because a crash leaves no stop to read it from: the next start
 * finds the record still open and logs the stop it missed.
 */
export class DevRun {
	private live: string[] = [];
	private pending: Promise<void> = Promise.resolve();
	private stopped = false;

	private constructor(
		private readonly journal: Journal,
		private readonly conversations: Conversations,
		private readonly fs: Fs,
		private readonly path: string,
	) {}

	/** Logs the start of this run, and the stop of the one before if it never logged its own. */
	static async start({
		journal,
		conversations,
		fs,
		arborDir,
		remote,
	}: {
		journal: Journal;
		conversations: Conversations;
		fs: Fs;
		arborDir: string;
		/** Where its tunnel reaches the page from elsewhere, or null. */
		remote: string | null;
	}): Promise<DevRun> {
		const run = new DevRun(
			journal,
			conversations,
			fs,
			`${arborDir}/dev-run.json`,
		);
		const before = await run.read();
		if (before?.open) {
			await journal.record("dev stop", null, async () => {}, {
				conversations: before.conversations,
				why: "lost",
			});
		}
		await journal.record("dev start", null, async () => {}, {
			conversations: before?.conversations ?? [],
			remote,
		});
		await run.remember();
		conversations.events.on("changed", () => void run.remember());
		return run;
	}

	/** Logs the stop of this run, and closes the record so the next start does not log it again. */
	async stop(why: StopWhy): Promise<void> {
		// A change still being remembered would otherwise write after the
		// record closed, or after the directory it lives in is gone.
		this.stopped = true;
		await this.pending;
		await this.journal.record("dev stop", null, async () => {}, {
			conversations: this.live,
			why,
		});
		await this.write(false);
	}

	private remember(): Promise<void> {
		const next = this.pending.then(() =>
			this.stopped ? undefined : this.update(),
		);
		this.pending = next.catch(() => {});
		return next;
	}

	private async update(): Promise<void> {
		const live = (await this.conversations.list())
			.filter(
				({ state }) => state.status !== "stopped" && state.status !== "failed",
			)
			.map(({ state }) => state.id);
		if (live.join() !== this.live.join()) {
			this.live = live;
			await this.write(true);
		} else if (!(await this.fs.exists(this.path))) {
			await this.write(true);
		}
	}

	private write(open: boolean): Promise<void> {
		return this.fs.write(
			this.path,
			`${JSON.stringify({ open, conversations: this.live })}\n`,
		);
	}

	private async read(): Promise<{
		open: boolean;
		conversations: string[];
	} | null> {
		try {
			const read = JSON.parse(await this.fs.read(this.path)) as {
				open?: unknown;
				conversations?: unknown;
			};
			return {
				open: read.open === true,
				conversations: Array.isArray(read.conversations)
					? read.conversations.map(String)
					: [],
			};
		} catch {
			return null;
		}
	}
}
