import type { Lock } from "webappwiz/system";
import type { Collection, Storage } from "../storage";
import type { TaskState } from "../tasks";
import type { TaskRecord, WaitingStage } from "./task";
import { decodeTask, encodeTask, TASK_FILE } from "./task-file";

/**
 * What a task gains once started: its branch, tree, lease and the rest, as
 * its record keeps them. Its start is `startedAt`, apart from when it was
 * first numbered.
 */
export type Started = Omit<
	TaskState,
	"id" | "status" | "createdAt" | "autoPick"
> & {
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
	/** The records themselves, with the files beside them that numbers and lanes keep. */
	readonly records: Collection;
	/** The tasks removed but kept, in `tasks/removed`. */
	readonly removed: Collection;
	/** Held while writing any record, and while numbering a new one. */
	private readonly lock: Lock;

	/** `storage` is the project's, holding `tasks/` and `tasks.lock`. */
	constructor(readonly storage: Storage) {
		this.records = storage.collection("tasks");
		this.removed = storage.collection("tasks/removed");
		this.lock = storage.lock("tasks.lock");
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

	/** Where task `id`'s files are kept, beside its record. */
	filesKey(id: number): string {
		return `tasks/${id}`;
	}

	/** Task `id`, or null when there is none or it will not parse. */
	async read(id: number): Promise<StoredTask | null> {
		const raw = await this.records.read(`${id}.md`).catch(() => null);
		return raw === null ? null : parse(raw);
	}

	/** Every task that parses, by number. */
	async all(): Promise<StoredTask[]> {
		const names = await this.records.list();
		const records: StoredTask[] = [];
		for (const name of names.filter((each) => TASK_FILE.test(each))) {
			const raw = await this.records.read(name).catch(() => null);
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
		await this.records.write(`${record.id}.md`, encodeTask(record));
		if (record.task !== undefined) {
			this.numbers.set(record.task, record.id);
		}
	}

	async remove(id: number): Promise<void> {
		await this.records.remove(`${id}.md`);
	}

	/**
	 * The next number, past every one handed out before, removed ones
	 * included, so a number never comes back meaning something else. Call it
	 * under the lock.
	 */
	async next(): Promise<number> {
		const last = Number(await this.records.read("last").catch(() => 0));
		const ids = (await this.all()).map((record) => record.id);
		const id = Math.max(Number.isInteger(last) ? last : 0, ...ids) + 1;
		await this.records.write("last", String(id));
		return id;
	}
}

function parse(raw: string): StoredTask | null {
	const stored = decodeTask(raw) as StoredTask | null;
	// Records from before escalating was retired can still say `escalated`,
	// which is a task at work like any other now.
	if (
		stored !== null &&
		(stored.status as string | undefined) === "escalated"
	) {
		stored.status = "working";
	}
	return stored;
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
	gate: true,
	retries: true,
	startedAt: true,
	startedFrom: true,
	updatedAt: true,
	escalations: true,
	dispatch: true,
	caller: true,
	machine: true,
	stranded: true,
	rescued: true,
} satisfies Record<keyof Started, true>;
