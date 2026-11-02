import { color, type Logger } from "core/log";
import { fail } from "../exit";
import type { Facts } from "../records";
import { table } from "../table";
import { BoardLifecycle } from "./board-lifecycle";
import { type BoardRecord, DEFAULT_BOARD } from "./boards";
import type { LaneRecord } from "./lanes";
import type { Tasks } from "./tasks";

type Deps = { tasks: Tasks; log: Logger };

/** Every board, in order, with the lanes on it. */
export async function boardList(
	{ tasks, log }: Deps,
	{ json = false }: { json?: boolean } = {},
): Promise<void> {
	const boards = await tasks.boards();
	const lanes = await lanesByBoard(tasks);
	if (json) {
		log.info(
			JSON.stringify(
				boards.map((board) => boardJson(board, lanes.get(board.id) ?? [])),
				null,
				"\t",
			),
		);
		return;
	}
	log.info(
		table(
			["BOARD", "NAME", "LANES", "ARCHIVED"],
			boards.map((board) => [
				String(board.id),
				board.name,
				(lanes.get(board.id) ?? []).map((lane) => lane.id).join(","),
				board.archived ? "yes" : "",
			]),
		),
	);
}

/** One board and the lanes on it, in order. */
export async function boardShow(
	{ tasks, log }: Deps,
	id: number,
	{ json = false }: { json?: boolean } = {},
): Promise<void> {
	const board = await found(tasks, id);
	const lanes = (await lanesByBoard(tasks)).get(id) ?? [];
	if (json) {
		log.info(JSON.stringify(boardJson(board, lanes), null, "\t"));
		return;
	}
	log.info(
		[
			`${color.bold(`board ${id}`)} ${board.name}${board.archived ? " (archived)" : ""}: ${lanes.length} lane${lanes.length === 1 ? "" : "s"}`,
			...lanes.map((lane, i) => `  ${i + 1}. lane ${lane.id} ${lane.name}`),
		].join("\n"),
	);
}

/** The lanes on each board, in board order. */
async function lanesByBoard(tasks: Tasks): Promise<Map<number, LaneRecord[]>> {
	const found = new Map<number, LaneRecord[]>();
	for (const record of await tasks.lanes()) {
		const board = record.board ?? DEFAULT_BOARD;
		found.set(board, [...(found.get(board) ?? []), record]);
	}
	return found;
}

function boardJson(board: BoardRecord, lanes: LaneRecord[]) {
	return {
		board: board.id,
		name: board.name,
		position: board.position,
		archived: board.archived,
		lanes: lanes.map((lane) => lane.id),
	};
}

async function found(tasks: Tasks, id: number): Promise<BoardRecord> {
	const board = (await tasks.boards()).find((each) => each.id === id);
	if (board === undefined) {
		fail(
			"not_found",
			`no board ${id}: \`splates board list\` shows those there are`,
			{ board: id },
		);
	}
	return board;
}

/** Starts an empty board called `name`, after the others. */
export async function boardAdd(
	{ tasks, log }: Deps,
	name: string,
): Promise<BoardRecord> {
	const record = await tasks.addBoard(name);
	log.info(
		[
			`${color.green("added")} board ${record.id}: ${record.name}`,
			`  fill it: splates lane add <name> --board ${record.id}`,
		].join("\n"),
	);
	return record;
}

export interface BoardUpdateOptions {
	/** What it is called from now on. */
	name?: string;
	/** Where it goes among the boards, 1 the first. */
	position?: number;
	/** Put it away (true) or bring it back (false). */
	archived?: boolean;
}

/**
 * Renames a board, moves it among the others, or archives or restores it.
 * Returns the facts of a rename, the one change the journal records.
 */
export async function boardUpdate(
	{ tasks, log }: Deps,
	id: number,
	{ name, position, archived }: BoardUpdateOptions,
): Promise<BoardRecord> {
	if (name === undefined && position === undefined && archived === undefined) {
		fail(
			"usage",
			"nothing to change: pass `--name <name>`, `--position <n>`, `--archived` or `--no-archived`",
			{ board: id },
		);
	}
	await found(tasks, id);
	if (name !== undefined) {
		await tasks.renameBoard(id, name);
	}
	if (archived !== undefined) {
		const lifecycle = new BoardLifecycle(tasks);
		await (archived ? lifecycle.archive(id) : lifecycle.restore(id));
	}
	if (position !== undefined) {
		await tasks.moveBoard(id, position);
	}
	const board = await found(tasks, id);
	log.info(
		[
			`${color.green("updated")} board ${id}: ${board.name}${board.archived ? " (archived)" : ""}`,
			`  boards in order: ${(await tasks.boards()).map((each) => `${each.id} ${each.name}`).join(", ")}`,
		].join("\n"),
	);
	return board;
}

/** The event facts of a rename. */
export function boardRenamed(board: BoardRecord): Facts["board rename"] {
	return { board: board.id, name: board.name };
}

/** What deleting a board may do. */
export interface BoardRemoveOptions {
	/** The person's permission to lose lanes that hold tasks. */
	force?: boolean;
}

/**
 * Deletes a board. An agent may delete an empty one; one whose lanes hold
 * tasks needs the person's permission card, so it is refused unless `force`.
 */
export async function boardRemove(
	{ tasks, log }: Deps,
	id: number,
	opts: BoardRemoveOptions = {},
): Promise<void> {
	await found(tasks, id);
	await new BoardLifecycle(tasks).delete(id, { force: opts.force });
	log.info(`${color.green("removed")} board ${id}`);
}
