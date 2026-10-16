import { type Fs, type Glob, NodeFs, NodeGlob } from "webappwiz/system";
import { z } from "zod";
import { CONFIG_FILE, importConfig, importDefault } from "./load-config";

/** The file a repo names its systems in, at its root. */
export const SYSTEMS_FILE = "arbor.systems.ts";

/** One named part of the code: the files it is made of. */
export interface System {
	/**
	 * Other names people call it by, at most two, so one part of the code
	 * keeps one word for it.
	 */
	aliases?: string[];
	/** Repo-relative globs of the files it is made of. */
	globs: string[];
	/** Globs of files the `globs` take in that are not part of it. */
	ignore?: string[];
}

/** A system with the name `arbor.systems.ts` keys it by. */
export interface NamedSystem extends System {
	name: string;
}

/** Configures where {@link Systems.at} reads and how it matches. */
export interface SystemsOptions {
	/** What `arbor.systems.ts` is read through; the real one by default. */
	fs?: Fs;
	/** What paths are matched against globs with; `node:path`'s by default. */
	glob?: Glob;
}

/**
 * What `arbor.systems.ts` exports as its default, keyed by name:
 *
 * ```ts
 * import type { SystemsFile } from "@webappwiz/arbor/systems";
 *
 * export default {
 * 	playback: { aliases: ["player"], globs: ["src/audio/**"] },
 * } satisfies SystemsFile;
 * ```
 *
 * The import is only a type, so a reader can import the file without arbor
 * installed.
 */
export type SystemsFile = Record<string, System>;

/**
 * The systems one tree's `arbor.systems.ts` names, and which of them a set of
 * paths falls in.
 */
export class Systems {
	private constructor(
		private readonly named: NamedSystem[],
		private readonly glob: Glob,
	) {}

	/**
	 * The systems the tree at `root` names as it stands now: read afresh, so
	 * one named in a task's worktree counts there at once.
	 */
	static async at(root: string, opts: SystemsOptions = {}): Promise<Systems> {
		return Systems.of(await readSystems(root, opts.fs), opts.glob);
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

	/** Every system, in the order `arbor.systems.ts` names them. */
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

	/** Those of `paths`, repo-relative, that fall in `system`. */
	within(system: System, paths: string[]): string[] {
		return paths.filter((path) => this.contains(system, path));
	}

	/**
	 * The globs of `system` that take in none of `paths`: as a rule, ones
	 * left behind when the files they named moved.
	 */
	unmatched(system: System, paths: string[]): string[] {
		return system.globs.filter(
			(pattern) => !paths.some((path) => this.glob.matches(pattern, path)),
		);
	}

	/**
	 * The systems `text` mentions as `#name` or `#alias`, each once, in the
	 * order first mentioned. A `#` that names no system, such as `#12`, is
	 * left alone.
	 */
	mentioned(text: string): NamedSystem[] {
		const found: NamedSystem[] = [];
		for (const [, , called = ""] of text.matchAll(MENTION)) {
			const system = this.find(called);
			if (system !== null && !found.includes(system)) {
				found.push(system);
			}
		}
		return found;
	}

	/**
	 * The words `text` mentions as `#word` that no system answers to, each
	 * once, in the order first mentioned. A number, such as `#12`, is a todo
	 * rather than a system, and one in code means something else.
	 */
	unknown(text: string): string[] {
		return hashed(text).filter(
			(called) => !/^\d+$/.test(called) && this.find(called) === null,
		);
	}

	private contains(system: System, path: string): boolean {
		const matches = (pattern: string) => this.glob.matches(pattern, path);
		return system.globs.some(matches) && !(system.ignore ?? []).some(matches);
	}
}

/** A `#` at the start or after a space, and the name after it, less trailing punctuation and a range's `-`. */
const MENTION = /(^|\s)#([^\s#]*[^\s#.,;:!?)\]'"-])/g;

/**
 * Each word `text` mentions as `#word` outside code, once, in the order first
 * mentioned: in code, a `#` means something else.
 */
export function hashed(text: string): string[] {
	const prose = text.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, " ");
	const found: string[] = [];
	for (const [, , called = ""] of prose.matchAll(MENTION)) {
		if (!found.includes(called)) {
			found.push(called);
		}
	}
	return found;
}

/**
 * One line telling an agent what a mentioned system is made of:
 *
 * ```
 * #playback (player, audio engine): src/player/**, src/audio/**; not src/player/*.test.ts
 * ```
 */
export function mentionLine(system: NamedSystem): string {
	const aliases = system.aliases ?? [];
	const ignore = system.ignore ?? [];
	return [
		`#${system.name}`,
		aliases.length > 0 ? ` (${aliases.join(", ")})` : "",
		`: ${system.globs.join(", ")}`,
		ignore.length > 0 ? `; not ${ignore.join(", ")}` : "",
	].join("");
}

/**
 * One line asking an agent to find the code an unknown `#name` means, so the
 * user can name it as a system, or give one that covers it the alias.
 */
export function unknownLine(name: string): string {
	return `#${name} names no system: find the code it means, and offer to name it as the arbor skill's Systems section says.`;
}

const SYSTEMS = z.record(
	z.string().min(1),
	z.strictObject({
		aliases: z.array(z.string().min(1)).max(2).optional(),
		globs: z.array(z.string().min(1)).min(1),
		ignore: z.array(z.string().min(1)).optional(),
	}),
);

/**
 * The systems `root`'s `arbor.systems.ts` names, checked, or none when there
 * is no such file. Read afresh each time, so a long-running `arbor dev` sees a
 * system named mid-task without a restart. Throws while `arbor.config.ts`
 * still names systems, which `arbor update` moves.
 */
export async function readSystems(
	root: string,
	fs: Fs = new NodeFs(),
): Promise<Record<string, System>> {
	if ((await importConfig(root, fs)).systems !== undefined) {
		throw new Error(
			`${root}/${CONFIG_FILE} names systems, which arbor now reads from ${SYSTEMS_FILE}: run \`arbor update\` to move them`,
		);
	}
	return checkSystems(
		`${root}/${SYSTEMS_FILE}`,
		await importDefault(root, SYSTEMS_FILE, fs),
	);
}

/**
 * `systems` in the shape {@link System} names, or throws
 * naming `path` for one that is not, one with more than two aliases, or two
 * that answer to the same name, which would leave `arbor systems <name>`
 * guessing.
 */
export function checkSystems(
	path: string,
	systems: unknown,
): Record<string, System> {
	const parsed = SYSTEMS.safeParse(systems);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(`${path}: ${issue?.path.join(".")}: ${issue?.message}`);
	}
	const owners = new Map<string, string>();
	for (const [name, system] of Object.entries(parsed.data) as [
		string,
		System,
	][]) {
		for (const called of [name, ...(system.aliases ?? [])]) {
			const owner = owners.get(called);
			if (owner !== undefined) {
				throw new Error(
					`${path}: systems '${owner}' and '${name}' both answer to '${called}': give each its own names`,
				);
			}
			owners.set(called, name);
		}
	}
	return parsed.data;
}
