import type { Conversation } from "../conversations";
import { textOf } from "../conversations";
import { taskNumberReference } from "../plans";

/** What `ShipFixFollowUp` reads and reports on the board for a ship's fix task. */
export interface ShipFixBoard {
	/** Whether board task `task` is still on the board and untaken. */
	untaken(task: number): Promise<boolean>;
	/** Marks `task` abandoned on the ship, carrying `note` when the agent left one. */
	abandoned(task: number, note: string | undefined): Promise<void>;
}

/**
 * Prompts a ship-fix conversation and waits for each turn to finish before
 * checking whether the task is still untaken, nudging once, or marking it
 * abandoned.
 */
export class ShipFixFollowUp {
	constructor(private readonly board: ShipFixBoard) {}

	/** Sends `task` to `conversation` and follows up only after each turn ends. */
	async run(conversation: Conversation, task: number): Promise<void> {
		await conversation.prompt(
			`${taskNumberReference(task)}\n\nThis task fixes a step of a ship the user started: its words say how to read the run and try the step again. Once the task merges, the ship retries the step by itself; removing it hands the step back to the user.`,
			[],
		);
		await settled(conversation);
		if (
			conversation.state.status !== "idle" ||
			!(await this.board.untaken(task))
		) {
			return;
		}
		await conversation.prompt(
			`Your turn ended and task #${task} is still untaken, so the ship is waiting on it. Either take it (\`splates add --task ${task}\`) and fix the step, or, when nothing in code needs fixing, remove the task with \`--reason blocked\` and say in the reason exactly what the user has to do (for example, ship a version to staging first, then Retry).`,
			[],
		);
		await settled(conversation);
		if (
			conversation.state.status !== "idle" ||
			!(await this.board.untaken(task))
		) {
			return;
		}
		const said = conversation.state.messages
			.filter((each) => each.role === "agent")
			.at(-1);
		const note = said === undefined ? "" : textOf(said).trim();
		await this.board.abandoned(task, note === "" ? undefined : note);
	}
}

/**
 * Settles once `conversation` is no longer starting, running a turn, or
 * draining queued messages.
 */
function settled(conversation: Conversation): Promise<void> {
	const done = (): boolean => {
		const { status, messages } = conversation.state;
		if (status === "stopped" || status === "failed") {
			return true;
		}
		return status === "idle" && !messages.some((message) => message.queued);
	};
	if (done()) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const off = conversation.events.on("changed", () => {
			if (done()) {
				off();
				resolve();
			}
		});
	});
}
