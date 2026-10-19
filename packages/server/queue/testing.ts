import type { TaskRecord } from "../board";
import type { AgentPick } from "../models";
import type { QueuePicked, QueuePicker } from "./runner";

/**
 * Auto pick for the queue: guesses Claude for every task, and decides
 * `decides`, recording what it was asked and told.
 */
export class FakePicker implements QueuePicker {
	decides: AgentPick = { agent: "claude" };
	/** Runs as it decides: set it to write the task's record, as Auto pick keeps its decision there. */
	keeps: (queued: TaskRecord) => Promise<void> = async () => {};
	/** Each task it was asked to judge ahead, by id, once per check. */
	ahead = async (queued: readonly TaskRecord[]) => {
		this.aheadOf.push(...queued.map((each) => each.id));
	};

	judging = () => false;
	aheadOf: number[] = [];
	guessed: number[] = [];
	decided: number[] = [];
	told: { queued: number; conversation: string }[] = [];

	guess = async (queued: readonly TaskRecord[]) => {
		this.guessed.push(...queued.map((each) => each.id));
		return new Map(
			queued.map((each): [number, AgentPick] => [each.id, { agent: "claude" }]),
		);
	};

	decide = async (queued: TaskRecord): Promise<QueuePicked> => {
		this.decided.push(queued.id);
		await this.keeps(queued);
		return {
			pick: this.decides,
			tell: async (conversation) => {
				this.told.push({ queued: queued.id, conversation });
			},
		};
	};
}
