import {
	cleared,
	cycle,
	type DeferralBlocker,
	deferralBlockers,
	type ElsewhereOnBoard,
	type TaskBlockerStatus,
	type TaskRecord,
} from "@splates/server/board/browser";
import { CheckIcon, CircleIcon, LinkIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { linkTodo, queueTodo } from "./api";
import { Board } from "./board";
import { linked } from "./board-expectations";
import { CardSection } from "./card-section";
import { queueingAfter, useActs } from "./deferred-acts";
import { useExpectSnapshot } from "./expecting";
import { TodoPicker } from "./links";
import { ElsewhereMention } from "./markdown";
import { Refusal } from "./refusal";

/** What a task blocker's stage says to the person, once not cleared. */
const TASK_STATUS: Record<string, string> = {
	available: "available",
	queued: "queued",
	working: "being worked on",
	merged: "merged",
	removed: "removed without merging",
	unlinked: "no longer waited on",
	unknown: "in another project",
};

/** The deferred task on the board, `task` by name, or null once it is gone. */
export function deferredTask(
	todos: readonly TaskRecord[],
	task: string,
): TaskRecord | null {
	return (
		todos.find(
			(each) =>
				each.deferred?.task === task ||
				(each.slug === task && each.deferred !== undefined),
		) ?? null
	);
}

/** How many of the task's deferral blockers still hold it back. */
export function blockersLeft(
	task: TaskRecord,
	board: readonly TaskRecord[],
	elsewhere?: ElsewhereOnBoard,
): number {
	return deferralBlockers(task, board, elsewhere?.blockers[task.id]).filter(
		(each) => !cleared(each),
	).length;
}

/**
 * The body of a Blocked card, built from the board record of the blocked
 * task: why it stopped, a row for each task it waits on with where it stands
 * and a button to queue or unqueue it, a row to add another, and Queue all.
 * Blockers are named by task number, so what the board shows of one, its
 * name, lane or stage, is read live. Each action shows at once and is
 * undone, with the refusal said, if the server refuses it. The questions
 * and outside to-dos an older deferral recorded are listed apart, read-only.
 */
export function DeferredBody({
	task,
}: {
	task: TaskRecord;
}): JSX.Element | null {
	const board = useContext(Board);
	const { refusal, attempt, pending, act } = useActs();
	const expect = useExpectSnapshot();
	const deferred = task.deferred;
	if (deferred === undefined) {
		return null;
	}
	const all = deferralBlockers(
		task,
		board.todos,
		board.elsewhere?.blockers[task.id],
	);
	const blockers = all.filter((each) => each.kind === "task");
	const legacy = all.filter((each) => each.kind !== "task" && !cleared(each));
	const left = blockers.filter((each) => !cleared(each)).length;
	const unqueued = blockers.filter(
		(each) => each.project === undefined && each.status === "available",
	);
	const held = [...task.blockedBy];
	return (
		<div className="flex flex-col text-sm">
			<div className="flex flex-col gap-1 px-4 py-3 @max-md:px-3 @max-md:py-2.5">
				<p className="leading-relaxed">{deferred.why}</p>
				<p className="text-muted-foreground text-xs">
					{task.takenBy !== null ? (
						<>
							Started in{" "}
							<button
								type="button"
								className="underline"
								onClick={() => board.openTask(task.takenBy as string)}
							>
								{task.takenBy}
							</button>
						</>
					) : left > 0 ? (
						`${left} of ${blockers.length} left · wakes on its own when every blocker merges`
					) : (
						"Every blocker is done"
					)}
				</p>
			</div>
			<ol aria-label="blockers" className="flex flex-col">
				{blockers.map((blocker) => {
					const key = `task:${blocker.id}`;
					const done = cleared(blocker);
					const status = blocker.status;
					return (
						<li
							key={key}
							className={cn(
								"flex items-center gap-3 border-foreground/10 border-t px-4 py-2.5 @max-md:px-3",
								done && "opacity-60",
							)}
						>
							<div className="flex min-w-0 flex-1 flex-col">
								{blocker.project !== undefined ? (
									<span className="flex flex-wrap items-center gap-2">
										<ElsewhereMention
											project={
												blocker.slug ??
												blocker.project.split("/").filter(Boolean).at(-1) ??
												blocker.project
											}
											id={blocker.id}
										/>
										<span>{blocker.subject}</span>
									</span>
								) : (
									<button
										type="button"
										onClick={() => board.open(blocker.id)}
										className="cursor-pointer text-left hover:underline"
									>
										<span className="font-medium tabular-nums">
											#{blocker.id}
										</span>{" "}
										{board.todos.find((each) => each.id === blocker.id)
											?.subject ?? blocker.subject}
									</button>
								)}
								<span className="flex items-center gap-1 text-muted-foreground text-xs">
									{done && (
										<CheckIcon
											aria-label="cleared"
											className="size-3 text-success"
											strokeWidth={3}
										/>
									)}
									{TASK_STATUS[status] ?? status}
								</span>
							</div>
							{blocker.project === undefined &&
								(status === "available" || status === "queued") && (
									<Button
										size="sm"
										variant={status === "available" ? "default" : "outline"}
										disabled={pending.has(key)}
										onClick={() =>
											void act(key, () =>
												queueTodo(blocker.id, status === "available"),
											)
										}
									>
										{status === "available" ? "Queue" : "Unqueue"}
									</Button>
								)}
						</li>
					);
				})}
			</ol>
			{legacy.length > 0 && (
				<ul
					aria-label="older notes"
					className="flex flex-col gap-1 border-foreground/10 border-t px-4 py-2.5 text-muted-foreground text-xs @max-md:px-3"
				>
					{legacy.map((blocker) => (
						<li
							key={`${blocker.kind}:${blocker.kind === "question" ? blocker.text : blocker.kind === "outside" ? blocker.what : ""}`}
						>
							{blocker.kind === "question"
								? blocker.text.split("\n")[0]
								: blocker.kind === "outside"
									? blocker.what
									: ""}
						</li>
					))}
				</ul>
			)}
			<div className="flex flex-wrap items-center gap-2 border-foreground/10 border-t bg-muted/40 px-4 py-2 @max-md:px-3">
				{task.takenBy === null && (
					<TodoPicker
						label="Add blocker"
						exclude={[task.id, ...task.blockedBy]}
						loops={(other) => cycle(board.todos, task.id, other.id)}
						onPick={(other) =>
							void attempt(
								expect(
									linked(task.id, [...held, other.id]),
									linkTodo(task.id, [...held, other.id]),
								),
								"Not linked",
							)
						}
					>
						<LinkIcon />
						Add blocker
					</TodoPicker>
				)}
				{unqueued.length > 0 && (
					<Button
						size="sm"
						className="ms-auto"
						disabled={pending.has("all")}
						onClick={() =>
							void act("all", async () => {
								for (const each of unqueued) {
									await queueTodo(each.id, true);
								}
							})
						}
					>
						Queue all ({unqueued.length})
					</Button>
				)}
			</div>
			<Refusal refusal={refusal} className="px-4 pb-2" />
		</div>
	);
}

/**
 * The open task on the board that an old deferral of `task` put back, for
 * a Deferred card to show when the task has no `deferred` record; null for none.
 */
export function heldTask(
	todos: readonly TaskRecord[],
	task: string,
): TaskRecord | null {
	return (
		todos.find((each) => each.slug === task && each.deferred === undefined) ??
		null
	);
}

/**
 * What an old deferral's card adds under the agent's words: the tasks its
 * board task now waits on, each with where it stands and a way to queue
 * after it, and a Link a blocker picker for the person to say what it waits
 * on, which the deferral never recorded.
 */
export function HeldBlockers({ task }: { task: TaskRecord }): JSX.Element {
	const board = useContext(Board);
	const { refusal, attempt, pending, act } = useActs();
	const expect = useExpectSnapshot();
	const blockers = linkedBlockers(task, board.todos);
	const left = blockers.filter((each) => !cleared(each)).length;
	// What blocks it as the server takes the whole list.
	const held = task.blockedBy;
	return (
		<div className="flex flex-col gap-2 px-4 pb-3.5 text-sm @max-md:px-3 @max-md:pb-2.5">
			{blockers.length > 0 && (
				<CardSection label="to unblock" title="To unblock" ruled={false}>
					<ol className="flex flex-col gap-2">
						{blockers.map((blocker) => {
							const key = `task:${blocker.id}`;
							const done = cleared(blocker);
							return (
								<li key={key} className="flex items-start gap-2">
									<Mark done={done} />
									<TaskBlocker
										blocker={blocker}
										done={done}
										queue={{
											busy: pending.has(key),
											act: (write) => act(key, write),
											after: queueingAfter(task),
										}}
									/>
								</li>
							);
						})}
					</ol>
				</CardSection>
			)}
			{waiting(task) && (
				<div className="flex flex-wrap items-center gap-2">
					<TodoPicker
						label="Link a blocker"
						exclude={[task.id, ...task.blockedBy]}
						loops={(other) => cycle(board.todos, task.id, other.id)}
						onPick={(other) =>
							void attempt(
								expect(
									linked(task.id, [...held, other.id]),
									linkTodo(task.id, [...held, other.id]),
								),
								"Not linked",
							)
						}
					>
						<LinkIcon />
						Link a blocker
					</TodoPicker>
				</div>
			)}
			<p className="text-muted-foreground text-xs">
				<DeferredProgress
					task={task}
					left={left}
					named={blockers.length > 0}
					busy={pending.has("queue")}
					queue={() => void act("queue", () => queueTodo(task.id, true))}
				/>
			</p>
			<Refusal refusal={refusal} />
		</div>
	);
}

/**
 * The tasks `task` waits on, linked by hand rather than named by a
 * deferral, with where each stands: those still open, then those landed.
 */
function linkedBlockers(
	task: TaskRecord,
	board: readonly TaskRecord[],
): Extract<DeferralBlocker, { kind: "task" }>[] {
	const open = task.blockedBy.map((id) => {
		const other = board.find((each) => each.id === id);
		const status: TaskBlockerStatus =
			other === undefined
				? "removed"
				: other.takenBy !== null || other.stage === "running"
					? "working"
					: other.stage;
		return {
			kind: "task" as const,
			id,
			subject: other?.subject ?? "",
			status,
		};
	});
	const landed = (task.blockersLanded ?? []).map(({ id, subject }) => ({
		kind: "task" as const,
		id,
		subject,
		status: "merged" as const,
	}));
	return [...open, ...landed];
}

/** Whether `task` sits on the board waiting for the person to start it. */
function waiting(task: TaskRecord): boolean {
	return task.takenBy === null && task.stage === "available";
}

/** A blocker's check once cleared, or an empty circle while it holds. */
function Mark({ done }: { done: boolean }): JSX.Element {
	return done ? (
		<CheckIcon
			aria-label="cleared"
			className="mt-0.5 size-4 shrink-0 text-success"
			strokeWidth={3}
		/>
	) : (
		<CircleIcon
			aria-hidden
			className="mt-0.5 size-4 shrink-0 text-muted-foreground"
		/>
	);
}

function TaskBlocker({
	blocker,
	done,
	queue,
}: {
	blocker: Extract<DeferralBlocker, { kind: "task" }>;
	done: boolean;
	/** Queueing it then the task after it, for an old deferral's card; none for a Deferred one's. */
	queue?: {
		busy: boolean;
		act: (write: () => Promise<void>) => void;
		after: (id: number, queued: boolean) => () => Promise<void>;
	};
}): JSX.Element {
	const board = useContext(Board);
	const status = blocker.status;
	const open = status === "available";
	// Another project's task is queued from its own board, which the link opens.
	if (blocker.project !== undefined) {
		return (
			<div className="flex flex-wrap items-center gap-2">
				<ElsewhereMention
					project={
						blocker.slug ??
						blocker.project.split("/").filter(Boolean).at(-1) ??
						blocker.project
					}
					id={blocker.id}
				/>
				<span className={cn(done && "text-muted-foreground")}>
					{blocker.subject}
				</span>
				<span className="text-muted-foreground text-xs">
					· {TASK_STATUS[status] ?? status}
				</span>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onClick={() => board.open(blocker.id)}
				className={cn(
					"cursor-pointer text-left hover:underline",
					done && "text-muted-foreground",
				)}
			>
				<span className="tabular-nums">#{blocker.id}</span> {blocker.subject}
			</button>
			<span className="whitespace-nowrap text-muted-foreground text-xs">
				· {TASK_STATUS[status] ?? status}
			</span>
			{queue !== undefined && !done && (open || status === "queued") && (
				<Button
					size="sm"
					variant="outline"
					disabled={queue.busy}
					onClick={() =>
						queue.act(queue.after(blocker.id, status === "queued"))
					}
				>
					{open ? `Queue to run after #${blocker.id}` : "Queue"}
				</Button>
			)}
		</div>
	);
}

/** Where the deferred task stands now, from the board, not from the report. */
function DeferredProgress({
	task,
	left,
	named = true,
	busy,
	queue,
}: {
	task: TaskRecord;
	left: number;
	/** False for an old deferral that names nothing it waits on yet. */
	named?: boolean;
	/** Whether queueing it is on its way. */
	busy: boolean;
	queue: () => void;
}): JSX.Element {
	const board = useContext(Board);
	if (task.takenBy !== null) {
		return (
			<>
				Started in{" "}
				<button
					type="button"
					className="underline"
					onClick={() => board.openTask(task.takenBy as string)}
				>
					{task.takenBy}
				</button>
			</>
		);
	}
	if (task.stage === "queued") {
		const waits = task.blockedBy.map((id) => `#${id}`).join(", ");
		return <>Queued{waits === "" ? "" : ` · waits on ${waits}`}</>;
	}
	if (left > 0) {
		return <>Starts on its own once queued and unblocked.</>;
	}
	return (
		<span className="flex flex-wrap items-center gap-2">
			{named
				? "Nothing left to wait on: queue it to start."
				: "Link what it waits on, or queue it to start."}
			{waiting(task) && (
				<Button size="sm" variant="outline" disabled={busy} onClick={queue}>
					Queue
				</Button>
			)}
		</span>
	);
}

/**
 * The blockers of a deferred task that only the person can clear and have
 * not: its open questions and outside things not yet marked done.
 */
export function openForPerson(
	task: TaskRecord,
	board: readonly TaskRecord[],
): DeferralBlocker[] {
	return deferralBlockers(task, board).filter(
		(each) => each.kind !== "task" && !cleared(each),
	);
}
