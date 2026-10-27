import {
	cleared,
	type DeferralBlocker,
	deferralBlockers,
	type TaskRecord,
} from "@stringsync/splates-server/board/browser";
import { CheckIcon, CircleIcon } from "lucide-react";
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
): number {
	return deferralBlockers(task, board).filter((each) => !cleared(each)).length;
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
	const blockers = deferralBlockers(task, board.todos);
	const { refusal, attempt } = useRefusal();
	// What the person did that the board has yet to show, by blocker key.
	const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
	const [answers, setAnswers] = useState<Record<number, string>>({});
	if (deferred === undefined) {
		return null;
	}
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
	const queueAfter = (id: number, queuedAlready: boolean) => async () => {
		if (!queuedAlready) {
			await queueTodo(id, true);
		}
		await queueTodo(task.id, true);
	};
	const left = blockers.filter((each) => !cleared(each)).length;
	let questionIndex = -1;
	let outsideIndex = -1;
	return (
		<div className="flex flex-col gap-3 px-4 py-3.5 text-sm @max-md:px-3 @max-md:py-2.5">
			<section aria-label="why it stopped">
				<h4 className="mb-1 font-semibold text-xs text-muted-foreground uppercase tracking-wide">
					Why it stopped
				</h4>
				<p className="leading-relaxed">{deferred.why}</p>
			</section>
			<section aria-label="to unblock">
				<h4 className="mb-1 font-semibold text-xs text-muted-foreground uppercase tracking-wide">
					To unblock
				</h4>
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
								{done ? (
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
								)}
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
														className="pointer-coarse:h-10"
													>
														Answer and queue
													</Button>
												</form>
											)}
										</>
									)}
									{blocker.kind === "outside" && (
										<div className="flex flex-wrap items-center gap-2">
											<span className={cn(done && "text-muted-foreground")}>
												{blocker.what}
											</span>
											{!done && (
												<Button
													size="sm"
													variant="outline"
													className="pointer-coarse:h-10"
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
				<DeferredProgress task={task} left={left} />
			</p>
			{task.stage === "backlog" || task.stage === "ready" ? (
				<p className="flex justify-end gap-3 text-muted-foreground text-xs">
					<button
						type="button"
						className="underline-offset-2 hover:underline pointer-coarse:min-h-10"
						onClick={() =>
							void act("resume", async () => {
								await linkTodo(task.id, []);
								await queueTodo(task.id, true);
							})
						}
					>
						Resume anyway
					</button>
					<button
						type="button"
						className="underline-offset-2 hover:underline pointer-coarse:min-h-10"
						onClick={() => void act("drop", () => removeTodo(task.id))}
					>
						Drop
					</button>
				</p>
			) : null}
			<Refusal refusal={refusal} />
		</div>
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
			<span className="text-muted-foreground text-xs">
				· {TASK_STATUS[status] ?? status}
			</span>
			{!done && (open || status === "queued") && (
				<Button
					size="sm"
					variant="outline"
					className="pointer-coarse:h-10"
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
}: {
	task: TaskRecord;
	left: number;
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
	return left === 0 ? (
		<>Nothing left to wait on: queue it to start.</>
	) : (
		<>Starts on its own once queued and unblocked.</>
	);
}
