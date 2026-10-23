import { TASK } from "@stringsync/splates-server/plans/browser";
import type { Snapshot } from "@stringsync/splates-server/tasks";

/** One merge in the status popover, timed from when it was asked for. */
export interface QueuedMerge {
	task: string;
	conversation: string;
	running: boolean;
	since: number;
	place: number | null;
}

/** The merge queue's confirmed groups and the tasks still waiting outside them. */
export class MergeQueue {
	readonly merges: QueuedMerge[];
	readonly batches: QueuedMerge[][];
	readonly waiting: QueuedMerge[];
	readonly separate: QueuedMerge[];

	constructor(snapshot: Snapshot | null) {
		this.merges = (snapshot?.tasks ?? [])
			.flatMap((task) =>
				task.gate !== null && task.mergeSince !== null
					? [
							{
								task: task.task,
								conversation:
									task.takenBy ?? task.caller ?? `${TASK}${task.task}`,
								running: task.gate === "running" || task.status === "merging",
								since: Date.parse(task.mergeSince),
								place: null as number | null,
							},
						]
					: [],
			)
			.sort(
				(one, other) =>
					Number(other.running) - Number(one.running) ||
					one.since - other.since,
			);
		this.waiting = this.merges.filter((merge) => !merge.running);
		this.waiting.forEach((merge, index) => {
			merge.place = index + 1;
		});
		this.batches = (snapshot?.mergeBatches ?? [])
			.map((batch) =>
				batch.flatMap((task) => {
					const merge = this.merges.find(
						(merge) => merge.task === task && merge.running,
					);
					return merge === undefined ? [] : [merge];
				}),
			)
			.filter((batch) => batch.length > 1);
		const grouped = new Set(this.batches.flat());
		this.separate = this.merges.filter((merge) => !grouped.has(merge));
	}

	/** A lone running merge stays quiet; a shared gate remains inspectable even with no waiting tasks. */
	get visible(): boolean {
		return this.waiting.length > 0 || this.batches.length > 0;
	}

	/** The longest wait, or a shared gate's oldest merge when nobody waits outside it. */
	get since(): number {
		return (this.waiting[0] ?? this.merges[0])?.since ?? 0;
	}
}
