import type { Fs } from "webappwiz/system";

/** One time an automation ran, as its page lists it. */
export interface AutomationRun {
	at: string;
	/** What set it off: an event and its tasks, as `task.created #3`, or `schedule`. */
	on: string;
	/** Why it failed, or null when it ran. */
	error: string | null;
}

/** What is kept of each automation's runs, by its id. */
export type AutomationRuns = Record<
	string,
	{
		/** The latest last, at most `KEPT`. */
		runs: AutomationRun[];
		/** When its schedule last came due, so a restart runs a missed one once. */
		scheduledAt?: string;
	}
>;

/** How many runs each automation keeps. */
export const KEPT = 5;

/**
 * The last runs of each automation, in `.git/splates/hooks-runs.json`. Only
 * `splates server` writes it, one run at a time, so it takes no lock.
 */
export class RunStore {
	#writing = Promise.resolve();

	constructor(
		readonly path: string,
		private readonly fs: Fs,
	) {}

	/** Every automation's runs; none when the file is missing or will not parse. */
	async read(): Promise<AutomationRuns> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return {};
		}
		try {
			const parsed = JSON.parse(raw) as unknown;
			return parsed !== null && typeof parsed === "object"
				? (parsed as AutomationRuns)
				: {};
		} catch {
			return {};
		}
	}

	/** Keeps that automation `id` ran, dropping its oldest past `KEPT`. */
	ran(id: string, run: AutomationRun): Promise<void> {
		return this.#change((all) => {
			const kept = all[id] ?? { runs: [] };
			return {
				...all,
				[id]: { ...kept, runs: [...kept.runs, run].slice(-KEPT) },
			};
		});
	}

	/** Keeps that automation `id`'s schedule came due at `at`. */
	scheduled(id: string, at: string): Promise<void> {
		return this.#change((all) => ({
			...all,
			[id]: { runs: [], ...all[id], scheduledAt: at },
		}));
	}

	#change(edit: (all: AutomationRuns) => AutomationRuns): Promise<void> {
		this.#writing = this.#writing
			.catch(() => {})
			.then(async () => {
				const all = edit(await this.read());
				const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
				await this.fs.write(tmp, JSON.stringify(all));
				await this.fs.rename(tmp, this.path);
			});
		return this.#writing;
	}
}
