import type { Logger } from "webappwiz/log";
import type { Fs, Lock, Ps } from "webappwiz/system";
import { fail } from "../exit";
import { type Document, FsStorage, type Storage } from "../storage";
import { isProjectColor, type ProjectColor } from "./appearance";

/**
 * The registry's own format, apart from each repository's records. Format 2
 * keeps each checkout's `ids`, which name where its records live: a splates
 * that dropped them on a rewrite would orphan the records.
 */
const FORMAT = 2;

/** A repository splates has run in, as the registry keeps it. */
export interface ProjectRecord {
	/** The main tree's root, never a task's worktree. */
	root: string;
	/** When splates first ran there, as an ISO timestamp. */
	added: string;
	/** Override the badge color; omit it for the automatic choice. */
	color?: ProjectColor;
	/**
	 * What each other project may do here, by its root, those left out
	 * `DEFAULT_REACH`.
	 */
	grants?: Record<string, Reach>;
}

/** A registered repository, as the registry reads it back. */
export interface Project extends ProjectRecord {
	/**
	 * What a URL names it by: the root's last part, `webappwiz`, with `-2`
	 * and on for a second of the same name, in the order they joined.
	 */
	slug: string;
	/** The repository is no longer there: moved or deleted since. */
	gone: boolean;
}

/** The registry's file as stored, whatever splates wrote it. */
interface StoredRegistry {
	format?: number;
	projects?: ProjectRecord[];
	focused?: string[] | string | null;
	ids?: Record<string, string>;
}

/**
 * The roster of splates projects on this machine. `splates init` adds a
 * project to it, and one `splates server` lists, focuses and forgets the
 * projects through it instead of scanning the disk.
 */
export class Projects {
	private readonly fs: Fs;
	private readonly lock: Lock;
	private readonly now: () => Date;

	/**
	 * This machine's registry, in `SPLATES_HOME`, `~/.splates` for none, with a
	 * lock that counts as stale after `stalenessMs`.
	 */
	static ofMachine(
		{ fs, ps, log }: { fs: Fs; ps: Ps; log: Logger },
		stalenessMs?: number,
	): Projects {
		return Projects.in(FsStorage.ofMachine({ fs, ps, log, stalenessMs }), fs);
	}

	/** The registry kept in `storage`, which is a machine's or a slot's home. */
	static in(storage: Storage, fs: Fs, now?: () => Date): Projects {
		return new Projects(storage.document("projects.json"), {
			fs,
			lock: storage.lock("projects.lock"),
			now,
		});
	}

	constructor(
		/** `projects.json` of the machine's storage, or a test's own. */
		private readonly document: Document<StoredRegistry>,
		{ fs, lock, now = () => new Date() }: ProjectsOptions,
	) {
		this.fs = fs;
		this.lock = lock;
		this.now = now;
	}

	/**
	 * Adds the repository at `root`, once, saying whether it did: registering
	 * it again changes nothing.
	 */
	async register(root: string): Promise<boolean> {
		if ((await this.read()).projects.some((each) => each.root === root)) {
			return false;
		}
		return this.change((file) => {
			if (file.projects.some((each) => each.root === root)) {
				return null;
			}
			return {
				...file,
				projects: [...file.projects, { root, added: this.now().toISOString() }],
			};
		});
	}

	/**
	 * The id the records of the checkout at `root` are kept under, or null
	 * while it has none. Forgetting a project keeps it, so its records are
	 * found again once it is registered.
	 */
	async idOf(root: string): Promise<string | null> {
		return (await this.read()).ids[root] ?? null;
	}

	/** `idOf`, giving the checkout at `root` an id first when it has none. */
	async idFor(root: string): Promise<string> {
		let id = "";
		await this.change((file) => {
			const have = file.ids[root];
			if (have !== undefined) {
				id = have;
				return null;
			}
			id = crypto.randomUUID();
			return { ...file, ids: { ...file.ids, [root]: id } };
		});
		return id;
	}

	/**
	 * Makes the registered repository at `root` the one an address naming
	 * none shows, as picking it on the page does, saying whether it is
	 * registered.
	 */
	async focus(root: string): Promise<boolean> {
		let registered = false;
		await this.change((file) => {
			registered = file.projects.some((each) => each.root === root);
			return registered && file.focused[0] !== root
				? {
						...file,
						focused: [root, ...file.focused.filter((each) => each !== root)],
					}
				: null;
		});
		return registered;
	}

	/**
	 * The project an address naming none shows: the one focused last, else
	 * the one focused before it, and so on, else the first registered,
	 * skipping those gone; null while there is none.
	 */
	async focused(): Promise<Project | null> {
		const { focused } = await this.read();
		const open = (await this.list()).filter((each) => !each.gone);
		for (const root of focused) {
			const found = open.find((each) => each.root === root);
			if (found !== undefined) {
				return found;
			}
		}
		return open[0] ?? null;
	}

	/**
	 * Every registered project, in the order splates first ran in each, those
	 * whose repository is gone flagged rather than dropped: one on a drive
	 * that is not mounted comes back.
	 */
	async list(): Promise<Project[]> {
		const projects: Project[] = [];
		const taken = new Map<string, number>();
		for (const record of (await this.read()).projects) {
			const name = record.root.split("/").filter(Boolean).at(-1) ?? "project";
			const seen = (taken.get(name) ?? 0) + 1;
			taken.set(name, seen);
			projects.push({
				...record,
				slug: seen === 1 ? name : `${name}-${seen}`,
				gone: !(await this.fs.exists(`${record.root}/.git`)),
			});
		}
		return projects;
	}

	/**
	 * What the project at `from` may do in the one at `to`: what `to` granted
	 * it, else `DEFAULT_REACH`.
	 */
	async reach(from: string, to: string): Promise<Reach> {
		const record = (await this.read()).projects.find(
			(each) => each.root === to,
		);
		const granted = record?.grants?.[from] as Reach | "todos" | undefined;
		// Granted before todos became tasks, adding them was `todos`.
		return granted === "todos" ? "queue" : (granted ?? DEFAULT_REACH);
	}

	/**
	 * Lets the project at `from` do as much as `reach` in the registered one
	 * at `to`, saying whether `to` is registered.
	 */
	async grant(to: string, from: string, reach: Reach): Promise<boolean> {
		let registered = false;
		await this.change((file) => {
			registered = file.projects.some((each) => each.root === to);
			if (!registered) {
				return null;
			}
			return {
				...file,
				projects: file.projects.map((each) => {
					if (each.root !== to) {
						return each;
					}
					const { [from]: _, ...others } = each.grants ?? {};
					// The default is kept by leaving it out, so it moves with it.
					const grants =
						reach === DEFAULT_REACH ? others : { ...others, [from]: reach };
					const { grants: _grants, ...record } = each;
					return Object.keys(grants).length === 0
						? record
						: { ...each, grants };
				}),
			};
		});
		return registered;
	}

	/** Set the badge color of project `slug`, or pass null to restore its automatic color. */
	async appearance(slug: string, color: unknown): Promise<void> {
		if (color !== null && !isProjectColor(color)) {
			fail("usage", "choose a project color or null for automatic", {});
		}
		const found = (await this.list()).find((each) => each.slug === slug);
		if (found === undefined) {
			fail("not_found", `no splates project '${slug}'`, { project: slug });
		}
		const root = found.root;
		let registered = false;
		await this.change((file) => {
			registered = file.projects.some((each) => each.root === root);
			if (!registered) {
				return null;
			}
			return {
				...file,
				projects: file.projects.map((each) => {
					if (each.root !== root) {
						return each;
					}
					const { color: _, ...record } = each;
					return color === null ? record : { ...record, color };
				}),
			};
		});
		if (!registered) {
			fail("not_found", `no splates project '${slug}'`, { project: slug });
		}
	}

	/**
	 * The registered project a command names as `slug`, refusing one that is
	 * not there.
	 */
	async named(slug: string): Promise<Project> {
		const all = await this.list();
		const found = all.find((each) => each.slug === slug && !each.gone);
		if (found === undefined) {
			fail(
				"not_found",
				`no splates project here is called ${slug}: it is one of ${
					all
						.filter((each) => !each.gone)
						.map((each) => each.slug)
						.join(", ") || "none"
				}. A repository that is not one yet joins once \`splates init\` runs there: ask the user before you run it.`,
				{ project: slug },
			);
		}
		return found;
	}

	/**
	 * Drops the repository at `root`, saying whether it was there: one gone
	 * for good, or one `splates server` should no longer offer.
	 */
	async forget(root: string): Promise<boolean> {
		return this.change((file) => {
			const kept = file.projects.filter((each) => each.root !== root);
			return kept.length === file.projects.length
				? null
				: {
						ids: file.ids,
						projects: kept,
						focused: file.focused.filter((each) => each !== root),
					};
		});
	}

	/**
	 * Rewrites the file as `edit` says, under the lock, saying whether it
	 * did: `edit` returns null to leave it as it is.
	 */
	private async change(
		edit: (file: RegistryFile) => RegistryFile | null,
	): Promise<boolean> {
		// Read under the lock: another command may have just written it.
		await this.lock.acquire();
		try {
			const changed = edit(await this.read());
			if (changed === null) {
				return false;
			}
			await this.write(changed);
			return true;
		} finally {
			await this.lock.release();
		}
	}

	private async read(): Promise<RegistryFile> {
		let parsed: StoredRegistry | null;
		try {
			parsed = await this.document.read();
		} catch {
			fail("usage", `${this.document.key} is not JSON: fix or delete it`, {
				path: this.document.key,
			});
		}
		if (parsed === null) {
			return { projects: [], focused: [], ids: {} };
		}
		if ((parsed.format ?? 1) > FORMAT) {
			fail(
				"outdated",
				[
					`${this.document.key} is in format ${parsed.format}, written by a newer splates; this one understands up to ${FORMAT}, so it leaves it alone.`,
					"Run `bunx @stringsync/splates@latest` instead.",
				].join("\n"),
				{ path: this.document.key, format: parsed.format, understood: FORMAT },
			);
		}
		return {
			projects: parsed.projects ?? [],
			// A single root, as the splates that began focusing wrote it.
			focused:
				typeof parsed.focused === "string"
					? [parsed.focused]
					: (parsed.focused ?? []),
			ids: parsed.ids ?? {},
		};
	}

	private async write({ projects, focused, ids }: RegistryFile): Promise<void> {
		await this.document.write({ format: FORMAT, projects, focused, ids });
	}
}

/**
 * What an agent working in one project may do in another through splates,
 * each including those before it: read its tasks and lanes; queue tasks
 * in its untriaged lane; or run its queue, lanes and hooks.
 * Grants stop splates commands, not file edits.
 */
export const REACHES = ["read", "queue", "tasks"] as const;
export type Reach = (typeof REACHES)[number];

/** What a project lets another do that it has granted nothing. */
export const DEFAULT_REACH: Reach = "queue";

/** Whether `granted` covers what `needed` asks for. */
export function reaches(granted: Reach, needed: Reach): boolean {
	return REACHES.indexOf(granted) >= REACHES.indexOf(needed);
}

/**
 * One line telling an agent where a project a prompt names as `#slug` sits,
 * and how to change it:
 *
 * ```
 * #shop is the splates project at /Users/me/shop: read its code there, and land any change to it from a task added there.
 * ```
 */
export function projectLine({
	slug,
	root,
	reach,
}: {
	slug: string;
	root: string;
	/**
	 * What the project the prompt is in may do there; null when it is that
	 * project, or in none.
	 */
	reach: Reach | null;
}): string {
	return reach === null
		? `#${slug} is the splates project at ${root}: read its code there, and land any change to it from a task added there.`
		: `#${slug} is the splates project at ${root}: read its code there, run splates on it as \`splates --project ${slug} <command>\`, and ${REACH_LINES[reach]}.`;
}

/** What `projectLine` says each reach lets an agent do there. */
const REACH_LINES: Record<Reach, string> = {
	read: "only read its tasks and lanes: ask the user for more when your work needs it",
	queue:
		"add tasks to its queue, but start none: ask the user for more when your work needs it",
	tasks:
		"add tasks to its queue or hand its tasks to agents, never taking one yourself",
};

/** The registry's file as written: its records, and the projects focused. */
interface RegistryFile {
	projects: ProjectRecord[];
	/**
	 * The roots `splates server`'s page picked, the last first, the first of them
	 * what an address naming none shows, the next what it shows once that
	 * one is forgotten.
	 */
	focused: string[];
	/** The id each checkout's records are kept under, by its root. */
	ids: Record<string, string>;
}

/** What `Projects` works with. */
export interface ProjectsOptions {
	/** Tells whether a project's repository is still there. */
	fs: Fs;
	/** Held while the file is rewritten, so two commands never drop each other's. */
	lock: Lock;
	/** The current time; defaults to the system clock. */
	now?: () => Date;
}
