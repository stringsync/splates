import {
	CheckIcon,
	FileDiffIcon,
	MessageCircleQuestionIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import { type Question, questions } from "../plan";
import type { Details } from "../show";
import { removeTask, retryTask } from "./api";
import { ReviewChanges } from "./changes";
import { Dispatching, OnIt, StartMenu } from "./dispatching";
import { HEADING, Markdown } from "./markdown";
import { isPartOf, type Nested, nest } from "./parts";
import { QuestionCards } from "./question-cards";
import { Refusal, useRefusal } from "./refusal";
import { arriveAt, TASK } from "./task-view";

/**
 * Every task in a line: its name and the marks of the conversations on it.
 * Where the task stands in arbor (its status, its plan) waits behind a tap.
 */
export function Tasks({
	tasks,
	open,
	onOpen,
}: {
	tasks: Details[];
	/** The task whose dialog is open, by name, so it follows the task as the page reads it again. */
	open: string | null;
	onOpen: (task: string | null) => void;
}): JSX.Element {
	const opened = tasks.find((task) => task.task === open) ?? null;

	return (
		<section aria-label="tasks" className="flex flex-col gap-2">
			<header>
				<h2 className="font-medium text-sm">Tasks</h2>
			</header>
			{/* One line, not a big empty state: the todos below it are the page then. */}
			{tasks.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No tasks: <code>arbor add &lt;task&gt;</code> starts one.
				</p>
			) : (
				<TaskRows
					label="task list"
					rows={nest(tasks, (host, part) => isPartOf(part.base, host.task))}
					onOpen={onOpen}
				/>
			)}
			<Dialog
				open={opened !== null}
				onOpenChange={(opening) => {
					if (!opening) {
						onOpen(null);
					}
				}}
			>
				{opened && <Task task={opened} />}
			</Dialog>
		</section>
	);
}

/**
 * Tasks a line each, each part handed out from one in a list of its own
 * under it, indented.
 */
function TaskRows({
	label,
	rows,
	onOpen,
	nested = false,
}: {
	label: string;
	rows: Nested<Details>[];
	onOpen: (task: string) => void;
	nested?: boolean;
}): JSX.Element {
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col",
				nested && "ml-2 border-foreground/10 border-l pl-3",
			)}
		>
			{rows.map(({ row: task, parts }) => (
				<li key={task.task}>
					<button
						type="button"
						onClick={() => onOpen(task.task)}
						className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
					>
						<span className="min-w-0 flex-1 truncate text-sm">{task.task}</span>
						{/* Only marks, since the row is a button: its dialog opens them. */}
						<OnIt task={task.task} variant="marks" />
					</button>
					{parts.length > 0 && (
						<TaskRows
							label={`parts of ${task.task}`}
							rows={parts}
							onOpen={onOpen}
							nested
						/>
					)}
				</li>
			))}
		</ul>
	);
}

/** Escalated with its merge attempts spent: what `arbor retry` is for. */
function outOfMerges(task: Details): boolean {
	return (
		task.status === "escalated" &&
		task.review === null &&
		task.mergeAttempts >= task.mergeAttemptLimit
	);
}

/**
 * One task, all of it, in a dialog over the task list or a todo that names
 * it: its plan as its ARBOR.md has it, then what arbor knows of it as one
 * more section, and everything to do with it in the footer.
 */
export function Task({ task }: { task: Details }): JSX.Element {
	const retry = useRetry(task);
	// Answered here only when the page has nowhere else to answer them.
	const [answering, setAnswering] = useState(false);
	const open =
		task.plan === null
			? []
			: questions(task.plan).filter(
					(each) => !each.done && each.reply === null,
				);
	return (
		<DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
			<DialogHeader>
				<DialogTitle>{task.task}</DialogTitle>
			</DialogHeader>
			<div className="-mx-4 flex min-w-0 flex-col gap-4 overflow-y-auto px-4 text-sm">
				{answering && open.length > 0 && (
					<QuestionCards questions={open} copy />
				)}
				{task.plan === null ? (
					<p className="text-muted-foreground">
						No ARBOR.md: whoever picks this up starts from the diff.
					</p>
				) : (
					<Markdown
						text={inlineNumbers(task.plan.replace(/^\s*#\s[^\n]*/, ""))}
					/>
				)}
				{task.planProblems.length > 0 && (
					<ul className="flex flex-col gap-1 text-muted-foreground text-xs">
						{task.planProblems.map((problem) => (
							<li key={problem}>{problem}</li>
						))}
					</ul>
				)}
				<Facts task={task} retry={retry.note} />
			</div>
			<DialogFooter className="sm:justify-between">
				<ActionBar
					task={task}
					open={open}
					retry={retry.button}
					onAnswer={() => setAnswering(true)}
				/>
			</DialogFooter>
		</DialogContent>
	);
}

/**
 * `- [ ] 2. Why?` with its number escaped, so the item reads as its box and
 * `2. Why?` on one line, not a box above a list that starts at 2.
 */
function inlineNumbers(plan: string): string {
	return plan.replace(/^([ \t]*- \[[ xX]\] [Qq]?\d+)\. /gm, "$1\\. ");
}

/**
 * Everything to do with a task, in one row: the conversations on it, or a
 * way to start one; its open questions, when no conversation here asks
 * them; its changes; another round of
 * merges once it is out of them.
 */
function ActionBar({
	task,
	open,
	retry,
	onAnswer,
}: {
	task: Details;
	open: Question[];
	retry: ReactNode;
	/** Answers them in the dialog, when the page runs no conversations. */
	onAnswer: () => void;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const review = useContext(ReviewChanges);
	// An arbor dev agent on the task asks its questions in its conversation,
	// so only an external agent's need answering from here.
	const answer =
		open.length === 0
			? null
			: context === null
				? onAnswer
				: context.dispatch.on(task.task).length > 0
					? null
					: () => {
							const address = `${TASK}${task.task}`;
							arriveAt(address);
							context.open(address);
						};
	const answerLabel = `Answer ${open.length === 1 ? "a question" : `${open.length} questions`}`;
	return (
		<div
			role="toolbar"
			aria-label="actions"
			className="flex w-full flex-wrap items-center justify-between gap-1.5"
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<OnTask task={task.task} />
			</div>
			<div className="flex flex-wrap items-center gap-1.5">
				<Remove task={task} />
				{retry}
				{review !== null && (task.ahead ?? 0) > 0 && (
					<DialogClose
						render={
							<Button
								size="sm"
								variant="outline"
								onClick={() => review(task.task)}
							/>
						}
					>
						<FileDiffIcon />
						Review changes
					</DialogClose>
				)}
				{answer !== null &&
					(context === null ? (
						<Button size="sm" onClick={answer}>
							<MessageCircleQuestionIcon />
							{answerLabel}
						</Button>
					) : (
						<DialogClose render={<Button size="sm" onClick={answer} />}>
							<MessageCircleQuestionIcon />
							{answerLabel}
						</DialogClose>
					))}
			</div>
		</div>
	);
}

/**
 * Removes the task as `arbor remove` does, asking first while an agent works
 * on it (a conversation here mid-turn, which stops and carries on in the main
 * tree, or an external agent holding its lease, which the page cannot stop) or
 * while it has commits its base lacks, which go with its branch.
 */
function Remove({ task }: { task: Details }): JSX.Element {
	const context = useContext(Dispatching);
	const [asking, setAsking] = useState(false);
	const [removing, setRemoving] = useState(false);
	const { refusal, refuse } = useRefusal();
	const working = (context?.dispatch.on(task.task) ?? []).filter(
		({ conversation }) =>
			conversation?.status === "starting" || conversation?.status === "running",
	).length;
	const external = task.lease === "held";
	const ahead = task.ahead ?? 0;
	const go = () => {
		setAsking(false);
		setRemoving(true);
		removeTask(task.task).catch((error: unknown) => {
			setRemoving(false);
			refuse("Not removed", error);
		});
	};
	return (
		<>
			<Button
				size="sm"
				variant="outline"
				disabled={removing}
				onClick={() =>
					working > 0 || external || ahead > 0 ? setAsking(true) : go()
				}
			>
				<Trash2Icon />
				{removing ? "Removing…" : "Remove"}
			</Button>
			<Refusal refusal={refusal} className="w-full" />
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Remove {task.task}?</DialogTitle>
						<DialogDescription>
							{working > 0
								? `${working === 1 ? "An agent is" : `${working} agents are`} still working on it. Removing stops ${working === 1 ? "it" : "them"} and moves ${working === 1 ? "its conversation" : "their conversations"} to the main tree. `
								: external
									? "An agent outside the page is working on it, which the page cannot stop: its next arbor command finds the task gone. "
									: ""}
							{ahead > 0
								? `Its ${ahead} commit${ahead === 1 ? "" : "s"} not on ${task.base}, its worktree and any uncommitted changes are discarded.`
								: "Its worktree, branch and uncommitted changes are discarded."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Cancel
						</DialogClose>
						<Button variant="destructive" onClick={go}>
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * The conversations on the task, each opening on a click, or, when it has
 * none, a way to put an agent on it: one or the other, never both.
 */
function OnTask({ task }: { task: string }): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	if (context.dispatch.on(task).some((row) => row.conversation !== null)) {
		return <OnIt task={task} variant="chips" />;
	}
	return (
		<StartMenu
			assignment={{ kind: "task", task }}
			label="Start a conversation"
			size="sm"
		/>
	);
}

/**
 * What arbor knows of a task that its ARBOR.md does not say, as one more of
 * its sections: where it stands, its branch and how much it holds, and its
 * tree. The merges tried show only once there are some.
 */
function Facts({
	task,
	retry,
}: {
	task: Details;
	/** What Retry in the footer gives, or gave, once it is out of merges. */
	retry: ReactNode;
}): JSX.Element {
	const facts: [string, ReactNode][] = [
		["branch", `${task.branch} → ${task.base}`],
		["commits", `${task.ahead ?? "?"} commit${task.ahead === 1 ? "" : "s"}`],
	];
	if (task.added !== null) {
		facts.push([
			"diff",
			<>
				<span className="text-success">+{task.added}</span>{" "}
				<span className="text-destructive">-{task.removed ?? 0}</span>
			</>,
		]);
	}
	if (task.mergeAttempts > 0) {
		facts.push([
			"merges",
			`${task.mergeAttempts} of ${task.mergeAttemptLimit} merges tried`,
		]);
	}
	if (task.age !== null) {
		facts.push(["age", `started ${task.age} ago`]);
	}
	return (
		<section aria-label="about the task" className="flex min-w-0 flex-col">
			<h2 className={HEADING}>Task</h2>
			<DialogDescription className="text-foreground">
				{task.review === null
					? (task.escalation ?? task.status)
					: `Ready to merge: ${task.review}`}
			</DialogDescription>
			<div className="mt-1 flex min-w-0 flex-col gap-0.5 text-muted-foreground text-xs tabular-nums">
				<p className="flex min-w-0 flex-wrap gap-x-1">
					{facts.map(([name, fact], i) => (
						<span key={name} className="min-w-0 truncate">
							{i > 0 && (
								<span aria-hidden className="mr-1">
									·
								</span>
							)}
							{fact}
						</span>
					))}
				</p>
				<p className="truncate" title={task.worktree}>
					{task.worktree}
				</p>
			</div>
			{retry}
		</section>
	);
}

/**
 * Another round of merge attempts for a task out of them, as `arbor retry`
 * gives: its button for the action bar, and the line under the bar on what
 * it gives, or once granted, that the task is working again and what picks
 * it up. Nothing while the task has merges left.
 */
function useRetry(task: Details): { button: ReactNode; note: ReactNode } {
	const [state, setState] = useState<"idle" | "retrying" | "retried">("idle");
	const [failed, setFailed] = useState<string | null>(null);
	if (state === "idle" && !outOfMerges(task)) {
		return { button: null, note: null };
	}
	const retry = () => {
		setState("retrying");
		setFailed(null);
		retryTask(task.task).then(
			() => setState("retried"),
			(error: unknown) => {
				setState("idle");
				setFailed(error instanceof Error ? error.message : String(error));
			},
		);
	};
	return {
		button: (
			<Button
				variant="outline"
				size="sm"
				disabled={state !== "idle"}
				onClick={retry}
			>
				{state === "retried" ? <CheckIcon /> : <RotateCcwIcon />}
				{state === "retried" ? "Retried" : "Retry"}
			</Button>
		),
		note: (
			<div className="mt-1 flex flex-col gap-1 text-xs">
				<p className="text-muted-foreground">
					{state === "retried" ? (
						<>
							Working again: <code>arbor claim {task.task}</code> picks it up.
						</>
					) : (
						<>
							Retry gives another {task.mergeAttemptLimit} merge attempts, as{" "}
							<code>arbor retry</code> does.
						</>
					)}
				</p>
				{failed !== null && <p className="text-destructive">{failed}</p>}
			</div>
		),
	};
}
