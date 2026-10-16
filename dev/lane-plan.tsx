import { CornerUpLeftIcon } from "lucide-react";
import { type JSX, type ReactNode, use, useContext } from "react";
import { stretches } from "../asked";
import { lanesOf } from "../conversation-name";
import type { ConversationState } from "../conversations";
import type { LaneRecord } from "../lanes";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { Board } from "./board";
import { reportedAs, useNameOf } from "./conversation-names";
import { needOf } from "./conversation-rows";
import { Held } from "./handed-out";
import { Mark } from "./mark";
import { LaneIcon } from "./task-icon";

/** A lane an orchestrator works, its open todos in the order they land. */
export interface PlanLane {
	lane: LaneRecord;
	steps: PlanStep[];
}

/** An open todo in a lane, with whoever is on it. */
export interface PlanStep {
	todo: TodoState;
	/** The conversation at work on the task that took it; null for none here. */
	agent: ConversationState | null;
}

/**
 * What a lane's orchestrator is carrying out, live from arbor: each lane it
 * works with its open todos, and the agents it started whose tasks are gone,
 * merged or removed, newest last. It changes plans by moving and linking
 * todos, which this follows, so it never waits on the orchestrator to say so.
 */
export interface Plan {
	lanes: PlanLane[];
	landed: ConversationState[];
}

/**
 * The plan of `orchestrator`, from every conversation, the todos and the
 * lanes: the lanes it was sent with `[ARBOR LANE N]`, those its Started cards
 * name, and those holding a todo an agent it started took. Null for a
 * conversation that started no lanes and no agents.
 */
export function planOf(
	orchestrator: ConversationState,
	conversations: readonly ConversationState[],
	todos: readonly TodoState[],
	lanes: readonly LaneRecord[],
	tasks: readonly string[],
): Plan | null {
	const started = conversations.filter(
		(each) => each.startedBy === orchestrator.id,
	);
	const sent = new Set(lanesOf(orchestrator));
	const named = new Set(startedLanes(orchestrator));
	const handed = new Set(
		todos.flatMap((todo) =>
			todo.lane !== null &&
			started.some((each) => each.task !== null && each.task === todo.takenBy)
				? [todo.lane]
				: [],
		),
	);
	const worked = lanes.filter(
		(lane) =>
			sent.has(String(lane.id)) || named.has(lane.name) || handed.has(lane.id),
	);
	if (worked.length === 0 && started.length === 0) {
		return null;
	}
	const live = (each: ConversationState) =>
		each.task !== null && tasks.includes(each.task);
	return {
		lanes: worked.map((lane) => ({
			lane,
			steps: todos
				.filter((todo) => todo.lane === lane.id)
				.toSorted((one, other) => one.position - other.position)
				.map((todo) => ({
					todo,
					agent:
						todo.takenBy === null
							? null
							: // One it started first, then whichever holds the task.
								(started.find(
									(each) => each.task === todo.takenBy && !each.archived,
								) ??
								conversations.find(
									(each) => each.task === todo.takenBy && !each.archived,
								) ??
								null),
				})),
		})),
		landed: started.filter((each) => !live(each) && each.lastTask !== null),
	};
}

/** The lanes each Started card `conversation`'s agent said names. */
function startedLanes(conversation: ConversationState): string[] {
	return conversation.messages.flatMap((message) =>
		message.role !== "agent"
			? []
			: message.parts.flatMap((part) =>
					part.type !== "text"
						? []
						: stretches(part.text).flatMap((each) =>
								each.type === "start" ? each.start.lanes : [],
							),
				),
	);
}

/**
 * Beside a lane orchestrator's thread, its plan as it stands: each lane's
 * open todos in order, each with the agent on it and how that one stands,
 * or what holds it back, then what landed. A todo opens its card, an agent
 * its conversation. Nothing for a conversation that orchestrates nothing.
 */
export function PlanCard({
	conversation,
	tasks,
	onOpen,
}: {
	conversation: ConversationState;
	tasks: Details[];
	onOpen: (id: string) => void;
}): JSX.Element | null {
	const held = useContext(Held);
	const board = use(Board);
	const nameOf = useNameOf();
	const plan = planOf(
		conversation,
		held,
		board.todos,
		board.lanes,
		tasks.map((each) => each.task),
	);
	if (plan === null) {
		return null;
	}
	const open = new Set(board.todos.map((todo) => todo.id));
	return (
		<section
			aria-label="plan"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<LaneIcon />
				Plan
			</h3>
			{plan.lanes.map(({ lane, steps }) => (
				<div key={lane.id} className="pb-1">
					<h4 className="truncate px-3 pt-1 text-muted-foreground text-xs">
						{lane.name}
					</h4>
					{steps.length === 0 ? (
						<p className="px-3 py-1 text-muted-foreground text-xs">
							Nothing left
						</p>
					) : (
						<ul>
							{steps.map(({ todo, agent }) => (
								<li key={todo.id}>
									<PlanRow
										onClick={() => board.open(todo.id)}
										mark={
											agent === null ? null : (
												<Mark
													need={needOf(tasks, agent)}
													reported={reportedAs(agent)}
												/>
											)
										}
										line={
											<>
												<span className="text-muted-foreground tabular-nums">
													#{todo.id}
												</span>{" "}
												{todo.subject}
											</>
										}
										under={
											agent !== null
												? nameOf(agent)
												: todo.takenBy !== null
													? `Taken by ${todo.takenBy}`
													: waitsOn(todo, open)
										}
									/>
								</li>
							))}
						</ul>
					)}
				</div>
			))}
			{plan.landed.length > 0 && (
				<div className="pb-1">
					<h4 className="px-3 pt-1 text-muted-foreground text-xs">Landed</h4>
					<ul>
						{plan.landed.map((agent) => (
							<li key={agent.id}>
								<PlanRow
									onClick={() => onOpen(agent.id)}
									mark={
										<Mark
											need={needOf(tasks, agent)}
											reported={reportedAs(agent)}
										/>
									}
									line={nameOf(agent)}
									under={null}
								/>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}

/** What holds an open todo no task has taken back, as its row says it. */
function waitsOn(todo: TodoState, open: ReadonlySet<number>): string {
	const blockers = todo.blockedBy.filter((id) => open.has(id));
	return blockers.length === 0
		? "Not handed out"
		: `Waits on ${blockers.map((id) => `#${id}`).join(", ")}`;
}

function PlanRow({
	onClick,
	mark,
	line,
	under,
}: {
	onClick: () => void;
	/** How its agent stands; null for none, leaving the space. */
	mark: ReactNode;
	line: ReactNode;
	under: string | null;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-start gap-2 px-3 py-1 text-start text-sm transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
		>
			<span className="flex h-5 items-center">
				{mark ?? <span className="size-3.5 shrink-0" />}
			</span>
			<span className="min-w-0 flex-1">
				<span className="line-clamp-2">{line}</span>
				{under !== null && (
					<span className="block truncate text-muted-foreground text-xs">
						{under}
					</span>
				)}
			</span>
		</button>
	);
}

/**
 * Beside the thread of an agent a lane's orchestrator started, where it came
 * from: that orchestrator, which it can go back to, and the lane and todo it
 * was handed, while the todo is open. Nothing for any other conversation,
 * or once the orchestrator is gone.
 */
export function StartedByCard({
	conversation,
	onOpen,
}: {
	conversation: ConversationState;
	onOpen: (id: string) => void;
}): JSX.Element | null {
	const held = useContext(Held);
	const board = use(Board);
	const nameOf = useNameOf();
	const by = held.find((each) => each.id === conversation.startedBy);
	if (by === undefined) {
		return null;
	}
	const todo = board.todos.find(
		(each) =>
			each.takenBy !== null &&
			each.takenBy === (conversation.task ?? conversation.lastTask),
	);
	const lane =
		todo?.lane === null || todo === undefined
			? undefined
			: board.lanes.find((each) => each.id === todo.lane);
	return (
		<section
			aria-label="started by"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<LaneIcon />
				<span className="truncate">{lane?.name ?? "Lane"}</span>
			</h3>
			{todo !== undefined && (
				<button
					type="button"
					onClick={() => board.open(todo.id)}
					className="block w-full px-3 py-1 text-start text-sm transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
				>
					<span className="text-muted-foreground tabular-nums">#{todo.id}</span>{" "}
					{todo.subject}
				</button>
			)}
			<button
				type="button"
				onClick={() => onOpen(by.id)}
				className="flex w-full items-center gap-2 px-3 py-1 text-start text-muted-foreground text-xs transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
			>
				<CornerUpLeftIcon className="size-3.5 shrink-0" />
				<span className="min-w-0 truncate">
					Started by{" "}
					<span className="font-medium text-foreground">{nameOf(by)}</span>
				</span>
			</button>
		</section>
	);
}
