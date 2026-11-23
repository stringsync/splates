import type {
	Group,
	Rig,
	RigPresets,
	RigsPage,
	RunView,
} from "@splates/server/rigs/browser";
import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";

/** Everything the Rigs page shows, replaced whole on each change. */
export type RigsState = {
	/** The rigs, runs, trees and presets, once read. */
	listing: RigsPage | null;
	/** Why the last read failed, while it is failing. */
	failed: string | null;
	/** The rig whose start form is open, with the tree it opens on. */
	starting: { group: Group; rig: Rig; tree: string | null } | null;
	/** The run open beside the list, by id. */
	open: string | null;
};

type RigsEvents = { changed: undefined };

/** What the page reads and changes the rigs through. */
export interface RigsApi {
	rigsPage(opts: { fresh?: boolean }): Promise<RigsPage>;
	stopRun(id: string): Promise<void>;
}

/** How often the runs are read again while the page is open. */
export const RUNS_EVERY_MS = 2000;

/**
 * The Rigs page's state: the listing, read again every two seconds while
 * watched, the start form open on a rig, and the run open beside the list.
 */
export class RigsFlow implements Eventful<RigsEvents>, Resource {
	readonly #dispatcher = new Dispatcher<RigsEvents>();
	readonly events = this.#dispatcher.events;
	state: RigsState = {
		listing: null,
		failed: null,
		starting: null,
		open: null,
	};

	constructor(private readonly api: RigsApi) {}

	#timer: ReturnType<typeof setInterval> | null = null;

	/** Reads the listing now and every two seconds, until the watch or the flow is disposed. */
	watch(every = RUNS_EVERY_MS): Resource {
		this.dispose();
		void this.refresh();
		this.#timer = setInterval(() => void this.refresh(), every);
		return { dispose: () => this.dispose() };
	}

	dispose(): void {
		if (this.#timer !== null) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	/** Reads the listing again; `fresh` runs every rig command's describe first. */
	async refresh(fresh = false): Promise<void> {
		try {
			this.#set({ listing: await this.api.rigsPage({ fresh }), failed: null });
		} catch (error) {
			this.#set({
				failed: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** The run open beside the list, as last read. */
	opened(): RunView | null {
		const { listing, open } = this.state;
		return listing?.runs.find((run) => run.id === open) ?? null;
	}

	/** The trees `rig` of `group` runs on now, where it cannot start again. */
	busy(group: string, rig: string): string[] {
		return (this.state.listing?.runs ?? [])
			.filter(
				(run) =>
					run.group === group && run.rig === rig && run.state !== "exited",
			)
			.map((run) => run.tree);
	}

	/** Opens the start form of `rig`, on `tree` when given. */
	startForm(group: Group, rig: Rig, tree: string | null = null): void {
		this.#set({ starting: { group, rig, tree } });
	}

	closeStart(): void {
		this.#set({ starting: null });
	}

	/** Closes the start form on run `id` having started, and opens it. */
	started(id: string): void {
		this.#set({ starting: null, open: id });
		void this.refresh();
	}

	open(id: string | null): void {
		this.#set({ open: id });
	}

	/** Stops run `id`, or dismisses it once exited, closing it if open. */
	async stop(id: string): Promise<void> {
		await this.api.stopRun(id);
		if (this.state.open === id) {
			this.#set({ open: null });
		}
		await this.refresh();
	}

	/** Dismisses exited run `id` and opens the start form again on its tree. */
	async again(run: RunView): Promise<void> {
		const group = this.state.listing?.groups.find(
			(each) => each.name === run.group,
		);
		const rig = group?.rigs.find((each) => each.name === run.rig);
		await this.stop(run.id);
		if (group !== undefined && rig !== undefined) {
			this.startForm(group, rig, run.tree);
		}
	}

	/** Takes the presets a save or drop answered with. */
	presets(presets: RigPresets): void {
		const { listing } = this.state;
		if (listing !== null) {
			this.#set({ listing: { ...listing, presets } });
		}
	}

	#set(change: Partial<RigsState>): void {
		this.state = { ...this.state, ...change };
		this.#dispatcher.dispatch("changed");
	}
}
