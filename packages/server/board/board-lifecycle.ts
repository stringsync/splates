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
 * Deletes boards, with their lanes.
 */
export class BoardLifecycle {
	constructor(private readonly tasks: Tasks) {}

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

	/** Writes the boards whole, in order. Call it under the lock. */
	private async write(boards: BoardRecord[]): Promise<void> {
		await this.tasks.store.records.write(
			"boards",
			`${JSON.stringify(
				boards.map(({ id, name }) => ({ id, name })),
				null,
				"\t",
			)}\n`,
		);
	}
}
