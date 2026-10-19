import type { Fs } from "webappwiz/system";
import { Attachments } from "../artifacts";
import { queuedOf, type StoredTask, startedOf, type TaskStore } from "../board";
import type { TaskState } from "./worktree";

/**
 * Started tasks as their worktrees read them, from the numbered store the
 * list of tasks shares: each one's branch, tree, lease and the rest, found by
 * its name, written without touching what the list holds of it.
 */
export class StartedRecords {
	constructor(
		private readonly store: TaskStore,
		private readonly fs: Fs,
	) {}

	/** The started task called `task`, or null for none. */
	async find(task: string): Promise<TaskState | null> {
		const record = await this.store.find(task);
		return record === null ? null : stateOf(record);
	}

	/** Every started task. */
	async all(): Promise<TaskState[]> {
		return (await this.store.started()).map(stateOf);
	}

	/**
	 * Writes `state` into its task's record. A task's first save starts it
	 * under the lowest number it holds that is still queued, or a number of
	 * its own, off the list.
	 */
	async save(state: TaskState): Promise<void> {
		await this.store.locked(async () => {
			const record =
				(await this.store.find(state.task)) ??
				(await this.numbered(state.task));
			const { id: _, createdAt, status, ...started } = state;
			await this.store.write({
				...queuedOf(record),
				...(record.listed === false ? { listed: false } : {}),
				...started,
				startedAt: createdAt,
				status,
			});
		});
	}

	/**
	 * Ends `task`'s start: drops what it added to the record, and its files.
	 * One off the list goes, and one on it is queued again, for the list to
	 * settle.
	 */
	async end(task: string): Promise<void> {
		await this.store.locked(async () => {
			const record = await this.store.find(task);
			if (record === null) {
				return;
			}
			await this.filesAt(record.id).clear();
			if (record.listed === false) {
				await this.store.remove(record.id);
				await new Attachments(
					`${this.store.dir}/${record.id}`,
					this.fs,
				).clear();
			} else {
				await this.store.write({ ...queuedOf(record), status: "queued" });
			}
		});
	}

	/**
	 * Where started task `task`'s files live, beside its record: the
	 * screenshots and videos its questions show, in `tasks/<N>/started/`,
	 * apart from those it was queued with. They go when the task ends. Null
	 * for a task with no record.
	 */
	async files(task: string): Promise<Attachments | null> {
		const record = await this.store.find(task);
		return record === null ? null : this.filesAt(record.id);
	}

	/**
	 * Drops the files of every started task whose start has ended: what a
	 * process that died between ending a task and clearing its folder left
	 * behind.
	 */
	async sweep(): Promise<void> {
		const started = new Set(
			(await this.store.started()).map((record) => String(record.id)),
		);
		const entries = await this.fs.readdir(this.store.dir).catch(() => []);
		for (const entry of entries.filter((each) => /^\d+$/.test(each))) {
			if (!started.has(entry)) {
				await this.filesAt(Number(entry)).clear();
			}
		}
	}

	private filesAt(id: number): Attachments {
		return new Attachments(`${this.store.dir}/${id}/started`, this.fs);
	}

	/**
	 * The record `task` starts under: the lowest-numbered queued task it
	 * holds, or a new one off the list. Call it under the store's lock.
	 */
	private async numbered(task: string): Promise<StoredTask> {
		const held = (await this.store.all()).find(
			(record) =>
				record.listed !== false &&
				record.takenBy === task &&
				startedOf(record) === null,
		);
		if (held !== undefined) {
			return held;
		}
		return {
			id: await this.store.next(),
			subject: task,
			text: "",
			position: 0,
			from: null,
			createdAt: new Date().toISOString(),
			takenBy: null,
			files: [],
			blockedBy: [],
			lane: null,
			status: "working",
			listed: false,
		};
	}
}

/** A started task's record as its worktree reads it. */
function stateOf(record: StoredTask): TaskState {
	const { startedAt, ...started } = startedOf(record) as NonNullable<
		ReturnType<typeof startedOf>
	>;
	return {
		...started,
		id: record.id,
		status: record.status === "queued" ? "working" : record.status,
		createdAt: startedAt,
	};
}
