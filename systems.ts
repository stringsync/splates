import { type Fs, type Glob, NodeFs, NodeGlob } from "webappwiz/system";
import type { System } from "./config";
import { readConfig } from "./load-config";

/** A system with the name `arbor.config.ts` keys it by. */
export interface NamedSystem extends System {
	name: string;
}

/** Configures where {@link Systems.at} reads and how it matches. */
export interface SystemsOptions {
	/** What `arbor.config.ts` is read through; the real one by default. */
	fs?: Fs;
	/** What paths are matched against globs with; `node:path`'s by default. */
	glob?: Glob;
}

/**
 * The systems one tree's `arbor.config.ts` names, and which of them a set of
 * paths falls in.
 */
export class Systems {
	private constructor(
		private readonly named: NamedSystem[],
		private readonly glob: Glob,
	) {}

	/**
	 * The systems the config at `root` names as it stands now: read afresh, so
	 * one named in a task's worktree counts there at once.
	 */
	static async at(root: string, opts: SystemsOptions = {}): Promise<Systems> {
		const { systems = {} } = await readConfig(root, opts.fs ?? new NodeFs());
		return Systems.of(systems, opts.glob);
	}

	static of(
		systems: Record<string, System>,
		glob: Glob = new NodeGlob(),
	): Systems {
		return new Systems(
			Object.entries(systems).map(([name, system]) => ({ name, ...system })),
			glob,
		);
	}

	/** Every system, in the order the config names them. */
	all(): NamedSystem[] {
		return this.named;
	}

	/** The system called `name`, by its name or one of its aliases. */
	find(name: string): NamedSystem | null {
		return (
			this.named.find(
				(system) =>
					system.name === name || (system.aliases ?? []).includes(name),
			) ?? null
		);
	}

	/** The systems any of `paths`, repo-relative, falls in. */
	touchedBy(paths: string[]): NamedSystem[] {
		return this.named.filter((system) =>
			paths.some((path) => this.contains(system, path)),
		);
	}

	private contains(system: System, path: string): boolean {
		const matches = (pattern: string) => this.glob.matches(pattern, path);
		return system.globs.some(matches) && !(system.ignore ?? []).some(matches);
	}
}
