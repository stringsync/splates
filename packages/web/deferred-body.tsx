import {
	cleared,
	cycle,
	type DeferralBlocker,
	deferralBlockers,
	type ElsewhereOnBoard,
	type TaskBlockerStatus,
	type TaskRecord,
} from "@stringsync/splates-server/board/browser";
import { taskNumberReference } from "@stringsync/splates-server/plans/browser";
import { CheckIcon, CircleIcon, LinkIcon, PlayIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { answerDeferral, linkTodo, queueTodo } from "./api";
import { Board } from "./board";
import { linked } from "./board-expectations";
import { useCardReply } from "./card-reply";
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
 * task: why it stopped, what it waits on and where each stands, an answer
 * box for each open question, and Resume, which sends the task back to the
 * conversation that deferred it, for its agent to check what it waits on and
 * carry on or defer again. Each action shows at once and is undone, with the
 * refusal said, if the server refuses it.
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
	const { refusal, pending, act } = useActs();
	const [answers, setAnswers] = useState<Record<number, string>>({});
	const send = useCardReply().reply?.send ?? null;
	if (deferred === undefined) {
		return null;
	}
	// Told to the agent that deferred it, as anything typed here would wake
	// it; where nothing can be sent, the queue gives it to a new one.
	const resume = () =>
		send === null
			? queueTodo(task.id, true)
			: send(taskNumberReference(task.id));
	const queued = task.stage === "queued" && task.takenBy === null;
	const open = blockers.filter((each) => !cleared(each));
	// The server resumes it once every task it waits on has merged.
	const alone =
		deferred.conversation !== undefined &&
		deferred.questions.length === 0 &&
		deferred.outside.length === 0 &&
		open.length > 0;
	let questionIndex = -1;
	return (
		<div className="flex flex-col gap-3 px-4 py-3.5 text-sm @max-md:px-3 @max-md:py-2.5">
			<section aria-label="why it stopped">
				<h4 className={HEADING}>Why it stopped</h4>
				<p className="leading-relaxed">{deferred.why}</p>
			</section>
			{blockers.length > 0 && (
				<section aria-label="waits on">
					<h4 className={HEADING}>Waits on</h4>
					<ol className="flex flex-col gap-2">
						{blockers.map((blocker, i) => {
							const key = `${blocker.kind}:${i}`;
							const done = cleared(blocker);
							let index = 0;
							if (blocker.kind === "question") {
								questionIndex += 1;
								index = questionIndex;
							}
							return (
								<li key={key} className="flex items-start gap-2">
									<Mark done={done} />
									<div className="flex min-w-0 flex-1 flex-col gap-1.5">
										{blocker.kind === "task" && (
											<TaskBlocker blocker={blocker} done={done} />
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
															void act(key, () =>
																answerDeferral(task.id, index, answer),
															);
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
															disabled={
																(answers[i] ?? "").trim() === "" ||
																pending.has(key)
															}
														>
															Answer
														</Button>
													</form>
												)}
											</>
										)}
										{blocker.kind === "outside" && (
											<span className={cn(done && "text-muted-foreground")}>
												{blocker.what}
											</span>
										)}
									</div>
								</li>
							);
						})}
					</ol>
				</section>
			)}
			{task.takenBy === null && (
				<p className="flex flex-wrap items-center justify-end gap-2 text-xs">
					{alone && !queued && (
						<span className="mr-auto text-muted-foreground">
							Resumes on its own once{" "}
							{open
								.map((each) => (each.kind === "task" ? `#${each.id}` : ""))
								.join(", ")}{" "}
							merges
						</span>
					)}
					{queued && (
						<span className="mr-auto text-muted-foreground">
							Queued
							{task.blockedBy.length > 0 &&
								` · waits on ${task.blockedBy.map((id) => `#${id}`).join(", ")}`}
						</span>
					)}
					<Button
						type="button"
						size="sm"
						disabled={pending.has("resume")}
						onClick={() => void act("resume", resume)}
					>
						<PlayIcon data-icon="inline-start" />
						Resume
					</Button>
				</p>
			)}
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
	const { refusal, attempt, pending, act } = useActs();
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
	return (
		task.takenBy === null &&
		(task.stage === "backlog" || task.stage === "ready")
	);
}

/**
 * An action for each of the card's blockers, pending by key until the write
 * resolves; the card says it done only once the board shows it. A refusal
 * clears pending and is said.
 */
function useActs() {
	const { refusal, attempt } = useRefusal();
	// The keys whose write is on its way.
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const act = async (key: string, write: () => Promise<void>) => {
		setPending((was) => new Set(was).add(key));
		await attempt(write(), "Not done");
		setPending((was) => {
			const left = new Set(was);
			left.delete(key);
			return left;
		});
	};
	return { refusal, attempt, pending, act };
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
