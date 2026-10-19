import { color } from "webappwiz/log";
import { age } from "../age";
import type { Task, Tasks } from "../board";
import {
	blockerLabel,
	isReady,
	type LaneRecord,
	type LaneState,
	lane,
} from "../board";

/** What a finished task should be followed by, and what should just go. */
export interface Recommendation {
	/** The queued task to pick up next, or null when there is nothing fresh left. */
	next: Task | null;
	/** Queued tasks left waiting so long they probably no longer apply. */
	stale: Task[];
	/**
	 * The lane the finished task's queued tasks ran in, when it has more to do:
	 * `next` is its next step then, even one another lane still blocks.
	 */
	lane?: LaneState;
	/** Every lane there is now, to name those `lane` is blocked by. */
	records?: LaneRecord[];
	/** A lane the finished task's queued tasks emptied: its agent is done. */
	finished?: LaneRecord;
}

/**
 * Which queued task to take up after `task`. A task whose queued tasks ran in a lane goes
 * on down that lane, since that is what its agent was handed. Otherwise one
 * that came up in it first, since whoever just finished it knows that context
 * best, then the open one highest on the list, which is how
 * whoever keeps the list says what matters most; never one still blocked by
 * another yet to merge. Queued tasks past `staleness` are never recommended, only
 * offered for removal.
 */
export async function recommend(
	tasks: Tasks,
	task: string | null,
	staleness: number,
	ran: LaneRecord[] = [],
): Promise<Recommendation> {
	const all = await tasks.all();
	const states = all.map((each) => each.state);
	const stale = all.filter(
		(each) => each.takenBy === null && each.waited > staleness,
	);
	const records = await tasks.lanes();
	for (const record of ran) {
		const found = lane(states, record);
		if (found.next !== null) {
			return {
				next: all.find((each) => each.id === found.next?.id) ?? null,
				stale,
				lane: found,
				records,
			};
		}
	}
	const finished = ran.find(
		(record) => lane(states, record).todos.length === 0,
	);
	const rank = (each: Task) => (each.from === task ? 1 : 0);
	const open = all
		.filter((each) => isReady(each.state))
		// Stable, so each group keeps its place in the list.
		.sort((left, right) => rank(right) - rank(left));
	return {
		next: open.find((each) => each.waited <= staleness) ?? null,
		stale,
		...(finished === undefined ? {} : { finished }),
	};
}

/** The lines `merge` ends with, or none when there is nothing to say. */
export function recommendation({
	next,
	stale,
	lane,
	records = [],
	finished,
}: Recommendation): string[] {
	const lines: string[] = [];
	if (finished !== undefined) {
		lines.push(
			"",
			`${color.bold(`lane ${finished.id} ${finished.name}`)} is done: nothing is left in it, so it is gone`,
		);
	}
	if (next && lane) {
		lines.push(
			"",
			`${color.bold(`next in lane ${lane.id} ${lane.name}`)} task ${next.id}: ${next.subject}`,
			...lane.blockers.map(
				(blocker) =>
					`  ${color.yellow("blocked by")} ${blockerLabel(blocker, records)}, ${blocker.takenBy === null ? "not taken yet" : `taken by ${blocker.takenBy}`}: splates task wait ${blocker.id}`,
			),
			`  ${lane.blockers.length === 0 ? "start it" : "then start it"}: splates add <slug> --task ${next.id}`,
		);
	} else if (next) {
		lines.push(
			"",
			`${color.bold("next task")} ${next.id}: ${next.subject}`,
			`  ${from(next)}, waiting ${age(next.state.createdAt)}`,
			`  start it: splates add <slug> --task ${next.id}`,
		);
	}
	if (stale.length > 0) {
		lines.push(
			"",
			color.yellow("stale tasks, remove unless they still apply:"),
		);
		for (const each of stale) {
			lines.push(
				`  ${each.id}: ${each.subject} (${age(each.state.createdAt)})  splates task remove ${each.id}`,
			);
		}
	}
	return lines;
}

function from(each: Task): string {
	return each.from === null ? "added by hand" : `from ${each.from}`;
}
