import { type JSX, useContext } from "react";
import { isReady, type LaneRecord, lane } from "../lanes";
import { laneReference, taskReference, todoReference } from "../prompts";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { Board } from "./board";
import { DirectiveChip } from "./directives";

/** How many the home screen recommends: few, so the row stays short. */
const SHOWN = 2;

/**
 * What no agent is on, as directives, best first: a live task no conversation
 * or external agent holds, since its work is half done; then a lane nobody
 * works down whose next todo is free to start; then the highest open todo in
 * no lane. One of each kind before a second of any.
 */
export function recommended(
	free: Details[],
	board: { todos: TodoState[]; lanes: LaneRecord[] },
): string[] {
	const tasks = free
		.filter((each) => each.lease !== "held")
		.map((each) => taskReference(each.task));
	const lanes = board.lanes
		.map((record) => lane(board.todos, record))
		.filter((each) => each.agents.length === 0 && each.ready)
		.map((each) => laneReference(each.id));
	const todos = board.todos
		.filter((each) => each.lane === null && isReady(each))
		.sort((one, other) => one.position - other.position)
		.map((each) => todoReference(each.id));
	const kinds = [tasks, lanes, todos];
	return [
		...kinds.flatMap((each) => each.slice(0, 1)),
		...kinds.flatMap((each) => each.slice(1)),
	].slice(0, SHOWN);
}

/**
 * The section under the home screen's composer recommending what no agent is
 * on; a tap starts a conversation that takes it up. Its chips wrap onto more
 * lines rather than overlap where the screen is narrow.
 */
export function Recommended({
	free,
	starting,
	onStart,
}: {
	/** The live tasks no listed conversation runs in. */
	free: Details[];
	/** Whether a conversation is starting already. */
	starting: boolean;
	/** Starts a conversation whose first message is `directive`. */
	onStart: (directive: string) => void;
}): JSX.Element {
	const board = useContext(Board);
	const shown = recommended(free, board);
	return (
		<section aria-label="recommended" className="mt-4 flex flex-col gap-1 px-2">
			<h3 className="pl-3 font-medium text-muted-foreground text-xs">
				Recommended
			</h3>
			<div className="flex min-h-7 min-w-0 items-center pl-3">
				{shown.length === 0 ? (
					<span className="truncate text-muted-foreground text-xs">
						Nothing unclaimed
					</span>
				) : (
					<ul className="flex min-w-0 flex-wrap gap-1.5">
						{shown.map((directive) => (
							<li key={directive} className="flex min-w-0 max-w-full">
								<button
									type="button"
									title={`Start a conversation with ${directive}`}
									disabled={starting}
									onClick={() => onStart(directive)}
									className="flex min-w-0 cursor-pointer rounded-md *:shrink hover:bg-muted disabled:cursor-default disabled:opacity-60"
								>
									<DirectiveChip directive={directive} />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
