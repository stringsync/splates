import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { laneQueued, queued } from "./board-expectations";
import type { SnapshotExpecter } from "./expecting";
import { stageOf } from "./todo-queue";

/** The board's writes a queue card makes: the person's own, never an agent's. */
export interface QueueWrites {
	queueLane(id: number, queued: boolean): Promise<void>;
	queueTodo(id: number, queued: boolean): Promise<void>;
}

/**
 * The work a queue card asks the person to queue, as the board has it now:
 * a lane's tasks at once, or tasks one by one, and what Queue now writes.
 */
export class QueueWork {
	constructor(
		readonly proposal: PermissionProposal,
		private readonly board: {
			linked: boolean;
			lanes: readonly LaneRecord[];
			todos: readonly TaskRecord[];
		},
	) {}

	/** The lane whose tasks it queues; null for tasks, or one the board no longer has. */
	get lane(): LaneRecord | null {
		const { lane } = this.proposal;
		return lane === null
			? null
			: (this.board.lanes.find((each) => each.id === lane) ?? null);
	}

	/** Whether it queues tasks one by one: named so, or a lane of one task, which queues as one. */
	private get byTask(): boolean {
		return this.proposal.lane === null || this.todos.length === 1;
	}

	/** Its tasks still on the board, in the lane's order or as the card named them. */
	get todos(): TaskRecord[] {
		const { lane, tasks } = this.proposal;
		return lane === null
			? tasks.flatMap((id) => this.board.todos.filter((todo) => todo.id === id))
			: this.board.todos.filter((todo) => todo.lane === lane);
	}

	/** What the card calls it: the lane's name as the board has it, else its title. */
	get name(): string {
		const { lane, tasks, title } = this.proposal;
		return lane === null
			? (title ?? tasks.map((id) => `#${id}`).join(", "))
			: (this.lane?.name ?? title ?? `lane ${lane}`);
	}

	/**
	 * The command that queues it from a terminal, as the person may instead,
	 * naming the project when the card's tasks are another project's.
	 */
	get command(): string {
		const { lane, tasks, project } = this.proposal;
		const splates =
			project === undefined ? "splates" : `splates --project ${project}`;
		const ids = lane === null ? tasks : this.todos.map((todo) => todo.id);
		return this.byTask
			? `${splates} queue add ${ids.join(" ")}`
			: `${splates} lane queue ${lane}`;
	}

	/**
	 * Whether it is queued: each task yet to start in the queue, or for a
	 * lane's, let go by the queue too, for a blocker that will not start
	 * from it.
	 */
	get queued(): boolean {
		return this.waiting().every(
			(todo) =>
				todo.stage === "queued" ||
				(!this.byTask && todo.unqueuedFor !== undefined),
		);
	}

	/** Whether the board no longer has it, merged or removed. */
	get gone(): boolean {
		return (
			this.board.linked &&
			(this.proposal.lane === null
				? this.todos.length === 0
				: this.lane === null)
		);
	}

	/** Queues it, shown at once through `expecter`; rejects as a write does. */
	async queue(
		expecter: SnapshotExpecter["expect"],
		writes: QueueWrites,
	): Promise<void> {
		const { lane } = this.proposal;
		if (lane !== null && !this.byTask) {
			await expecter(laneQueued(lane, true), writes.queueLane(lane, true));
			return;
		}
		await Promise.all(
			this.waiting()
				.filter((todo) => todo.stage !== "queued")
				.map((todo) =>
					expecter(queued(todo.id, true), writes.queueTodo(todo.id, true)),
				),
		);
	}

	/** Its tasks no agent has taken yet. */
	private waiting(): TaskRecord[] {
		return this.todos.filter((todo) => stageOf(todo) !== "running");
	}
}
