import { CheckIcon, CornerUpLeftIcon, Loader2Icon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	use,
	useContext,
	useState,
} from "react";
import { lanesOf, startedLanes } from "../conversation-name";
import type { ConversationState } from "../conversations";
import type { LaneRecord } from "../lanes";
import { type Need, needOfExternal } from "../needs";
import { LANES_DONE } from "../prompts";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { Board } from "./board";
import { ReplyContext } from "./card-reply";
import { reportedAs, useNameOf } from "./conversation-names";
import { needOf } from "./conversation-rows";
import { Held } from "./handed-out";
import { useMinute } from "./hooks/use-minute";
import { Mark } from "./mark";
import { ago } from "./plan-limits";
import { Refusal, useRefusal } from "./refusal";
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

/** The conversation a thread shows, for a Working card in it to draw its plan. */
export const PlanSource = createContext<{
	conversation: ConversationState;
	tasks: Details[];
	onOpen: (id: string) => void;
} | null>(null);

/** How many rows Todo and Done show before the rest fold away. */
const SHOWN = 3;

/**
 * In a lane orchestrator's latest Working card, its plan as it stands, live
 * from arbor: Todo, its lanes' open todos no task has taken, in the order
 * they land, each with what holds it back; Doing, those taken, each with the
 * agent on it and how that one stands; and Done, the agents it started whose
 * tasks are gone, newest last. A todo opens its card, an agent its
 * conversation. Todo shows its first rows and Done its last, the rest a click
 * away; Doing, as long as the agents at once, shows them all. Once its lanes
 * are done and nothing works, only how many landed and when the last did,
 * and, until the orchestrator has said its Finished report, that arbor dev
 * tells it to. Nothing outside a thread, or for a conversation that
 * orchestrates nothing.
 */
export function PlanBoard({
	reported = false,
}: {
	/** Whether it shows in the orchestrator's Finished report. */
	reported?: boolean;
}): JSX.Element | null {
	const source = useContext(PlanSource);
	const held = useContext(Held);
	const board = use(Board);
	const nameOf = useNameOf();
	if (source === null) {
		return null;
	}
	const { conversation, tasks, onOpen } = source;
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
	// Each row names its lane only when there is more than one.
	const laned = (lane: LaneRecord, text: string) =>
		plan.lanes.length > 1 ? `${lane.name} · ${text}` : text;
	const steps = plan.lanes.flatMap(({ lane, steps }) =>
		steps.map((step) => ({ lane, ...step })),
	);
	const todo = steps
		.filter((step) => step.todo.takenBy === null)
		.map(({ lane, todo }) => (
			<PlanRow
				key={todo.id}
				onClick={() => board.open(todo.id)}
				mark={null}
				line={<TodoLine todo={todo} />}
				under={laned(lane, waitsOn(todo, open))}
			/>
		));
	// What the agent on a taken todo needs: its conversation's, or for an
	// external agent's task, the task's own.
	const needOn = ({ todo, agent }: PlanStep): Need | null => {
		if (agent !== null) {
			return needOf(tasks, agent);
		}
		const task = tasks.find((each) => each.task === todo.takenBy);
		return task === undefined ? null : needOfExternal(task, [...held]);
	};
	const doing = steps
		.filter((step) => step.todo.takenBy !== null)
		.map((step) => {
			const { lane, todo, agent } = step;
			const need = needOn(step);
			return (
				<PlanRow
					key={todo.id}
					onClick={() =>
						agent === null ? board.open(todo.id) : onOpen(agent.id)
					}
					mark={
						need === null ? null : (
							<Mark
								need={need}
								reported={agent === null ? null : reportedAs(agent)}
							/>
						)
					}
					line={<TodoLine todo={todo} />}
					under={laned(
						lane,
						agent === null ? (todo.takenBy ?? "") : nameOf(agent),
					)}
				/>
			);
		});
	const done = plan.landed.map((agent) => (
		<PlanRow
			key={agent.id}
			onClick={() => onOpen(agent.id)}
			mark={<Mark need={needOf(tasks, agent)} reported={reportedAs(agent)} />}
			line={nameOf(agent)}
			under={reportedAs(agent) === "removed" ? "Removed" : "Merged"}
		/>
	));
	const merged = plan.landed.filter(
		(agent) => reportedAs(agent) !== "removed",
	).length;
	const removed = plan.landed.length - merged;
	const working =
		conversation.status === "running" ||
		conversation.status === "starting" ||
		steps.some((step) => {
			const kind = step.todo.takenBy === null ? null : needOn(step)?.kind;
			return kind === "working" || kind === "assuming";
		});
	// Its own turn, as on a nudge, leaves its lanes as done as they were.
	if (plan.lanes.length === 0 && done.length > 0) {
		return (
			<section
				aria-label="plan"
				className="flex flex-col gap-2 px-4 pb-4 @max-md:px-3"
			>
				<Finished
					merged={merged}
					removed={removed}
					at={lastLanded(plan.landed)}
				/>
				{!reported && <Nudge working={working} />}
			</section>
		);
	}
	return (
		<section
			aria-label="plan"
			className="flex flex-col gap-3 px-4 pb-4 @max-md:px-3"
		>
			<Progress done={merged} of={merged + steps.length} working={working} />
			<div className="grid grid-cols-3 items-start gap-2 @max-md:grid-cols-1">
				<PlanColumn title="Todo" rows={todo} shown={SHOWN} />
				<PlanColumn title="Doing" rows={doing} shown={doing.length} />
				<PlanColumn title="Done" rows={done} shown={SHOWN} fromEnd />
			</div>
		</section>
	);
}

/**
 * How far the plan has come: its todos merged out of every one it holds, as a
 * bar and a count, with a spinner while any of its agents works, the
 * orchestrator too.
 */
function Progress({
	done,
	of,
	working,
}: {
	done: number;
	of: number;
	working: boolean;
}): JSX.Element {
	return (
		<div className="flex items-center gap-2.5">
			<div
				role="progressbar"
				aria-label="merged"
				aria-valuemin={0}
				aria-valuemax={of}
				aria-valuenow={done}
				className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
			>
				<div
					className="h-full rounded-full bg-success transition-[width]"
					style={{ width: `${of === 0 ? 0 : (done / of) * 100}%` }}
				/>
			</div>
			<span className="text-muted-foreground text-xs tabular-nums">
				{done} of {of}
			</span>
			{working && (
				<Loader2Icon
					role="status"
					aria-label="working"
					className="size-3.5 shrink-0 animate-spin text-muted-foreground"
				/>
			)}
		</div>
	);
}

/**
 * That arbor dev tells the orchestrator its lanes are done, and a link to
 * tell it now, gone while it works; "Nudged" in its place once clicked.
 */
function Nudge({ working }: { working: boolean }): JSX.Element {
	const send = useContext(ReplyContext)?.send ?? null;
	const [nudged, setNudged] = useState(false);
	const { refusal, attempt } = useRefusal();
	return (
		<div className="text-muted-foreground text-xs">
			<p>
				Every lane is done. arbor dev tells the orchestrator so, for it to wrap
				up with its Finished report.{" "}
				{nudged
					? "Nudged."
					: send !== null &&
						!working && (
							<button
								type="button"
								onClick={() =>
									void attempt(send(LANES_DONE), "Not nudged").then(
										(sent) => sent && setNudged(true),
									)
								}
								className="cursor-pointer underline underline-offset-2 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
							>
								Nudge it now
							</button>
						)}
			</p>
			<Refusal refusal={refusal} />
		</div>
	);
}

/** When the last of `landed` said anything, as epoch ms; null when none says. */
function lastLanded(landed: ConversationState[]): number | null {
	const times = landed.flatMap((agent) => {
		const last = agent.messages.at(-1);
		const at = last?.until ?? last?.at ?? null;
		return at === null ? [] : [Date.parse(at)];
	});
	return times.length === 0 ? null : Math.max(...times);
}

/**
 * A plan carried out: its bar full, what came of its todos, and how long ago
 * the last landed.
 */
function Finished({
	merged,
	removed,
	at,
}: {
	merged: number;
	removed: number;
	at: number | null;
}): JSX.Element {
	const now = useMinute();
	return (
		<div className="flex items-center gap-2.5">
			<div
				role="progressbar"
				aria-label="merged"
				aria-valuemin={0}
				aria-valuemax={merged}
				aria-valuenow={merged}
				className="h-1.5 flex-1 overflow-hidden rounded-full bg-success"
			/>
			<span className="flex items-center gap-1 text-success text-xs tabular-nums">
				<CheckIcon aria-hidden className="size-3.5" strokeWidth={3} />
				{removed === 0
					? `All ${merged} merged`
					: `${merged} merged, ${removed} removed`}
				{at !== null && ` ${ago(at, now)}`}
			</span>
		</div>
	);
}

function TodoLine({ todo }: { todo: TodoState }): JSX.Element {
	return (
		<>
			<span className="text-muted-foreground tabular-nums">#{todo.id}</span>{" "}
			{todo.subject}
		</>
	);
}

/**
 * One of the board's columns: its title and count, then `shown` of its rows,
 * the first or with `fromEnd` the last, the rest behind a line that opens
 * them in place.
 */
function PlanColumn({
	title,
	rows,
	shown,
	fromEnd = false,
}: {
	title: string;
	rows: JSX.Element[];
	shown: number;
	fromEnd?: boolean;
}): JSX.Element {
	const [opened, setOpened] = useState(false);
	const hidden = opened ? 0 : Math.max(0, rows.length - shown);
	const more =
		hidden === 0 ? null : (
			<li>
				<button
					type="button"
					onClick={() => setOpened(true)}
					className="w-full rounded-md px-1 py-0.5 text-start text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
				>
					{fromEnd ? `${hidden} earlier` : `${hidden} more`}
				</button>
			</li>
		);
	return (
		<div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/60 p-1.5">
			<h4 className="flex items-center gap-1.5 px-1 pt-0.5 font-medium text-muted-foreground text-xs">
				{title}
				<span className="tabular-nums">{rows.length}</span>
			</h4>
			{rows.length === 0 ? (
				<p className="px-1 pb-0.5 text-muted-foreground text-xs">Nothing</p>
			) : (
				<ul aria-label={title} className="flex flex-col gap-1.5">
					{fromEnd && more}
					{fromEnd ? rows.slice(hidden) : rows.slice(0, rows.length - hidden)}
					{!fromEnd && more}
				</ul>
			)}
		</div>
	);
}

/** What holds an open todo no task has taken back, as its row says it. */
function waitsOn(todo: TodoState, open: ReadonlySet<number>): string {
	const blockers = todo.blockedBy.filter((id) => open.has(id));
	return blockers.length === 0
		? "Ready"
		: `After ${blockers.map((id) => `#${id}`).join(", ")}`;
}

function PlanRow({
	onClick,
	mark,
	line,
	under,
}: {
	onClick: () => void;
	/** How its agent stands, as the sidebar shows it; null for none. */
	mark: ReactNode;
	line: ReactNode;
	under: string;
}): JSX.Element {
	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				className="flex w-full items-start gap-2 rounded-md border bg-background px-2.5 py-1.5 text-start text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
			>
				{mark !== null && <span className="flex h-5 items-center">{mark}</span>}
				<span className="min-w-0 flex-1">
					<span className="line-clamp-2">{line}</span>
					<span className="block truncate text-muted-foreground text-xs">
						{under}
					</span>
				</span>
			</button>
		</li>
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
