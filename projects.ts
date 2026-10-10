import type { Fs, Lock } from "webappwiz/system";
import { fail } from "./exit";

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
	/** The repository is no longer there: moved or deleted since. */
	gone: boolean;
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
 * home: an explicit roster that `arbor add` and `arbor dev` write themselves
 * into, so one `arbor dev` can find them all without scanning the disk.
 */
export class Projects {
	private readonly fs: Fs;
	private readonly lock: Lock;
	private readonly now: () => Date;

	constructor(
		/** `~/.arbor/projects.json`, or a test's own. */
		readonly path: string,
		{ fs, lock, now = () => new Date() }: ProjectsOptions,
	) {
		this.fs = fs;
		this.lock = lock;
		this.now = now;
	}

	/** Adds the repository at `root`, once; registering it again changes nothing. */
	async register(root: string): Promise<void> {
		if ((await this.records()).some((each) => each.root === root)) {
			return;
		}
		// The lock lives beside the file, so its directory comes first.
		await this.fs.mkdir(this.dir);
		// Read again under the lock: another command may have just written it.
		await this.lock.acquire();
		try {
			const records = await this.records();
			if (records.some((each) => each.root === root)) {
				return;
			}
			await this.write([...records, { root, added: this.now().toISOString() }]);
		} finally {
			await this.lock.release();
		}
	}

	/**
	 * Every registered project, in the order arbor first ran in each, those
	 * whose repository is gone flagged rather than dropped: one on a drive
	 * that is not mounted comes back.
	 */
	async list(): Promise<Project[]> {
		const projects: Project[] = [];
		for (const record of await this.records()) {
			projects.push({
				...record,
				gone: !(await this.fs.exists(`${record.root}/.git`)),
			});
		}
		return projects;
	}

	private get dir(): string {
		return this.path.slice(0, this.path.lastIndexOf("/"));
	}

	private async records(): Promise<ProjectRecord[]> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return [];
		}
		let parsed: { format?: number; projects?: ProjectRecord[] };
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
		return parsed.projects ?? [];
	}

	private async write(projects: ProjectRecord[]): Promise<void> {
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, projects }, null, "\t")}\n`,
		);
		await this.fs.rename(tmp, this.path);
	}
}
