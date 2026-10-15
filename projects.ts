import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { fail } from "./exit";
import { arborHome } from "./roster";

/** The registry's own format, apart from each repository's records. */
const FORMAT = 1;

/** A repository arbor has run in, as the registry keeps it. */
export interface ProjectRecord {
	/** The main tree's root, never a task's worktree. */
	root: string;
	/** When arbor first ran there, as an ISO timestamp. */
	added: string;
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

/** The registry's file as written: its records, and the project last focused. */
interface RegistryFile {
	projects: ProjectRecord[];
	/** The root `arbor dev`'s page last picked, which an address naming none shows. */
	focused: string | null;
}

/** What `Projects` works with. */
export interface ProjectsOptions {
	fs: Fs;
	/** Held while the file is rewritten, so two commands never drop each other's. */
	lock: Lock;
	/** The current time; a test passes its own. */
	now?: () => Date;
}

/**
 * Every arbor project on this machine, kept in one file under the user's
 * home: an explicit roster that `arbor init` writes each into, so one
 * `arbor dev` can find them all without scanning the disk.
 */
export class Projects {
	private readonly fs: Fs;
	private readonly lock: Lock;
	private readonly now: () => Date;

	/**
	 * This machine's registry, in `ARBOR_HOME`, `~/.arbor` for none, with a
	 * lock that counts as stale after `stalenessMs`.
	 */
	static ofMachine(
		{ fs, ps, log }: { fs: Fs; ps: Ps; log: Logger },
		stalenessMs?: number,
	): Projects {
		const home = arborHome(ps);
		return new Projects(`${home}/projects.json`, {
			fs,
			lock: new FileLock(`${home}/projects.lock`, {
				fs,
				ps,
				log,
				stalenessMs,
			}),
		});
	}

	constructor(
		/** `~/.arbor/projects.json`, or a test's own. */
		readonly path: string,
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
	 * Makes the registered repository at `root` the one an address naming
	 * none shows, as picking it on the page does, saying whether it is
	 * registered.
	 */
	async focus(root: string): Promise<boolean> {
		let registered = false;
		await this.change((file) => {
			registered = file.projects.some((each) => each.root === root);
			return registered && file.focused !== root
				? { ...file, focused: root }
				: null;
		});
		return registered;
	}

	/**
	 * The project an address naming none shows: the one last focused, else
	 * the first registered, skipping those gone; null while there is none.
	 */
	async focused(): Promise<Project | null> {
		const { focused } = await this.read();
		const open = (await this.list()).filter((each) => !each.gone);
		return open.find((each) => each.root === focused) ?? open[0] ?? null;
	}

	/**
	 * Every registered project, in the order arbor first ran in each, those
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
	 * Drops the repository at `root`, saying whether it was there: one gone
	 * for good, or one `arbor dev` should no longer offer.
	 */
	async forget(root: string): Promise<boolean> {
		return this.change((file) => {
			const kept = file.projects.filter((each) => each.root !== root);
			return kept.length === file.projects.length
				? null
				: {
						projects: kept,
						focused: file.focused === root ? null : file.focused,
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
		// The lock lives beside the file, so its directory comes first.
		await this.fs.mkdir(this.dir);
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

	private get dir(): string {
		return this.path.slice(0, this.path.lastIndexOf("/"));
	}

	private async read(): Promise<RegistryFile> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return { projects: [], focused: null };
		}
		let parsed: {
			format?: number;
			projects?: ProjectRecord[];
			focused?: string | null;
		};
		try {
			parsed = JSON.parse(raw);
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
		if ((parsed.format ?? 1) > FORMAT) {
			fail(
				"outdated",
				[
					`${this.path} is in format ${parsed.format}, written by a newer arbor; this one understands up to ${FORMAT}, so it leaves it alone.`,
					"Run `bunx @webappwiz/arbor@latest` instead.",
				].join("\n"),
				{ path: this.path, format: parsed.format, understood: FORMAT },
			);
		}
		return {
			projects: parsed.projects ?? [],
			focused: parsed.focused ?? null,
		};
	}

	private async write({ projects, focused }: RegistryFile): Promise<void> {
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, projects, focused }, null, "\t")}\n`,
		);
		await this.fs.rename(tmp, this.path);
	}
}
