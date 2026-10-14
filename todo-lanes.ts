import type { Fs } from "webappwiz/system";
import { fail } from "./exit";
import { aptName, type LaneRecord, named, settle } from "./lanes";
import type { TodoState } from "./todo";
import { parseTodoFile } from "./todo-file";
import type { Todos } from "./todos";

/**
 * The lanes of a `Todos`: their records in `lanes` beside the todos, and every
 * change that moves todos between them, each made under the todos' lock.
 */
export class TodoLanes {
	constructor(
		private readonly todos: Todos,
		private readonly fs: Fs,
	) {}

	/**
	 * Moves every todo in lane `from` to the bottom of lane `into`, in the
	 * order they had, and the lane `from` is gone.
	 */
	async joinLanes(from: number, into: number): Promise<void> {
		await this.todos.locked(async () => {
			const states = await this.todos.stored();
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
				await this.todos.save(state);
			}
			await this.todos.renumber(order);
			await this.writeLanes(records.filter((record) => record.id !== from));
		});
	}

	/** Starts an empty lane called `name`, after the others. */
	async addLane(name: string): Promise<LaneRecord> {
		return this.todos.locked(async () => {
			const states = await this.todos.stored();
			const records = await this.records(states);
			// Named first, so a name refused never uses up a number.
			const called = laneName(name, records);
			const record = { id: await this.nextLaneId(states), name: called };
			await this.writeLanes([...records, record]);
			return record;
		});
	}

	/** Calls lane `id` by another name. */
	async renameLane(id: number, name: string): Promise<LaneRecord> {
		return this.todos.locked(async () => {
			const records = await this.records(await this.todos.stored());
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
		return this.todos.locked(async () => {
			const records = await this.records(await this.todos.stored());
			lacking(records, id);
			const moved = records.find((record) => record.id === id) as LaneRecord;
			const rest = records.filter((record) => record.id !== id);
			const at = Math.min(position - 1, rest.length);
			const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
			await this.writeLanes(order);
			return order;
		});
	}

	/** Removes lane `id`, putting its todos back in none, untriaged. */
	async dropLane(id: number): Promise<void> {
		await this.todos.locked(async () => {
			const states = await this.todos.stored();
			const records = await this.records(states);
			lacking(records, id);
			for (const state of states.filter((state) => state.lane === id)) {
				await this.todos.save({ ...state, lane: null });
			}
			await this.writeLanes(records.filter((record) => record.id !== id));
		});
	}

	/**
	 * @internal Removes each lane in `ids` that no todo is in any more: a lane
	 * whose last todo merged is done. One emptied by hand stays, to be filled.
	 */
	async endLanes(ids: number[]): Promise<void> {
		await this.todos.locked(async () => {
			const states = await this.todos.stored();
			const records = await this.records(states);
			const done = new Set(
				ids.filter((id) => !states.some((state) => state.lane === id)),
			);
			if (done.size > 0) {
				await this.writeLanes(records.filter((record) => !done.has(record.id)));
			}
		});
	}

	/**
	 * Moves todos saved while arbor kept tags into lanes, one lane a tag,
	 * and drops their tags, which arbor refuses to read until then. A todo
	 * in no lane goes to the lane of its tag the most todos share, at the
	 * bottom, in list order, below anything in that lane blocking it; a lane
	 * already called that takes them. Gives back each lane it filled, with
	 * the todos it put there, in board order; none once no todo has tags.
	 */
	async moveTagsToLanes(): Promise<{ lane: LaneRecord; todos: number[] }[]> {
		return this.todos.locked(async () => {
			const entries = await this.fs.readdir(this.todos.dir).catch(() => []);
			const parsed: { state: TodoState; tags: string[] }[] = [];
			for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
				const raw = await this.fs
					.read(`${this.todos.dir}/${entry}`)
					.catch(() => "");
				const found = parseTodoFile(raw);
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
			const states = await this.todos.stored(
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
				await this.todos.save({ ...state, lane });
			}
			await this.todos.renumber(settle(await this.todos.stored()));
			return records
				.filter((record) => filled.has(record.id))
				.map((lane) => ({ lane, todos: filled.get(lane.id) ?? [] }));
		});
	}

	/**
	 * @internal The lane `lane` names: null for none, one there is, or for
	 * `"new"` one started for `todos`, called `name` or named after them. Call
	 * it under the lock.
	 */
	async laneId(
		lane: number | "new" | null,
		states: TodoState[],
		todos: TodoState[],
		name?: string,
	): Promise<number | null> {
		if (lane === null) {
			return null;
		}
		if (lane !== "new") {
			lacking(await this.records(states), lane);
			return lane;
		}
		return (await this.newLane(states, todos, name)).id;
	}

	/**
	 * Starts a lane for `todos` after the others, called `name`, or aptly
	 * named without one. Call it under the lock.
	 */
	private async newLane(
		states: TodoState[],
		todos: TodoState[],
		name?: string,
	): Promise<LaneRecord> {
		const records = await this.records(states);
		// Named first, so a name refused never uses up a number.
		const called =
			name === undefined
				? aptName(
						todos,
						records.map((each) => each.name),
					)
				: laneName(name, records);
		const record = { id: await this.nextLaneId(states), name: called };
		await this.writeLanes([...records, record]);
		return record;
	}

	/**
	 * A lane id never handed out before, so a lane's number never comes back
	 * meaning another. Call it under the lock.
	 */
	private async nextLaneId(states: TodoState[]): Promise<number> {
		const last = Number(
			await this.fs.read(`${this.todos.dir}/last-lane`).catch(() => 0),
		);
		const records = await this.records(states);
		const id =
			Math.max(
				Number.isInteger(last) ? last : 0,
				...records.map((record) => record.id),
			) + 1;
		await this.fs.mkdir(this.todos.dir);
		await this.fs.write(`${this.todos.dir}/last-lane`, String(id));
		return id;
	}

	/**
	 * @internal The lanes as stored, and after them any lane a todo is in that
	 * has no record. A file that will not parse reads as none.
	 */
	async records(states: TodoState[]): Promise<LaneRecord[]> {
		const raw = await this.fs.read(`${this.todos.dir}/lanes`).catch(() => "[]");
		let stored: LaneRecord[] = [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				// Only the id and name, so a field lanes no longer have, such as
				// the agent one was once assigned, goes the next time they are written.
				stored = parsed
					.filter(
						(each) =>
							Number.isInteger(each?.id) && typeof each?.name === "string",
					)
					.map(({ id, name }) => ({ id, name }));
			}
		} catch {}
		return named(states, stored);
	}

	/** Writes the lanes, in board order. Call it under the lock. */
	private async writeLanes(records: LaneRecord[]): Promise<void> {
		await this.fs.mkdir(this.todos.dir);
		const path = `${this.todos.dir}/lanes`;
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(records, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
	}
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
			`no lane ${id}: run \`arbor lane list\`, or pass \`new\` to start one`,
			{ lane: id },
		);
	}
}

/** `name` trimmed, refused when empty or when another lane has it. */
function laneName(name: string, others: LaneRecord[]): string {
	const trimmed = name.trim();
	if (trimmed === "") {
		fail("usage", "a lane needs a name: say what its todos are for", {});
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
