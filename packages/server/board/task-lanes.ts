import { fail } from "../exit";
import { BACKLOG_LANE, PLACED, protectBacklog } from "./backlog";
import { type BoardRecord, boardsOf, DEFAULT_BOARD } from "./boards";
import { aptName, type LaneRecord, named, settle } from "./lanes";
import { enqueued, type TaskRecord, unqueued } from "./task";
import { parseTaskFile, TASK_FILE } from "./task-file";
import type { Tasks } from "./tasks";

/**
 * Creates, changes and removes the lanes of a `Tasks`, moves tasks between
 * them, and queues the tasks of a lane. Each change is atomic.
 */
export class TaskLanes {
	constructor(private readonly tasks: Tasks) {}

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

	/** Starts an empty lane called `name`, after the others, on `board` or the default one. */
	async addLane(name: string, board = DEFAULT_BOARD): Promise<LaneRecord> {
		return this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			if (!(await this.boards()).some((each) => each.id === board)) {
				fail("not_found", `no board ${board}`, { board });
			}
			// Named first, so a name refused never uses up a number.
			const called = laneName(name, records);
			const record = {
				id: await this.nextLaneId(states),
				name: called,
				board,
			};
			await this.writeLanes([...records, record]);
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
	 * Puts lane `id` at `position`, 1 the first column, past the last meaning
	 * the last; the others close up around it. With a `board` the position is
	 * among that board's lanes; without one the lane stays on its board and
	 * the position is among every lane. Without a `position` it goes last. Its tasks, queue state and links do not change.
	 */
	async moveLane(
		id: number,
		position?: number,
		board?: number,
	): Promise<LaneRecord[]> {
		if (
			position !== undefined &&
			(!Number.isInteger(position) || position <= 0)
		) {
			fail("usage", `'${position}' is not a position: 1 is the first lane`, {
				position,
			});
		}
		if (id === BACKLOG_LANE) {
			fail("usage", "Backlog is static: it always comes first", {
				lane: id,
			});
		}
		return this.tasks.locked(async () => {
			const records = await this.records(await this.tasks.stored());
			lacking(records, id);
			const found = records.find((record) => record.id === id) as LaneRecord;
			const onto = board ?? found.board ?? DEFAULT_BOARD;
			if (!(await this.boards()).some((each) => each.id === onto)) {
				fail("not_found", `no board ${onto}`, { board: onto });
			}
			const moved = { ...found, board: onto };
			const rest = records.filter((record) => record.id !== id);
			if (board === undefined) {
				// Among every lane, as the board lists them; Backlog stays first.
				const at = Math.min(
					Math.max((position ?? rest.length + 1) - 1, 1),
					rest.length,
				);
				const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
				await this.writeLanes(order);
				return order;
			}
			const peers = rest.filter((record) => record.board === onto);
			// Past Backlog, which stays first on its board.
			const floor = peers[0]?.id === BACKLOG_LANE ? 1 : 0;
			const at = Math.min(
				Math.max((position ?? peers.length + 1) - 1, floor),
				peers.length,
			);
			// Right after the lane it follows on the board, or before the
			// first one, or last when the board is empty.
			const after = peers[at - 1];
			const before = peers[at];
			let index = rest.length;
			if (after !== undefined) {
				index = rest.indexOf(after) + 1;
			} else if (before !== undefined) {
				index = rest.indexOf(before);
			}
			const order = [...rest.slice(0, index), moved, ...rest.slice(index)];
			await this.writeLanes(order);
			return order;
		});
	}

	/**
	 * Puts board `id` at `position` among the boards, 1 the first, past the
	 * last meaning the last; the others close up around it.
	 */
	async moveBoard(id: number, position: number): Promise<BoardRecord[]> {
		if (!Number.isInteger(position) || position <= 0) {
			fail("usage", `'${position}' is not a position: 1 is the first board`, {
				position,
			});
		}
		return this.tasks.locked(async () => {
			const boards = await this.boards();
			const moved = boards.find((each) => each.id === id);
			if (moved === undefined) {
				fail("not_found", `no board ${id}`, { board: id });
			}
			const rest = boards.filter((each) => each.id !== id);
			const at = Math.min(position - 1, rest.length);
			const order = [...rest.slice(0, at), moved, ...rest.slice(at)].map(
				(each, i) => ({ ...each, position: i + 1 }),
			);
			await this.tasks.store.records.write(
				"boards",
				`${JSON.stringify(order, null, "\t")}\n`,
			);
			return order;
		});
	}

	/**
	 * Queues every task waiting in lane `id`, once: each nobody has taken,
	 * available, goes in the queue as the lane's, which starts it
	 * once nothing blocks it. A task put in the lane later is not queued. With
	 * `queued` false, takes each of its queued tasks nobody has taken back
	 * out. Gives back the lane and the tasks it queued or took out.
	 */
	async queueLane(
		id: number,
		queued: boolean,
	): Promise<{ lane: LaneRecord; changed: TaskRecord[] }> {
		return this.tasks.locked(async () => {
			const states = await this.tasks.stored();
			const records = await this.records(states);
			lacking(records, id);
			const changed: TaskRecord[] = [];
			for (const state of states) {
				if (state.lane !== id || state.takenBy !== null) {
					continue;
				}
				if (queued && state.stage === "available") {
					const next = enqueued(state, { by: "lane", lane: id });
					changed.push((await this.tasks.save(next)).state);
				} else if (!queued && state.stage === "queued") {
					changed.push((await this.tasks.save(unqueued(state))).state);
				}
			}
			return {
				lane: records.find((record) => record.id === id) as LaneRecord,
				changed,
			};
		});
	}

	/** Removes lane `id`, putting its tasks back in Backlog. */
	async dropLane(
		id: number,
		opts: { emptyOnly?: boolean } = {},
	): Promise<void> {
		protectBacklog(id);
		await this.tasks.locked(async () => {
			if (opts.emptyOnly) {
				// A failed listing must not make an occupied lane appear empty.
				await this.tasks.store.records.list();
			}
			const states = await this.tasks.stored();
			const records = await this.records(states);
			lacking(records, id);
			if (opts.emptyOnly && states.some((state) => state.lane === id)) {
				fail(
					"usage",
					`lane ${id} contains tasks: an agent can remove only an empty lane; ask the person with a remove-lane permission card`,
					{ lane: id },
				);
			}
			for (const state of states.filter((state) => state.lane === id)) {
				await this.tasks.save({
					...state,
					lane: BACKLOG_LANE,
					grooming: state.grooming ?? PLACED,
				});
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
				if (lane === null || lane === BACKLOG_LANE) {
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
						record = {
							id: await this.nextLaneId(states),
							name,
							board: DEFAULT_BOARD,
						};
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
			return BACKLOG_LANE;
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
		const record = {
			id: await this.nextLaneId(states),
			name: called,
			board: DEFAULT_BOARD,
		};
		await this.writeLanes([...records, record]);
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
			records.push({
				id: BACKLOG_LANE,
				name: "Backlog",
				board: DEFAULT_BOARD,
			});
		}
		// A lane whose board is gone, or one from before boards, is on the
		// default board; Backlog is always there.
		const boards = await this.boards();
		const placed = records.map((record) =>
			record.id === BACKLOG_LANE ||
			!boards.some((board) => board.id === record.board)
				? { ...record, board: DEFAULT_BOARD }
				: record,
		);
		// Backlog is static: always the first lane.
		const backlog = placed.filter((record) => record.id === BACKLOG_LANE);
		const others = placed.filter((record) => record.id !== BACKLOG_LANE);
		return named(states, [...backlog, ...others]);
	}

	/**
	 * The project's boards, in order. A project from before boards has the
	 * default one alone, which every lane is on.
	 */
	async boards(): Promise<BoardRecord[]> {
		const raw = await this.tasks.store.records.read("boards").catch(() => null);
		try {
			return boardsOf(raw === null ? null : JSON.parse(raw));
		} catch {
			return boardsOf(null);
		}
	}

	/** Starts a board called `name`, after the others. */
	async addBoard(name: string): Promise<BoardRecord> {
		return this.tasks.locked(async () => {
			const boards = await this.boards();
			const called = boardName(name, boards);
			const id = Math.max(...boards.map((each) => each.id)) + 1;
			const added = {
				id,
				name: called,
				position: boards.length + 1,
				archived: false,
			};
			await this.writeBoards([...boards, added]);
			return added;
		});
	}

	/** Calls board `id` by another name. */
	async renameBoard(id: number, name: string): Promise<BoardRecord> {
		return this.tasks.locked(async () => {
			const boards = await this.boards();
			const found = boards.find((each) => each.id === id);
			if (!found) {
				fail("not_found", `no board ${id}`, { board: id });
			}
			const renamed = {
				...found,
				name: boardName(
					name,
					boards.filter((each) => each.id !== id),
				),
			};
			await this.writeBoards(
				boards.map((each) => (each.id === id ? renamed : each)),
			);
			return renamed;
		});
	}

	/** Writes the boards whole, in order. Call it under the lock. */
	private async writeBoards(boards: BoardRecord[]): Promise<void> {
		await this.tasks.store.records.write(
			"boards",
			`${JSON.stringify(
				boards.map(({ id, name, archived }) => ({ id, name, archived })),
				null,
				"\t",
			)}\n`,
		);
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
					.map(({ id, name, board }) => ({
						id,
						name,
						board: Number.isInteger(board) ? board : DEFAULT_BOARD,
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

/** `name` trimmed, refused when empty or another board's. */
function boardName(name: string, others: BoardRecord[]): string {
	const trimmed = name.trim();
	if (trimmed === "") {
		fail("usage", "a board needs a name", {});
	}
	const same = others.find(
		(other) => other.name.toLowerCase() === trimmed.toLowerCase(),
	);
	if (same) {
		fail(
			"exists",
			`board ${same.id} is already called '${same.name}': pick another name`,
			{ board: same.id, name: same.name },
		);
	}
	return trimmed;
}

/** The lane a tag becomes: `dark-mode` is `Dark mode`. */
function tagName(tag: string): string {
	const words = tag.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
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
