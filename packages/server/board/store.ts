import type { Fs, Lock } from "webappwiz/system";
import type { TaskState } from "../tasks";
import type { TaskRecord, WaitingStage } from "./task";
import { decodeTask, encodeTask, TASK_FILE } from "./task-file";

/**
 * What a task gains once started: its branch, tree, lease and the rest, as
 * its record keeps them. Its start is `startedAt`, apart from when it was
 * first numbered.
 */
export type Started = Omit<TaskState, "id" | "status" | "createdAt"> & {
	startedAt: string;
	/** The stage it was in before it started, which ending its start puts it back in. */
	startedFrom: WaitingStage;
};

/**
 * One task as `tasks/<N>.md` holds it: what the list shows of it, and once
 * started, what `Started` adds and how its work stands.
 */
export type StoredTask = TaskRecord &
	Partial<Started> & {
		/** How its work stands while it runs; absent before it starts. */
		status?: TaskState["status"];
		/**
		 * False for a task started without ever being queued, which the list
		 * leaves out; absent for one on it.
		 */
		listed?: false;
		/** Tags it was saved with before lanes, for `splates update` to move. */
		tags?: string[];
	};

/** What `record` adds once started, or null for one never started. */
export function startedOf(record: StoredTask): Started | null {
	if (record.task === undefined) {
		return null;
	}
	return Object.fromEntries(
		Object.entries(record).filter(([key]) => key in STARTED),
	) as Started;
}

/** `record` without what starting it added, its status or whether it is listed. */
export function queuedOf(record: StoredTask): TaskRecord & { tags?: string[] } {
	return Object.fromEntries(
		Object.entries(record).filter(
			([key]) => !(key in STARTED) && key !== "status" && key !== "listed",
		),
	) as TaskRecord;
}

/**
 * Every task in the repo, queued or started, one markdown file each under
 * `.git/splates/tasks`, numbered. The list of tasks and the worktrees of
 * started ones each read and write their own fields of a record, under one
 * lock, so neither undoes what the other wrote.
 */
export class TaskStore {
	/** The number each started task was last found under, by its name. */
	private readonly numbers = new Map<string, number>();

	constructor(
		readonly dir: string,
		/** Held while writing any record, and while numbering a new one. */
		private readonly lock: Lock,
		private readonly fs: Fs,
	) {}

	path(id: number): string {
		return `${this.dir}/${id}.md`;
	}

	/** Runs `run` holding the lock every write goes through. */
	async locked<T>(run: () => Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			return await run();
		} finally {
			await this.lock.release();
		}
	}

	/** Task `id`, or null when there is none or it will not parse. */
	async read(id: number): Promise<StoredTask | null> {
		const raw = await this.fs.read(this.path(id)).catch(() => null);
		return raw === null ? null : parse(raw);
	}

	/** Every task that parses, by number. */
	async all(): Promise<StoredTask[]> {
		const entries = await this.fs.readdir(this.dir).catch(() => []);
		const records: StoredTask[] = [];
		for (const entry of entries.filter((each) => TASK_FILE.test(each))) {
			const raw = await this.fs.read(`${this.dir}/${entry}`).catch(() => null);
			const record = raw === null ? null : parse(raw);
			if (record !== null) {
				records.push(record);
			}
		}
		return records.sort((left, right) => left.id - right.id);
	}

	/** Every started task, by number. */
	async started(): Promise<StoredTask[]> {
		const started = (await this.all()).filter(
			(record) => record.task !== undefined,
		);
		for (const record of started) {
			this.numbers.set(record.task as string, record.id);
		}
		return started;
	}

	/** The started task called `task`, or null for none. */
	async find(task: string): Promise<StoredTask | null> {
		const known = this.numbers.get(task);
		if (known !== undefined) {
			const record = await this.read(known);
			if (record?.task === task) {
				return record;
			}
		}
		return (await this.started()).find((each) => each.task === task) ?? null;
	}

	/** Writes one task, which a reader sees whole, old or new. */
	async write(record: StoredTask): Promise<void> {
		// Renamed into place, so the swap is atomic.
		await this.fs.mkdir(this.dir);
		const path = this.path(record.id);
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, encodeTask(record));
		await this.fs.rename(tmp, path);
		if (record.task !== undefined) {
			this.numbers.set(record.task, record.id);
		}
	}

	async remove(id: number): Promise<void> {
		await this.fs.rm(this.path(id), { force: true });
	}

	/**
	 * The next number, past every one handed out before, removed ones
	 * included, so a number never comes back meaning something else. Call it
	 * under the lock.
	 */
	async next(): Promise<number> {
		const last = Number(await this.fs.read(`${this.dir}/last`).catch(() => 0));
		const ids = (await this.all()).map((record) => record.id);
		const id = Math.max(Number.isInteger(last) ? last : 0, ...ids) + 1;
		await this.fs.mkdir(this.dir);
		await this.fs.write(`${this.dir}/last`, String(id));
		return id;
	}
}

function parse(raw: string): StoredTask | null {
	return decodeTask(raw) as StoredTask | null;
}

/** Every field `Started` adds, so each view of a record takes only its own. */
const STARTED = {
	task: true,
	branch: true,
	worktree: true,
	base: true,
	lease: true,
	mergeAttempts: true,
	mergeFailures: true,
	mergeFailuresBy: true,
	gateFailures: true,
	retries: true,
	startedAt: true,
	startedFrom: true,
	updatedAt: true,
	escalations: true,
	dispatch: true,
	caller: true,
	machine: true,
} satisfies Record<keyof Started, true>;
