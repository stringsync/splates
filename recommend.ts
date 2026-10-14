import { color } from "webappwiz/log";
import { age } from "./age";
import {
	blockerLabel,
	isReady,
	type LaneRecord,
	type LaneState,
	lane,
} from "./lanes";
import type { Todo } from "./todo";
import type { Todos } from "./todos";

/** What a finished task should be followed by, and what should just go. */
export interface Recommendation {
	/** The todo to pick up next, or null when there is nothing fresh left. */
	next: Todo | null;
	/** Todos left waiting so long they probably no longer apply. */
	stale: Todo[];
	/**
	 * The lane the finished task's todos ran in, when it has more to do:
	 * `next` is its next step then, even one another lane still blocks.
	 */
	lane?: LaneState;
	/** Every lane there is now, to name those `lane` is blocked by. */
	records?: LaneRecord[];
	/** A lane the finished task's todos emptied: its agent is done. */
	finished?: LaneRecord;
}

/**
 * Which todo to take up after `task`. A task whose todos ran in a lane goes
 * on down that lane, since that is what its agent was handed. Otherwise one
 * that came up in it first, since whoever just finished it knows that context
 * best, then the open one highest on the list, which is how
 * whoever keeps the list says what matters most; never one still blocked by
 * another yet to merge. Todos past `staleness` are never recommended, only
 * offered for removal.
 */
export async function recommend(
	todos: Todos,
	task: string | null,
	staleness: number,
	ran: LaneRecord[] = [],
): Promise<Recommendation> {
	const all = await todos.all();
	const states = all.map((todo) => todo.state);
	const stale = all.filter(
		(todo) => todo.takenBy === null && todo.waited > staleness,
	);
	const records = await todos.lanes();
	for (const record of ran) {
		const found = lane(states, record);
		if (found.next !== null) {
			return {
				next: all.find((todo) => todo.id === found.next?.id) ?? null,
				stale,
				lane: found,
				records,
			};
		}
	}
	const finished = ran.find(
		(record) => lane(states, record).todos.length === 0,
	);
	const rank = (todo: Todo) => (todo.from === task ? 1 : 0);
	const open = all
		.filter((todo) => isReady(todo.state))
		// Stable, so each group keeps its place in the list.
		.sort((left, right) => rank(right) - rank(left));
	return {
		next: open.find((todo) => todo.waited <= staleness) ?? null,
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
			`${color.bold(`next in lane ${lane.id} ${lane.name}`)} todo ${next.id}: ${next.subject}`,
			...lane.blockers.map(
				(blocker) =>
					`  ${color.yellow("blocked by")} ${blockerLabel(blocker, records)}, ${blocker.takenBy === null ? "not taken yet" : `taken by ${blocker.takenBy}`}: arbor todo wait ${blocker.id}`,
			),
			`  ${lane.blockers.length === 0 ? "start it" : "then start it"}: arbor add <task> --todo ${next.id}`,
		);
	} else if (next) {
		lines.push(
			"",
			`${color.bold("next todo")} ${next.id}: ${next.subject}`,
			`  ${from(next)}, waiting ${age(next.state.createdAt)}`,
			`  start it: arbor add <task> --todo ${next.id}`,
		);
	}
	if (stale.length > 0) {
		lines.push(
			"",
			color.yellow("stale todos, remove unless they still apply:"),
		);
		for (const todo of stale) {
			lines.push(
				`  ${todo.id}: ${todo.subject} (${age(todo.state.createdAt)})  arbor todo remove ${todo.id}`,
			);
		}
	}
	return lines;
}

function from(todo: Todo): string {
	return todo.from === null ? "added by hand" : `from ${todo.from}`;
}
