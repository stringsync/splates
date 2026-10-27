import { type Task, type Tasks, unqueued } from "../board";
import { fail } from "../exit";
import { queueOrder } from "./order";

/**
 * Moves tasks out of the queue and within it, saying nothing: what the
 * queue's sweep and the page's drag do with the board's `tasks`.
 */
export class QueueMoves {
	constructor(private readonly tasks: Tasks) {}

	/**
	 * Takes each task in `going`, what `stalled` gives, out of the queue,
	 * noting the blockers it was let go for; gives back those it took out.
	 */
	async letGo(going: ReadonlyMap<number, readonly number[]>): Promise<Task[]> {
		const gone: Task[] = [];
		for (const [id, blockers] of going) {
			let went = false;
			const task = await this.tasks.revise(id, (state) => {
				went = state.stage === "queued" && state.takenBy === null;
				return went
					? { ...unqueued(state), unqueuedFor: [...blockers] }
					: state;
			});
			if (went) {
				gone.push(task);
			}
		}
		return gone;
	}

	/**
	 * Moves queued task `id` to `position` in the queue, from 1 for the next
	 * to start, past the end meaning the end. What it is blocked by still
	 * goes first, so it lands as near there as its links allow.
	 */
	async move(id: number, position: number): Promise<void> {
		if (!Number.isInteger(position) || position <= 0) {
			fail("usage", `'${position}' is not a position: 1 is the next to start`, {
				number: id,
				position,
			});
		}
		const all = (await this.tasks.all()).map((task) => task.state);
		const task = all.find((each) => each.id === id);
		if (task?.stage !== "queued" || task.takenBy !== null) {
			fail("not_found", `task ${id} is not waiting in the queue`, {
				number: id,
			});
		}
		const order = queueOrder(all).filter((each) => each.id !== id);
		const at = order[position - 1];
		const last = order.at(-1);
		const target = at === undefined ? (last?.position ?? 0) + 1 : at.position;
		// Moving down, the task leaves its place first, so every one between
		// moves up one: what was at `target` is then one higher.
		await this.tasks.move(id, task.position < target ? target - 1 : target);
	}
}
