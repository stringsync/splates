import {
	cleared,
	cycle,
	type DeferralBlocker,
	deferralBlockers,
	type ElsewhereOnBoard,
	type TaskBlockerStatus,
	type TaskRecord,
} from "@stringsync/splates-server/board/browser";
import { CheckIcon, CircleIcon, LinkIcon, Trash2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import {
	answerDeferral,
	finishOutside,
	linkTodo,
	queueTodo,
	removeTodo,
} from "./api";
import { Board } from "./board";
import { linked } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { TodoPicker } from "./links";
import { ElsewhereMention, HEADING } from "./markdown";
import { Refusal, useRefusal } from "./refusal";

/** What a task blocker's stage says to the person, once not cleared. */
const TASK_STATUS: Record<string, string> = {
	backlog: "in backlog",
	ready: "in backlog, ready",
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
 * The body of a Deferred card, built from the board record of the deferred
 * task: why it stopped, a checklist of what unblocks it with an action for
 * each, and where the work stands now. Each action shows at once and is
 * undone, with the refusal said, if the server refuses it.
 */
export function DeferredBody({
	task,
}: {
	task: TaskRecord;
}): JSX.Element | null {
	const board = useContext(Board);
	const deferred = task.deferred;
	const blockers = deferralBlockers(
		task,
		board.todos,
		board.elsewhere?.blockers[task.id],
	);
	const { refusal, shown, act } = useActs();
	const [answers, setAnswers] = useState<Record<number, string>>({});
	if (deferred === undefined) {
		return null;
	}
	const queueAfter = queueingAfter(task);
	const left = blockers.filter((each) => !cleared(each)).length;
	let questionIndex = -1;
	let outsideIndex = -1;
	return (
		<div className="flex flex-col gap-3 px-4 py-3.5 text-sm @max-md:px-3 @max-md:py-2.5">
			<section aria-label="why it stopped">
				<h4 className={HEADING}>Why it stopped</h4>
				<p className="leading-relaxed">{deferred.why}</p>
			</section>
			<section aria-label="to unblock">
				<h4 className={HEADING}>To unblock</h4>
				<ol className="flex flex-col gap-2">
					{blockers.map((blocker, i) => {
						const key = `${blocker.kind}:${i}`;
						const done = cleared(blocker) || shown.has(key);
						let index = 0;
						if (blocker.kind === "question") {
							questionIndex += 1;
							index = questionIndex;
						} else if (blocker.kind === "outside") {
							outsideIndex += 1;
							index = outsideIndex;
						}
						return (
							<li key={key} className="flex items-start gap-2">
								<Mark done={done} />
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									{blocker.kind === "task" && (
										<TaskBlocker
											blocker={blocker}
											done={done}
											act={(write) => act(key, write)}
											queueAfter={queueAfter}
										/>
									)}
									{blocker.kind === "question" && (
										<>
											<p className={cn(done && "text-muted-foreground")}>
												{blocker.text.split("\n")[0]}
											</p>
											{blocker.answer !== undefined && (
												<p className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1">
													{blocker.answer}
												</p>
											)}
											{!done && (
												<form
													className="flex flex-wrap items-center gap-2"
													onSubmit={(event) => {
														event.preventDefault();
														const answer = (answers[i] ?? "").trim();
														if (answer === "") {
															return;
														}
														void act(key, async () => {
															await answerDeferral(task.id, index, answer);
															await queueTodo(task.id, true);
														});
													}}
												>
													<input
														aria-label="answer"
														placeholder="Your answer"
														value={answers[i] ?? ""}
														onChange={(event) =>
															setAnswers({
																...answers,
																[i]: event.target.value,
															})
														}
														className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 pointer-coarse:h-10"
													/>
													<Button
														type="submit"
														size="sm"
														variant="outline"
														disabled={(answers[i] ?? "").trim() === ""}
													>
														Answer and queue
													</Button>
												</form>
											)}
										</>
									)}
									{blocker.kind === "outside" && (
										<div className="flex flex-wrap items-start gap-2">
											<span className={cn(done && "text-muted-foreground")}>
												{blocker.what}
											</span>
											{!done && (
												<Button
													size="sm"
													variant="outline"
													onClick={() =>
														void act(key, () => finishOutside(task.id, index))
													}
												>
													Mark done
												</Button>
											)}
										</div>
									)}
								</div>
							</li>
						);
					})}
				</ol>
			</section>
			<p className="text-muted-foreground text-xs">
				<DeferredProgress
					task={task}
					left={left}
					queued={shown.has("queue")}
					queue={() => void act("queue", () => queueTodo(task.id, true))}
				/>
			</p>
			{waiting(task) ? (
				<p className="flex justify-end gap-2 text-xs">
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() =>
							void act("resume", async () => {
								await linkTodo(task.id, [], []);
								await queueTodo(task.id, true);
							})
						}
					>
						Resume anyway
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						title="Takes the task off the board, so it never starts"
						onClick={() => void act("remove", () => removeTodo(task.id))}
					>
						<Trash2Icon data-icon="inline-start" />
						Remove
					</Button>
				</p>
			) : null}
			<Refusal refusal={refusal} />
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
	const { refusal, attempt, shown, act } = useActs();
	const expect = useExpectSnapshot();
	const blockers = linkedBlockers(task, board.todos);
	const left = blockers.filter((each) => !cleared(each)).length;
	// What blocks it as the server takes the whole list, those it lost included.
	const held = [
		...task.blockedBy,
		...(task.blockersLost ?? []).map(({ id }) => id),
	];
	return (
		<div className="flex flex-col gap-2 px-4 pb-3.5 text-sm @max-md:px-3 @max-md:pb-2.5">
			{blockers.length > 0 && (
				<section aria-label="to unblock">
					<h4 className={HEADING}>To unblock</h4>
					<ol className="flex flex-col gap-2">
						{blockers.map((blocker) => {
							const key = `task:${blocker.id}`;
							const done = cleared(blocker) || shown.has(key);
							return (
								<li key={key} className="flex items-start gap-2">
									<Mark done={done} />
									<TaskBlocker
										blocker={blocker}
										done={done}
										act={(write) => act(key, write)}
										queueAfter={queueingAfter(task)}
									/>
								</li>
							);
						})}
					</ol>
				</section>
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
					queued={shown.has("queue")}
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
	return (
		task.takenBy === null &&
		(task.stage === "backlog" || task.stage === "ready")
	);
}

/**
 * An action for each of the card's blockers, shown done at once and undone,
 * with the refusal said, if the server refuses it.
 */
function useActs() {
	const { refusal, attempt } = useRefusal();
	// What the person did that the board has yet to show, by blocker key.
	const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
	const act = async (key: string, write: () => Promise<void>) => {
		setShown((was) => new Set(was).add(key));
		const ok = await attempt(write(), "Not done");
		if (!ok) {
			setShown((was) => {
				const left = new Set(was);
				left.delete(key);
				return left;
			});
		}
	};
	return { refusal, attempt, shown, act };
}

/** Queues blocker `id`, unless `queuedAlready`, then `task` to run after it. */
function queueingAfter(task: TaskRecord) {
	return (id: number, queuedAlready: boolean) => async () => {
		if (!queuedAlready) {
			await queueTodo(id, true);
		}
		await queueTodo(task.id, true);
	};
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
	act,
	queueAfter,
}: {
	blocker: Extract<DeferralBlocker, { kind: "task" }>;
	done: boolean;
	act: (write: () => Promise<void>) => void;
	queueAfter: (id: number, queued: boolean) => () => Promise<void>;
}): JSX.Element {
	const board = useContext(Board);
	const status = blocker.status;
	const open = status === "backlog" || status === "ready";
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
			{!done && (open || status === "queued") && (
				<Button
					size="sm"
					variant="outline"
					onClick={() => act(queueAfter(blocker.id, status === "queued"))}
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
	queued,
	queue,
}: {
	task: TaskRecord;
	left: number;
	/** False for an old deferral that names nothing it waits on yet. */
	named?: boolean;
	/** Whether the person queued it, before the board shows it. */
	queued: boolean;
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
	if (task.stage === "queued" || queued) {
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
				<Button size="sm" variant="outline" onClick={queue}>
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
