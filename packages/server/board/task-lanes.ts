import { fail } from "../exit";
import { BACKLOG_LANE, protectBacklog } from "./backlog";
import { aptName, isReady, type LaneRecord, named, settle } from "./lanes";
import { type Task, type TaskRecord, unqueued } from "./task";
import { parseTaskFile, TASK_FILE } from "./task-file";
import type { Tasks } from "./tasks";

/**
 * The lanes of a `Tasks`: their records in `lanes` beside the tasks, and every
 * change that moves tasks between them, each made under the tasks' lock.
 */
export class TaskLanes {
	constructor(private readonly tasks: Tasks) {}

	/** Places unmatched work in Backlog, settling dependencies and preserving a concurrent move. */
	async backlog(id: number): Promise<Task> {
		return this.tasks.locked(async () => {
			const { state } = await this.tasks.find(id);
			if (state.lane === null && state.takenBy === null) {
				await this.tasks.save({ ...state, lane: BACKLOG_LANE });
				await this.tasks.renumber(settle(await this.tasks.stored()));
			}
			return this.tasks.find(id);
		});
	}

	/**
	 * Moves every task in lane `from` to the bottom of lane `into`, in the
	 * order they had, and the lane `from` is gone.
	 */
	async joinLanes(from: number, into: number): Promise<void> {
		protectBacklog(from);
		await this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			for (const lane of [from, into]) {
				lacking(records, lane);
			}
			const moving = states
				.filter((state) => state.lane === from)
				.map((state) => ({ ...state, lane: into }));
			const rest = states.filter((state) => state.lane !== from);
			const tail = rest.findLastIndex((state) => state.lane === into);
			const order = settle([
				...rest.slice(0, tail + 1),
				...moving,
				...rest.slice(tail + 1),
			]);
			for (const state of moving) {
				await this.tasks.save(state);
			}
			await this.tasks.renumber(order);
			await this.writeLanes(records.filter((record) => record.id !== from));
		});
	}

	/** Starts an empty lane called `name`, after the others. */
	async addLane(name: string): Promise<LaneRecord> {
		return this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			// Named first, so a name refused never uses up a number.
			const called = laneName(name, records);
			const record = { id: await this.nextLaneId(states), name: called };
			await this.writeLanes(beforeBacklog(records, record));
			return record;
		});
	}

	/** Calls lane `id` by another name. */
	async renameLane(id: number, name: string): Promise<LaneRecord> {
		protectBacklog(id);
		return this.tasks.locked(async () => {
			const records = await this.records(await this.tasks.stored());
			lacking(records, id);
			const others = records.filter((record) => record.id !== id);
			const renamed = {
				...(records.find((record) => record.id === id) as LaneRecord),
				name: laneName(name, others),
			};
			await this.writeLanes(
				records.map((record) => (record.id === id ? renamed : record)),
			);
			return renamed;
		});
	}

	/**
	 * Puts lane `id` at `position` among the lanes, 1 the first column, past
	 * the last meaning the last; the others close up around it.
	 */
	async moveLane(id: number, position: number): Promise<LaneRecord[]> {
		if (!Number.isInteger(position) || position <= 0) {
			fail("usage", `'${position}' is not a position: 1 is the first lane`, {
				position,
			});
		}
		return this.tasks.locked(async () => {
			const records = await this.records(await this.tasks.stored());
			lacking(records, id);
			const moved = records.find((record) => record.id === id) as LaneRecord;
			const rest = records.filter((record) => record.id !== id);
			const at = Math.min(position - 1, rest.length);
			const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
			await this.writeLanes(order);
			return order;
		});
	}

	/**
	 * Queues lane `id` whole, or stops: queued, each of its tasks is queued
	 * once nothing blocks it (`queueFromLanes`); stopped, each it holds that
	 * is queued, taken or not, goes back to ready when groomed, else the
	 * backlog, so nothing more of it starts, and one started from the queue
	 * goes there too once its start ends, rather than back in the queue.
	 * Gives back the lane, and the tasks stopping took out.
	 */
	async queueLane(
		id: number,
		queued: boolean,
	): Promise<{ lane: LaneRecord; unqueued: TaskRecord[] }> {
		return this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			lacking(records, id);
			const {
				queued: _,
				skip: __,
				...rest
			} = records.find((record) => record.id === id) as LaneRecord;
			const changed: LaneRecord = queued ? { ...rest, queued: true } : rest;
			const taken: TaskRecord[] = [];
			if (!queued) {
				for (const state of states) {
					if (state.lane === id && state.stage === "queued") {
						taken.push((await this.tasks.save(unqueued(state))).state);
					}
				}
				for (const record of await this.tasks.store.started()) {
					if (record.lane === id && record.startedFrom === "queued") {
						await this.tasks.store.write({
							...record,
							startedFrom: unqueued(record).stage,
						});
					}
				}
			}
			await this.writeLanes(
				records.map((record) => (record.id === id ? changed : record)),
			);
			return { lane: changed, unqueued: taken };
		});
	}

	/**
	 * Notes tasks `ids` as taken out of the queue by the person, `skip`, so
	 * the queued lane each is in leaves it out, or as queued again by them.
	 */
	async skipInLanes(ids: number[], skip: boolean): Promise<void> {
		await this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			let changed = false;
			const next = records.map((record) => {
				const mine = states
					.filter((state) => state.lane === record.id && ids.includes(state.id))
					.map((state) => state.id);
				if (record.queued !== true || mine.length === 0) {
					return record;
				}
				const kept = (record.skip ?? []).filter((id) => !mine.includes(id));
				const skipping = skip ? [...kept, ...mine] : kept;
				changed = true;
				const { skip: _, ...rest } = record;
				return skipping.length === 0 ? rest : { ...rest, skip: skipping };
			});
			if (changed) {
				await this.writeLanes(next);
			}
		});
	}

	/**
	 * Queues each task of a queued lane that can start now: nobody has it,
	 * nothing blocks it, and the person has not taken it out of the queue.
	 * A queued lane no task is left in is queued no more. Gives back the
	 * tasks it queued.
	 */
	async queueFromLanes(): Promise<TaskRecord[]> {
		return this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			const queued: TaskRecord[] = [];
			let ended = false;
			const next = records.map((record) => {
				if (record.queued !== true) {
					return record;
				}
				if (!states.some((state) => state.lane === record.id)) {
					ended = true;
					const { queued: _, skip: __, ...rest } = record;
					return rest;
				}
				return record;
			});
			for (const record of records) {
				if (record.queued !== true) {
					continue;
				}
				for (const state of states) {
					if (
						state.lane === record.id &&
						state.stage !== "queued" &&
						isReady(state) &&
						!(record.skip ?? []).includes(state.id)
					) {
						queued.push(
							(await this.tasks.save({ ...state, stage: "queued" })).state,
						);
					}
				}
			}
			if (ended) {
				await this.writeLanes(next);
			}
			return queued;
		});
	}

	/** Removes lane `id`, putting its tasks back in none, untriaged. */
	async dropLane(id: number): Promise<void> {
		protectBacklog(id);
		await this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			lacking(records, id);
			for (const state of states.filter((state) => state.lane === id)) {
				await this.tasks.save({ ...state, lane: null });
			}
			await this.writeLanes(records.filter((record) => record.id !== id));
		});
	}

	/**
	 * @internal Removes each lane in `ids` that no task is in any more: a lane
	 * whose last task merged is done. One emptied by hand stays, to be filled.
	 */
	async endLanes(ids: number[]): Promise<void> {
		await this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			const done = new Set(
				ids.filter(
					(id) =>
						id !== BACKLOG_LANE && !states.some((state) => state.lane === id),
				),
			);
			if (done.size > 0) {
				await this.writeLanes(records.filter((record) => !done.has(record.id)));
			}
		});
	}

	/**
	 * Moves tasks saved while splates kept tags into lanes, one lane a tag,
	 * and drops their tags, which splates refuses to read until then. A task
	 * in no lane goes to the lane of its tag the most tasks share, at the
	 * bottom, in list order, below anything in that lane blocking it; a lane
	 * already called that takes them. Gives back each lane it filled, with
	 * the tasks it put there, in board order; none once no task has tags.
	 */
	async moveTagsToLanes(): Promise<{ lane: LaneRecord; tasks: number[] }[]> {
		return this.tasks.locked(async () => {
			const entries = await this.tasks.store.records.list();
			const parsed: { state: TaskRecord; tags: string[] }[] = [];
			for (const entry of entries.filter((entry) => TASK_FILE.test(entry))) {
				const raw = (await this.tasks.store.records.read(entry)) ?? "";
				const found = parseTaskFile(raw);
				if (found !== null && found.tags.length > 0) {
					parsed.push(found);
				}
			}
			if (parsed.length === 0) {
				return [];
			}
			const counts = new Map<string, number>();
			for (const { tags } of parsed) {
				for (const tag of tags) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1);
				}
			}
			const states = await this.tasks.stored(
				parsed.map(({ state }) => state.id),
			);
			const records = await this.records(states);
			const filled = new Map<number, number[]>();
			for (const state of states) {
				const tags = parsed.find((each) => each.state.id === state.id)?.tags;
				if (tags === undefined) {
					continue;
				}
				let lane = state.lane;
				if (lane === null) {
					const [tag] = [...tags].sort(
						(left, right) =>
							(counts.get(right) ?? 0) - (counts.get(left) ?? 0) ||
							left.localeCompare(right),
					) as [string];
					const name = tagName(tag);
					let record = records.find(
						(each) => each.name.toLowerCase() === name.toLowerCase(),
					);
					if (record === undefined) {
						record = { id: await this.nextLaneId(states), name };
						records.push(record);
						await this.writeLanes(records);
					}
					lane = record.id;
					filled.set(lane, [...(filled.get(lane) ?? []), state.id]);
				}
				// Saved even when its lane stays, so its tags are gone.
				await this.tasks.save({ ...state, lane });
			}
			await this.tasks.renumber(settle(await this.tasks.stored()));
			return records
				.filter((record) => filled.has(record.id))
				.map((lane) => ({ lane, tasks: filled.get(lane.id) ?? [] }));
		});
	}

	/**
	 * @internal The lane `lane` names: null for none, one there is, or for
	 * `"new"` one started for `tasks`, called `name` or named after them. Call
	 * it under the lock.
	 */
	async laneId(
		lane: number | "new" | null,
		states: TaskRecord[],
		tasks: TaskRecord[],
		name?: string,
	): Promise<number | null> {
		if (lane === null) {
			return null;
		}
		if (lane !== "new") {
			lacking(await this.records(states), lane);
			return lane;
		}
		return (await this.newLane(states, tasks, name)).id;
	}

	/**
	 * Starts a lane for `tasks` after the others, called `name`, or aptly
	 * named without one. Call it under the lock.
	 */
	private async newLane(
		states: TaskRecord[],
		tasks: TaskRecord[],
		name?: string,
	): Promise<LaneRecord> {
		const records = await this.records(states);
		// Named first, so a name refused never uses up a number.
		const called =
			name === undefined
				? aptName(
						tasks,
						records.map((each) => each.name),
					)
				: laneName(name, records);
		const record = { id: await this.nextLaneId(states), name: called };
		await this.writeLanes(beforeBacklog(records, record));
		return record;
	}

	/**
	 * A lane id never handed out before, so a lane's number never comes back
	 * meaning another. Call it under the lock.
	 */
	private async nextLaneId(states: TaskRecord[]): Promise<number> {
		const last = Number(
			await this.tasks.store.records.read("last-lane").catch(() => 0),
		);
		const records = await this.records(states);
		const id =
			Math.max(
				Number.isInteger(last) ? last : 0,
				...records.map((record) => record.id),
			) + 1;
		await this.tasks.store.records.write("last-lane", String(id));
		return id;
	}

	/**
	 * @internal The lanes as stored, and after them any lane a task is in that
	 * has no record. A file that will not parse reads as none.
	 */
	async records(states: TaskRecord[]): Promise<LaneRecord[]> {
		const records = await this.read("lanes");
		if (!records.some((record) => record.id === BACKLOG_LANE)) {
			records.push({ id: BACKLOG_LANE, name: "Backlog" });
		}
		return named(states, records);
	}

	/**
	 * The name of every lane there has been: those on the board, and after
	 * them each that is gone as it was last called, so an orchestrator whose
	 * lanes are done still goes by their names.
	 */
	async names(states: TaskRecord[]): Promise<LaneRecord[]> {
		const records = await this.records(states);
		const ended = await this.read("ended-lanes");
		return [
			...records,
			...ended.filter(({ id }) => !records.some((record) => record.id === id)),
		];
	}

	/** The lane records in `file`, none when it is missing or will not parse. */
	private async read(file: string): Promise<LaneRecord[]> {
		const raw =
			(await this.tasks.store.records.read(file).catch(() => null)) ?? "[]";
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				// Only the fields lanes have, so one they no longer have, such as
				// the agent one was once assigned, goes the next time they are written.
				return parsed
					.filter(
						(each) =>
							Number.isInteger(each?.id) && typeof each?.name === "string",
					)
					.map(({ id, name, queued, skip }) => ({
						id,
						name,
						...(queued === true ? { queued: true as const } : {}),
						...(queued === true && Array.isArray(skip)
							? { skip: skip.filter(Number.isInteger) }
							: {}),
					}));
			}
		} catch {}
		return [];
	}

	/**
	 * Writes the lanes, in board order, keeping the name of each lane they
	 * drop in `ended-lanes`. Call it under the lock.
	 */
	private async writeLanes(records: LaneRecord[]): Promise<void> {
		const dropped = (await this.read("lanes")).filter(
			({ id }) => !records.some((record) => record.id === id),
		);
		if (dropped.length > 0) {
			const ended = await this.read("ended-lanes");
			await this.write("ended-lanes", [
				...ended.filter(({ id }) => !dropped.some((each) => each.id === id)),
				...dropped,
			]);
		}
		await this.write("lanes", records);
	}

	/** Writes `records` to `file` whole, so a reader never sees half of it. */
	private async write(file: string, records: LaneRecord[]): Promise<void> {
		await this.tasks.store.records.write(
			file,
			`${JSON.stringify(records, null, "\t")}\n`,
		);
	}
}

/** The lane a tag becomes: `dark-mode` is `Dark mode`. */
function tagName(tag: string): string {
	const words = tag.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** New themed lanes precede the catch-all lane until the user moves them. */
function beforeBacklog(
	records: LaneRecord[],
	record: LaneRecord,
): LaneRecord[] {
	const at = records.findIndex((each) => each.id === BACKLOG_LANE);
	return [...records.slice(0, at), record, ...records.slice(at)];
}

/** Refuses a lane `records` lacks. */
function lacking(records: LaneRecord[], id: number): void {
	if (!records.some((record) => record.id === id)) {
		fail(
			"not_found",
			`no lane ${id}: run \`splates lane list\`, or pass \`new\` to start one`,
			{ lane: id },
		);
	}
}

/** `name` trimmed, refused when empty or when another lane has it. */
function laneName(name: string, others: LaneRecord[]): string {
	const trimmed = name.trim();
	if (trimmed === "") {
		fail("usage", "a lane needs a name: say what its tasks are for", {});
	}
	const same = others.find(
		(other) => other.name.toLowerCase() === trimmed.toLowerCase(),
	);
	if (same) {
		fail(
			"exists",
			`lane ${same.id} is already called '${same.name}': pick another name`,
			{ lane: same.id, name: same.name },
		);
	}
	return trimmed;
}
