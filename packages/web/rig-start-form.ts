import type {
	OptionValues,
	Rig,
	RigPresets,
	RunView,
} from "@splates/server/rigs/browser";
import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";

type StartEvents = { changed: undefined };

/** What the start form starts runs and saves presets through. */
export interface StartApi {
	startRun(request: {
		group: string;
		rig: string;
		tree: string;
		values: OptionValues;
		preset: string | null;
	}): Promise<RunView>;
	savePreset(preset: {
		group: string;
		rig: string;
		name: string;
		values?: OptionValues;
	}): Promise<RigPresets>;
}

/** What the start form shows. */
export type StartState = {
	tree: string;
	values: OptionValues;
	/** The preset the values came from, until one is changed. */
	preset: string | null;
	/** The name being typed for a new preset; null while not saving one. */
	naming: string | null;
	starting: boolean;
	/** Why the last start was refused. */
	refused: string | null;
};

/**
 * The start form of one rig: the tree, a preset, the option values, saving
 * a preset and starting the run.
 */
export class RigStartForm implements Eventful<StartEvents>, Resource {
	readonly #dispatcher = new Dispatcher<StartEvents>();
	readonly events = this.#dispatcher.events;
	state: StartState;
	readonly #defaults: OptionValues;

	/** A form for `rig` of `group`, opening on `tree` with the rig's defaults. */
	constructor(
		private readonly api: StartApi,
		private readonly group: string,
		private readonly rig: Rig,
		tree: string,
	) {
		this.#defaults = Object.fromEntries(
			rig.options.map((option) => [option.name, option.default]),
		);
		this.state = {
			tree,
			values: this.#defaults,
			preset: null,
			naming: null,
			starting: false,
			refused: null,
		};
	}

	tree(tree: string): void {
		this.#set({ tree, refused: null });
	}

	/** Closes the form; a start already sent still lands. */
	dispose(): void {}

	/** Fills the values from preset `name` of `saved`, or the defaults for null. */
	pick(name: string | null, saved: Record<string, OptionValues>): void {
		this.#set({
			preset: name,
			values: { ...this.#defaults, ...(name === null ? {} : saved[name]) },
		});
	}

	set(name: string, value: boolean | string | number): void {
		this.#set({
			values: { ...this.state.values, [name]: value },
			preset: null,
		});
	}

	/** Starts naming a new preset, or types its name; null stops. */
	naming(name: string | null): void {
		this.#set({ naming: name });
	}

	/** Saves the values under the name typed, answering with every preset. */
	async save(): Promise<RigPresets | null> {
		const name = this.state.naming?.trim();
		if (!name) {
			return null;
		}
		const presets = await this.api.savePreset({
			group: this.group,
			rig: this.rig.name,
			name,
			values: this.state.values,
		});
		this.#set({ naming: null, preset: name });
		return presets;
	}

	/** Drops preset `name`, answering with every preset left. */
	async drop(name: string): Promise<RigPresets> {
		const presets = await this.api.savePreset({
			group: this.group,
			rig: this.rig.name,
			name,
		});
		if (this.state.preset === name) {
			this.#set({ preset: null });
		}
		return presets;
	}

	/** Starts the run, answering with its id, or null when refused. */
	async start(): Promise<string | null> {
		this.#set({ starting: true, refused: null });
		try {
			const run = await this.api.startRun({
				group: this.group,
				rig: this.rig.name,
				tree: this.state.tree,
				values: this.state.values,
				preset: this.state.preset,
			});
			this.#set({ starting: false });
			return run.id;
		} catch (error) {
			this.#set({
				starting: false,
				refused: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	#set(change: Partial<StartState>): void {
		this.state = { ...this.state, ...change };
		this.#dispatcher.dispatch("changed");
	}
}
