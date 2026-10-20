import { Attachments } from "../artifacts";
import {
	queuedOf,
	type StoredTask,
	startedOf,
	type TaskStore,
	unqueued,
} from "../board";
import type { TaskState } from "./worktree";

/**
 * Started tasks as their worktrees read them, from the numbered store the
 * list of tasks shares: each one's branch, tree, lease and the rest, found by
 * its name, written without touching what the list holds of it.
 */
export class StartedRecords {
	constructor(private readonly store: TaskStore) {}

	/** The started task called `task`, or null for none. */
	async find(task: string): Promise<TaskState | null> {
		const record = await this.store.find(task);
		return record === null ? null : stateOf(record);
	}

	/**
	 * What the record of started task `task` says of it as it ends: its
	 * number, what it was queued as, and the queued tasks it took up; null
	 * for one with no record.
	 */
	async ending(task: string): Promise<{
		id: number;
		subject: string;
		took: { id: number; subject: string }[];
	} | null> {
		const record = await this.store.find(task);
		if (record === null) {
			return null;
		}
		const took = (await this.store.all())
			.filter((each) => each.listed !== false && each.takenBy === task)
			.map(({ id, subject }) => ({ id, subject }));
		return {
			id: record.id,
			subject: record.listed === false ? "" : record.subject,
			took,
		};
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
			// Its Auto pick is the record's own, which a stale read must not undo.
			const { id: _, createdAt, status, autoPick: __, ...started } = state;
			await this.store.write({
				...queuedOf(record),
				...(record.listed === false ? { listed: false } : {}),
				...started,
				stage: "running",
				startedAt: createdAt,
				startedFrom:
					record.startedFrom ??
					(record.stage === "running" ? "backlog" : record.stage),
				status,
			});
		});
	}

	/**
	 * Ends `task`'s start: drops what it added to the record, and its files.
	 * One off the list goes, and one on it goes back to the stage it started
	 * from, for the list to settle; `unqueue`, never back in the queue.
	 */
	async end(task: string, { unqueue = false } = {}): Promise<void> {
		await this.store.locked(async () => {
			const record = await this.store.find(task);
			if (record === null) {
				return;
			}
			await this.filesAt(record.id).clear();
			if (record.listed === false) {
				await this.store.remove(record.id);
				await new Attachments(
					this.store.storage,
					this.store.filesKey(record.id),
				).clear();
			} else {
				const back = queuedOf(record);
				const stage = record.startedFrom ?? "backlog";
				await this.store.write(
					unqueue && stage === "queued" ? unqueued(back) : { ...back, stage },
				);
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
		const entries = await this.store.storage.children("tasks");
		for (const entry of entries.filter((each) => /^\d+$/.test(each))) {
			if (!started.has(entry)) {
				await this.filesAt(Number(entry)).clear();
			}
		}
	}

	private filesAt(id: number): Attachments {
		return new Attachments(
			this.store.storage,
			`${this.store.filesKey(id)}/started`,
		);
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
			stage: "backlog",
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
		status: record.status ?? "working",
		createdAt: startedAt,
		...(record.autoPick === undefined ? {} : { autoPick: record.autoPick }),
	};
}
