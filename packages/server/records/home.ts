import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import type { Projects } from "../projects";
import { SqliteStorage } from "../storage";

/** Where a project's records are stamped with their format, apart from the files they once were. */
export interface DatabaseStamp {
	read(): Promise<number | null>;
	write(format: number): Promise<void>;
}

/** What a `ProjectHome` works with. */
export interface ProjectHomeOptions {
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The registry, which keeps the id the checkout's records are under. */
	projects: Projects;
	/** After how long a lock in the database counts as stale. */
	stalenessMs?: number;
}

/** The key the database keeps its records' format under. */
const STAMP = "format";

/**
 * Where one checkout's records live: a SQLite database, `state.db`, in
 * `<splates home>/projects/<id>`, the id the registry keeps against the
 * checkout's path. The checkout itself holds none, so a clone of it on
 * another machine is a cache and the splates home the one directory that
 * matters. Dispose it to close the database it opened.
 */
export class ProjectHome {
	private opened: SqliteStorage | null = null;

	constructor(
		/** The main tree's root. */
		readonly root: string,
		private readonly opts: ProjectHomeOptions,
	) {}

	/** The project's directory under the splates home, once it has an id. */
	async dir(): Promise<string> {
		const id = await this.opts.projects.idFor(this.root);
		return `${splatesHome(this.opts.ps)}/projects/${id}`;
	}

	/** Whether the project has a database yet, without making one. */
	async exists(): Promise<boolean> {
		const id = await this.opts.projects.idOf(this.root);
		return (
			id !== null &&
			(await this.opts.fs.exists(
				`${splatesHome(this.opts.ps)}/projects/${id}/state.db`,
			))
		);
	}

	/** The project's records, made empty when there are none. */
	async open(): Promise<SqliteStorage> {
		if (this.opened === null) {
			const dir = await this.dir();
			await this.opts.fs.mkdir(dir, { recursive: true });
			const { fs, ps, log, stalenessMs } = this.opts;
			this.opened = SqliteStorage.open(`${dir}/state.db`, {
				fs,
				ps,
				log,
				stalenessMs,
			});
		}
		return this.opened;
	}

	/**
	 * The format stamp kept in the database, which reads null while there is
	 * none. It opens the database only for the moment it reads or writes,
	 * unless it is open already.
	 */
	stamp(): DatabaseStamp {
		const using = async <T>(
			use: (storage: SqliteStorage) => Promise<T>,
		): Promise<T> => {
			const own = this.opened === null;
			try {
				return await use(await this.open());
			} finally {
				if (own) {
					this.dispose();
				}
			}
		};
		return {
			read: async () =>
				(await this.exists())
					? using((storage) => storage.document<number>(STAMP).read())
					: null,
			write: (format) =>
				using((storage) => storage.document<number>(STAMP).write(format)),
		};
	}

	/**
	 * Copies every file under `legacy`, a project's old `.git/splates`, into
	 * the database, through a file beside it renamed into place, so a database
	 * made is a whole one, and stamps it `format`. Run again, it starts over.
	 */
	async import(legacy: string, format: number): Promise<void> {
		const { fs, ps, log, stalenessMs } = this.opts;
		const dir = await this.dir();
		await fs.mkdir(dir, { recursive: true });
		const path = `${dir}/state.db`;
		const partial = `${dir}/state.db.importing`;
		for (const stale of [partial, `${partial}-wal`, `${partial}-shm`]) {
			await fs.rm(stale, { force: true });
		}
		const into = SqliteStorage.open(partial, { fs, ps, log, stalenessMs });
		try {
			await into.importFiles(fs, legacy);
			await into.document<number>(STAMP).write(format);
		} finally {
			into.dispose();
		}
		// A database already there is a failed import's, or a downgrade's
		// leftover, and the records being moved are the newer.
		this.opened?.dispose();
		this.opened = null;
		for (const old of [`${path}-wal`, `${path}-shm`]) {
			await fs.rm(old, { force: true });
		}
		await fs.rename(partial, path);
		for (const old of [`${partial}-wal`, `${partial}-shm`]) {
			await fs.rm(old, { force: true });
		}
	}

	/**
	 * Leaves the old `.git/splates` aside as `.git/splates.moved`, so a
	 * downgrade can find the records as they were, and so nothing treats it as
	 * the records any more.
	 */
	async leaveAside(legacy: string): Promise<void> {
		const { fs } = this.opts;
		if (!(await fs.exists(legacy))) {
			return;
		}
		let aside = `${legacy}.moved`;
		for (let nth = 2; await fs.exists(aside); nth += 1) {
			aside = `${legacy}.moved-${nth}`;
		}
		await fs.rename(legacy, aside);
	}

	dispose(): void {
		this.opened?.dispose();
		this.opened = null;
	}
}
