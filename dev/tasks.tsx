import { GitBranchIcon } from "lucide-react";
import { type CSSProperties, type JSX, type ReactNode, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import { questions } from "../plan";
import type { Details } from "../show";
import { OnIt } from "./dispatching";
import { HEADING, Markdown } from "./markdown";
import { isPartOf, type Nested, nest } from "./parts";
import { PHONE_NAME, PHONE_ROW, PHONE_TILE, PHONE_TITLED } from "./phone-rows";
import { QuestionCards } from "./question-cards";
import { ActionBar, useRetry } from "./task-actions";

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
			<header className={PHONE_TITLED}>
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
 * under it, indented. On a phone, a row is the inbox's, its name led by a
 * tile; where it stands still waits behind a tap.
 */
function TaskRows({
	label,
	rows,
	onOpen,
	depth = 0,
}: {
	label: string;
	rows: Nested<Details>[];
	onOpen: (task: string) => void;
	/** How many tasks it is a part of; 0 for one on its base. */
	depth?: number;
}): JSX.Element {
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col",
				// A phone indents each row instead, so it still spans the screen.
				depth > 0 &&
					"ml-2 border-foreground/10 border-l pl-3 max-md:ml-0 max-md:border-l-0 max-md:pl-0",
			)}
		>
			{rows.map(({ row: task, parts }) => (
				<li key={task.task}>
					<button
						type="button"
						onClick={() => onOpen(task.task)}
						style={{ "--depth": depth } as CSSProperties}
						className={cn(
							"-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
							PHONE_ROW,
							"max-md:pl-[calc(1rem+3.25rem*var(--depth))]",
						)}
					>
						<span aria-hidden className={PHONE_TILE}>
							<GitBranchIcon />
						</span>
						<span className={cn("min-w-0 flex-1 truncate text-sm", PHONE_NAME)}>
							{task.task}
						</span>
						{/* Only marks, since the row is a button: its dialog opens them. */}
						<OnIt task={task.task} variant="marks" />
					</button>
					{parts.length > 0 && (
						<TaskRows
							label={`parts of ${task.task}`}
							rows={parts}
							onOpen={onOpen}
							depth={depth + 1}
						/>
					)}
				</li>
			))}
		</ul>
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
		<DialogContent className={cn(TASK_DIALOG, PHONE_SHEET)}>
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
					retry={retry.action}
					onAnswer={() => setAnswering(true)}
				/>
			</DialogFooter>
		</DialogContent>
	);
}

const TASK_DIALOG =
	"max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl";

/**
 * The dialog on a phone: a sheet up from the bottom edge, within a thumb's
 * reach, its footer clear of the home indicator.
 */
const PHONE_SHEET =
	"max-md:top-auto max-md:bottom-0 max-md:max-h-[90dvh] max-md:max-w-full max-md:-translate-y-0 max-md:rounded-b-none max-md:data-closed:slide-out-to-bottom max-md:data-open:slide-in-from-bottom max-md:data-closed:zoom-out-100 max-md:data-open:zoom-in-100 max-md:[&_[data-slot=dialog-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))]";

/**
 * `- [ ] 2. Why?` with its number escaped, so the item reads as its box and
 * `2. Why?` on one line, not a box above a list that starts at 2.
 */
function inlineNumbers(plan: string): string {
	return plan.replace(/^([ \t]*- \[[ xX]\] [Qq]?\d+)\. /gm, "$1\\. ");
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
