import { fail } from "../exit";
import { type BoardRecord, DEFAULT_BOARD } from "./boards";
import type { Tasks } from "./tasks";

/** What deleting a board may do about the tasks in its lanes. */
export interface DeleteBoardOptions {
	/** The person's permission to lose the lanes that hold tasks. */
	force?: boolean;
	/** Removes one such lane, as the caller keeps its tasks to restore. */
	drop?: (lane: number) => Promise<void>;
}

/**
 * Puts boards away, brings them back and deletes them, as Trello does:
 * archiving keeps the lanes, tasks and links as they were.
 */
export class BoardLifecycle {
	constructor(private readonly tasks: Tasks) {}

	/** Puts a board away, off the switcher, its lanes, tasks and links as they were. */
	async archive(id: number): Promise<BoardRecord> {
		return this.change(id, (board) => {
			if (board.id === DEFAULT_BOARD) {
				// Backlog lives on it, and Backlog is never put away.
				fail(
					"usage",
					"the default board holds Backlog: it cannot be archived or deleted",
					{ board: id },
				);
			}
			return { ...board, archived: true };
		});
	}

	/** Brings an archived board back to the switcher. */
	async restore(id: number): Promise<BoardRecord> {
		return this.change(id, (board) => ({ ...board, archived: false }));
	}

	/**
	 * Deletes board `id`, with its empty lanes. A board whose lanes hold tasks
	 * is refused, as the person's permission is needed to lose them: move the
	 * lanes to another board first. `force` is that permission, and removes
	 * the lanes with `drop`, the way removing a lane with tasks does.
	 */
	async delete(id: number, opts: DeleteBoardOptions = {}): Promise<void> {
		const held = await this.tasks.locked(async () => {
			if (id === DEFAULT_BOARD) {
				fail("usage", "the default board cannot be deleted: it holds Backlog", {
					board: id,
				});
			}
			const boards = await this.tasks.boards();
			if (!boards.some((board) => board.id === id)) {
				fail("not_found", `no board ${id}`, { board: id });
			}
			const states = await this.tasks.stored();
			const inBoard = (await this.tasks.lanes()).filter(
				(record) => record.board === id,
			);
			const occupied = inBoard.filter((lane) =>
				states.some((state) => state.lane === lane.id),
			);
			if (occupied.length > 0 && !opts.force) {
				fail(
					"usage",
					`board ${id} holds lanes with tasks (${occupied.map((lane) => lane.name).join(", ")}): move the lanes to another board first, or ask the person with a remove-board permission card`,
					{ board: id, lanes: occupied.map((lane) => lane.id) },
				);
			}
			return inBoard;
		});
		for (const lane of held) {
			await (opts.drop ?? ((each) => this.tasks.dropLane(each)))(lane.id);
		}
		await this.tasks.locked(async () => {
			await this.write(
				(await this.tasks.boards()).filter((board) => board.id !== id),
			);
		});
	}

	private async change(
		id: number,
		change: (board: BoardRecord) => BoardRecord,
	): Promise<BoardRecord> {
		return this.tasks.locked(async () => {
			const boards = await this.tasks.boards();
			const found = boards.find((board) => board.id === id);
			if (!found) {
				fail("not_found", `no board ${id}`, { board: id });
			}
			const changed = change(found);
			await this.write(
				boards.map((board) => (board.id === id ? changed : board)),
			);
			return changed;
		});
	}

	/** Writes the boards whole, in order. Call it under the lock. */
	private async write(boards: BoardRecord[]): Promise<void> {
		await this.tasks.store.records.write(
			"boards",
			`${JSON.stringify(
				boards.map(({ id, name, archived }) => ({ id, name, archived })),
				null,
				"\t",
			)}\n`,
		);
	}
}
