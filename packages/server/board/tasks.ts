import { relative, resolve, sep } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, NodeFs } from "webappwiz/system";
import { Attachments } from "../artifacts";
import { fail } from "../exit";
import type { LaneUpdateOptions } from "./lane";
import { cycle, type LaneRecord, misordered, settle } from "./lanes";
import { startedOf, type TaskStore } from "./store";
import {
	assigned,
	staged,
	Task,
	type TaskNew,
	type TaskRecord,
	wording,
} from "./task";
import { parseTaskFile, TASK_FILE } from "./task-file";
import { TaskLanes } from "./task-lanes";

/**
 * The list of tasks: every queued one, and each started one that was queued
 * first, in the store under `.git/splates/tasks`.
 */
export class Tasks {
	private readonly fs: Fs;
	private readonly ids: IdProvider;
	private readonly laneFiles: TaskLanes;

	constructor(
		/**
		 * Where the records are, whose lock is held while numbering a new
		 * task, so two agents never share an id, and while writing one, so a
		 * move renumbering the rest never loses to a write of a position it
		 * just changed.
		 */
		readonly store: TaskStore,
		opts: TasksOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ids = opts.ids ?? new UuidProvider();
		this.laneFiles = new TaskLanes(this, this.fs);
	}

	get dir(): string {
		return this.store.dir;
	}

	/** Where a queued task's files live, beside its record. */
	attachments(id: number): Attachments {
		return new Attachments(`${this.dir}/${id}`, this.fs, this.ids);
	}

	/**
	 * Whether `path` is a file some task holds, one level inside its folder:
	 * never a record, and not a way out of here.
	 */
	owns(path: string): boolean {
		const parts = relative(this.dir, resolve(path)).split(sep);
		return parts.length === 2 && /^\d+$/.test(parts[0] ?? "");
	}

	async add(
		subject: string,
		from: string | null,
		{
			text = "",
			files = [],
			position,
			blockedBy = [],
			lane = null,
			assignee = null,
			origin,
			ready = false,
		}: TaskNew = {},
	): Promise<Task> {
		const words = wording(subject, text);
		if (words.subject === "") {
			fail("usage", "a task needs a subject: say what is left to do", {});
		}
		await this.fs.mkdir(this.dir);
		return this.locked(async () => {
			const stored = await this.stored();
			// Nothing comes after a task yet to exist, so a new one cannot close
			// a loop: only what it names has to be there.
			for (const id of blockedBy) {
				if (!stored.some((other) => other.id === id)) {
					missing(id);
				}
			}
			const id = await this.store.next();
			const state: TaskRecord = {
				id,
				...words,
				position: 0,
				from,
				createdAt: new Date().toISOString(),
				takenBy: null,
				files: await this.attachments(id).store(files),
				blockedBy: [...new Set(blockedBy)].sort((left, right) => left - right),
				lane: null,
				stage: ready ? "ready" : "backlog",
				...(origin === undefined ? {} : { origin }),
			};
			const task = await this.save(
				assigned(
					{
						...state,
						lane: await this.laneFiles.laneId(lane, stored, [state]),
					},
					assignee,
				),
			);
			await this.place(task.state, position);
			return this.settled(task.id);
		});
	}

	/**
	 * Top of the list first. A file that will not parse is skipped rather than
	 * fatal, and positions are counted again from 1 as they are read, so a
	 * gap or a tie left by a crash, or a task saved before they had any (it
	 * goes below those that do, oldest first), never shows.
	 */
	async all(): Promise<Task[]> {
		return (await this.stored()).map(
			(state, i) => new Task(this, { ...state, position: i + 1 }),
		);
	}

	async find(id: number): Promise<Task> {
		return (await this.all()).find((task) => task.id === id) ?? missing(id);
	}

	/** The queued tasks `task` has taken; what a merge or remove settles. */
	async takenBy(task: string): Promise<Task[]> {
		return (await this.all()).filter((each) => each.takenBy === task);
	}

	/**
	 * Puts a task at `position`, 1 at the top, past the bottom meaning the
	 * bottom, and numbers the rest around it. Refuses to put one above a task
	 * in its own lane that it comes after, or below one that comes after it.
	 */
	async move(id: number, position: number): Promise<Task> {
		return this.locked(async () => {
			const state = await this.state(id);
			this.ordered(slot(await this.stored(), state, position));
			return this.place(state, position);
		});
	}

	/**
	 * Says `id` comes after the tasks in `add`, and no longer after those in
	 * `drop`: it is not to be started until they merge. Refuses a link that
	 * would make a loop, naming the tasks in it, and moves a task down below
	 * anything in its own lane it now comes after.
	 */
	async link(
		id: number,
		{ add = [], drop = [] }: { add?: number[]; drop?: number[] },
	): Promise<Task> {
		return this.locked(async () => {
			const states = await this.stored();
			const state = states.find((other) => other.id === id) ?? missing(id);
			for (const before of add) {
				if (!states.some((other) => other.id === before)) {
					missing(before);
				}
				const loop = cycle(states, id, before);
				if (loop) {
					fail(
						"cycle",
						loop.length === 2
							? `task ${id} cannot come after itself`
							: `task ${id} cannot come after task ${before}: that makes a loop, ${loop.map((each) => `#${each}`).join(" → ")}, where each has to merge before the next`,
						{ number: id, blockedBy: before, cycle: loop },
					);
				}
			}
			const lost = state.blockersLost ?? [];
			const unknown = drop.find(
				(before) =>
					!state.blockedBy.includes(before) &&
					!lost.some((gone) => gone.id === before),
			);
			if (unknown !== undefined) {
				fail(
					"not_found",
					`task ${id} does not come after task ${unknown}: nothing was changed`,
					{ number: id, blockedBy: unknown },
				);
			}
			const { blockersLost: _, ...rest } = state;
			const kept = lost.filter((gone) => !drop.includes(gone.id));
			await this.save({
				...rest,
				blockedBy: [...new Set([...state.blockedBy, ...add])]
					.filter((before) => !drop.includes(before))
					.sort((left, right) => left - right),
				...(kept.length === 0 ? {} : { blockersLost: kept }),
			});
			return this.settled(id);
		});
	}

	/**
	 * Puts a task in a lane, or in none for null. `"new"` starts a lane of its
	 * own, called `name`, or after the task without one. With `before`, it goes just above that task; otherwise it goes
	 * below the rest of the lane, or keeps its place when that is in none or
	 * new. Refuses a place above a task in the lane that it comes after, or
	 * below one that comes after it.
	 */
	async arrange(
		id: number,
		lane: number | "new" | null,
		{ before, name }: { before?: number; name?: string } = {},
	): Promise<Task> {
		return this.locked(async () => {
			const states = await this.stored();
			const state = states.find((other) => other.id === id) ?? missing(id);
			const moved = {
				...state,
				lane: await this.laneFiles.laneId(lane, states, [state], name),
			};
			const rest = states.filter((other) => other.id !== id);
			let at: number;
			if (before !== undefined) {
				at = rest.findIndex((other) => other.id === before);
				if (at === -1) {
					missing(before);
				}
			} else {
				const tail = rest.findLastIndex(
					(other) => moved.lane !== null && other.lane === moved.lane,
				);
				at =
					tail === -1 ? states.findIndex((other) => other.id === id) : tail + 1;
			}
			const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
			this.ordered(order);
			await this.save(moved);
			await this.renumber(order);
			return this.find(id);
		});
	}

	/** Every lane, in board order. */
	async lanes(): Promise<LaneRecord[]> {
		return this.laneFiles.records(await this.stored());
	}

	/** The name of every lane there has been, those on the board first. */
	async laneNames(): Promise<LaneRecord[]> {
		return this.laneFiles.names(await this.stored());
	}

	/** Moves every task in lane `from` to the bottom of lane `into`; `from` is gone. */
	joinLanes(from: number, into: number): Promise<void> {
		return this.laneFiles.joinLanes(from, into);
	}

	/** Starts an empty lane called `name`, after the others. */
	addLane(name: string): Promise<LaneRecord> {
		return this.laneFiles.addLane(name);
	}

	/** Calls lane `id` by another name. */
	renameLane(id: number, name: string): Promise<LaneRecord> {
		return this.laneFiles.renameLane(id, name);
	}

	/** Puts lane `id` at `position` among the lanes, 1 the first column. */
	moveLane(id: number, position: number): Promise<LaneRecord[]> {
		return this.laneFiles.moveLane(id, position);
	}

	/**
	 * Makes each change asked of lane `id`: a new name, a new place among
	 * the lanes, queued whole or not. Gives back the lane after, the lanes in
	 * order when it moved, and the tasks unqueued when it stopped being
	 * queued whole.
	 */
	async changeLane(
		id: number,
		{ name, position, queued }: LaneUpdateOptions,
	): Promise<{
		record: LaneRecord | undefined;
		order: LaneRecord[] | undefined;
		unqueued: TaskRecord[];
	}> {
		const renamed =
			name === undefined ? undefined : await this.renameLane(id, name);
		const order =
			position === undefined ? undefined : await this.moveLane(id, position);
		const toggled =
			queued === undefined ? undefined : await this.queueLane(id, queued);
		return {
			record: toggled?.lane ?? order?.find((each) => each.id === id) ?? renamed,
			order,
			unqueued: toggled?.unqueued ?? [],
		};
	}

	/** Queues lane `id` whole, or stops, unqueueing what it has yet to start. */
	queueLane(
		id: number,
		queued: boolean,
	): Promise<{ lane: LaneRecord; unqueued: TaskRecord[] }> {
		return this.laneFiles.queueLane(id, queued);
	}

	/** Notes tasks `ids` as taken out of the queue by the person, or put back. */
	skipInLanes(ids: number[], skip: boolean): Promise<void> {
		return this.laneFiles.skipInLanes(ids, skip);
	}

	/** Queues each task of a queued lane that can start now; gives them back. */
	queueFromLanes(): Promise<TaskRecord[]> {
		return this.laneFiles.queueFromLanes();
	}

	/** Removes lane `id`, putting its tasks back in none, untriaged. */
	dropLane(id: number): Promise<void> {
		return this.laneFiles.dropLane(id);
	}

	/** @internal Removes each lane in `ids` that no task is in any more. */
	endLanes(ids: number[]): Promise<void> {
		return this.laneFiles.endLanes(ids);
	}

	/** Moves tasks saved while splates kept tags into lanes, one lane a tag. */
	moveTagsToLanes(): Promise<{ lane: LaneRecord; tasks: number[] }[]> {
		return this.laneFiles.moveTagsToLanes();
	}

	/**
	 * @internal Rewrites one task as it stands on disk now, under the lock, so
	 * a change to its words or who has it never undoes a move made meanwhile.
	 */
	async revise(
		id: number,
		change: (state: TaskRecord) => TaskRecord,
	): Promise<Task> {
		return this.locked(async () => this.save(change(await this.state(id))));
	}

	/**
	 * @internal Writes one task, keeping what starting it added, which the
	 * list leaves to the task's worktree. Call it under the lock.
	 */
	async save(state: TaskRecord): Promise<Task> {
		const stored = await this.store.read(state.id);
		const started = stored === null ? null : startedOf(stored);
		const saved = staged(state, started !== null);
		await this.store.write({
			...saved,
			...started,
			...(started === null ? {} : { status: stored?.status ?? "working" }),
		});
		return new Task(this, saved);
	}

	/**
	 * @internal Removes one, moving those below it up to close the gap. What
	 * came after it no longer waits on it, so no task is left naming one that
	 * is gone, but each keeps what became of it: landed as commit `landed`,
	 * or, without one, lost.
	 */
	async delete(id: number, landed?: string): Promise<boolean> {
		return this.locked(async () => {
			const gone = await this.read(this.path(id));
			const stored = await this.store.read(id);
			const kept = stored !== null && startedOf(stored) !== null;
			if (kept) {
				// Its task goes on, off the list.
				await this.store.write({ ...stored, takenBy: null, listed: false });
			} else {
				await this.store.remove(id);
			}
			const order: TaskRecord[] = [];
			for (const state of await this.stored()) {
				if (state.blockedBy.includes(id)) {
					const blocker = { id, subject: gone?.subject ?? "" };
					const freed = {
						...state,
						blockedBy: state.blockedBy.filter((before) => before !== id),
						...(landed === undefined
							? {
									blockersLost: [...(state.blockersLost ?? []), blocker],
								}
							: {
									blockersLanded: [
										...(state.blockersLanded ?? []),
										{ ...blocker, commit: landed },
									],
								}),
					};
					await this.save(freed);
					order.push(freed);
				} else {
					order.push(state);
				}
			}
			await this.renumber(order);
			return kept;
		});
	}

	/**
	 * @internal Removes one as `delete` does, keeping it and its files under
	 * `removed/` for `restore` to put back. Only the newest `REMOVED_KEPT` are
	 * kept, the older going for good.
	 */
	async discard(state: TaskRecord): Promise<void> {
		await this.fs.mkdir(this.removedDir);
		const kept: RemovedTask = { state, removedAt: new Date().toISOString() };
		await this.fs.write(
			this.removedPath(state.id),
			`${JSON.stringify(kept, null, "\t")}\n`,
		);
		await this.delete(state.id);
		const removed = await this.removed();
		for (const { state: old } of removed.slice(0, -REMOVED_KEPT)) {
			await this.fs.rm(this.removedPath(old.id), { force: true });
			// One still started keeps its files: its task holds them.
			if ((await this.store.read(old.id)) === null) {
				await this.attachments(old.id).clear();
			}
		}
	}

	/**
	 * Puts a task `discard` removed back under its id, where it stood in the
	 * list, untaken: in its lane while that lane is still on the board, after
	 * those it waited on that still are.
	 */
	async restore(id: number): Promise<Task> {
		return this.locked(async () => {
			const raw = await this.fs.read(this.removedPath(id)).catch(() => null);
			if (raw === null) {
				fail(
					"not_found",
					`no removed task ${id} to put back: only the last ${REMOVED_KEPT} removed are kept`,
					{ number: id },
				);
			}
			const { state } = JSON.parse(raw) as RemovedTask;
			const stored = await this.stored();
			if (stored.some((other) => other.id === id)) {
				fail("exists", `task ${id} is on the list already`, { number: id });
			}
			const lanes = await this.laneFiles.records(stored);
			const restored = await this.save({
				...state,
				takenBy: null,
				lane: lanes.some((lane) => lane.id === state.lane) ? state.lane : null,
				blockedBy: state.blockedBy.filter((before) =>
					stored.some((other) => other.id === before),
				),
			});
			await this.fs.rm(this.removedPath(id), { force: true });
			// Those its removal held for the person wait on it again.
			for (const other of stored) {
				if (other.blockersLost?.some((gone) => gone.id === id)) {
					const { blockersLost: lost, ...rest } = other;
					const kept = lost.filter((gone) => gone.id !== id);
					await this.save({
						...rest,
						blockedBy: [...other.blockedBy, id].sort(
							(left, right) => left - right,
						),
						...(kept.length === 0 ? {} : { blockersLost: kept }),
					});
				}
			}
			await this.place(restored.state, state.position);
			return this.settled(id);
		});
	}

	/** @internal Runs `run` holding the lock every write goes through. */
	locked<T>(run: () => Promise<T>): Promise<T> {
		return this.store.locked(run);
	}

	/**
	 * Settles the list after a link or a lane changed, moving each task below
	 * what it comes after in its lane, and gives back `id` as it ends up.
	 * Call it under the lock.
	 */
	private async settled(id: number): Promise<Task> {
		await this.renumber(settle(await this.stored()));
		return this.find(id);
	}

	/** Refuses `order` when a lane in it puts a task above one it comes after. */
	private ordered(order: TaskRecord[]): void {
		const wrong = misordered(order);
		if (wrong) {
			fail(
				"usage",
				`task ${wrong.task.id} comes after task ${wrong.blockedBy.id} in lane ${wrong.task.lane}, so it cannot go above it: \`splates task update ${wrong.task.id} --remove-blocked-by ${wrong.blockedBy.id}\` first, or move it to another lane`,
				{
					number: wrong.task.id,
					blockedBy: wrong.blockedBy.id,
					lane: wrong.task.lane,
				},
			);
		}
	}

	/** One task as it stands on disk; call it under the lock. */
	private async state(id: number): Promise<TaskRecord> {
		const state = await this.read(this.path(id));
		return state ?? missing(id);
	}

	/**
	 * Slots `state` in at `position` among the rest and saves whichever moved.
	 * Call it under the lock.
	 */
	private async place(
		state: TaskRecord,
		position: number | undefined,
	): Promise<Task> {
		if (
			position !== undefined &&
			(!Number.isInteger(position) || position <= 0)
		) {
			fail("usage", `'${position}' is not a position: 1 is the top`, {
				number: state.id,
				position,
			});
		}
		await this.renumber(slot(await this.stored(), state, position));
		return this.find(state.id);
	}

	/**
	 * @internal Every task in list order, with the positions it has on disk. `tagged`
	 * are read though they still have tags, to move them into lanes.
	 */
	async stored(tagged: number[] = []): Promise<TaskRecord[]> {
		const entries = await this.fs.readdir(this.dir).catch(() => []);
		const states: TaskRecord[] = [];
		for (const entry of entries.filter((entry) => TASK_FILE.test(entry))) {
			const state = await this.read(`${this.dir}/${entry}`, tagged);
			if (state) {
				states.push(state);
			}
		}
		return states.sort(
			(left, right) =>
				(left.position || Infinity) - (right.position || Infinity) ||
				left.id - right.id,
		);
	}

	/** @internal Saves each task in `order` whose position on disk is not its place there. */
	async renumber(order: TaskRecord[]): Promise<void> {
		for (const [i, state] of order.entries()) {
			if (state.position !== i + 1) {
				await this.save({ ...state, position: i + 1 });
			}
		}
	}

	private get removedDir(): string {
		return `${this.dir}/removed`;
	}

	private removedPath(id: number): string {
		return `${this.removedDir}/${id}.json`;
	}

	/** The tasks `discard` kept, the oldest removed first. */
	private async removed(): Promise<RemovedTask[]> {
		const entries = await this.fs.readdir(this.removedDir).catch(() => []);
		const kept: RemovedTask[] = [];
		for (const entry of entries.filter((each) => each.endsWith(".json"))) {
			const raw = await this.fs
				.read(`${this.removedDir}/${entry}`)
				.catch(() => null);
			if (raw !== null) {
				kept.push(JSON.parse(raw) as RemovedTask);
			}
		}
		return kept.sort((left, right) =>
			left.removedAt.localeCompare(right.removedAt),
		);
	}

	private path(id: number): string {
		return `${this.dir}/${id}.md`;
	}

	/**
	 * One task, or null when it will not parse. One saved with tags is
	 * refused, unless it is one of `tagged`: dropping them unasked would lose
	 * what they grouped.
	 */
	private async read(
		path: string,
		tagged: number[] = [],
	): Promise<TaskRecord | null> {
		const raw = await this.fs.read(path).catch(() => null);
		const parsed = raw === null ? null : parseTaskFile(raw);
		// A task started without being queued is not listed.
		const found = parsed?.listed ? parsed : null;
		if (
			found !== null &&
			found.tags.length > 0 &&
			!tagged.includes(found.state.id)
		) {
			fail(
				"outdated",
				[
					`task ${found.state.id} was saved with tags, and splates now groups tasks in lanes instead, so it reads no tasks until their tags are moved.`,
					"Run `splates update` in this repository: it puts each tag's tasks in a lane named after the tag, then splates works as before.",
				].join("\n"),
				{ number: found.state.id },
			);
		}
		return found?.state ?? null;
	}
}

/** How many removed tasks `Tasks.discard` keeps for `restore`. */
export const REMOVED_KEPT = 50;

/** A removed task as `discard` keeps it. */
interface RemovedTask {
	state: TaskRecord;
	removedAt: string;
}

/** What `Tasks` is stored through; the real filesystem by default. */
export interface TasksOptions {
	fs?: Fs;
	/** What names stored files apart; random ids by default. */
	ids?: IdProvider;
}

/** `states` with `state` taken out and put back at `position`, 1 at the top. */
function slot(
	states: TaskRecord[],
	state: TaskRecord,
	position: number | undefined,
): TaskRecord[] {
	const rest = states.filter((other) => other.id !== state.id);
	const at = Math.min((position ?? Infinity) - 1, rest.length);
	return [...rest.slice(0, at), state, ...rest.slice(at)];
}

function missing(id: number): never {
	fail("not_found", `no task ${id}: run \`splates task list\``, { number: id });
}
