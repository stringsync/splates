import { CheckIcon, FileDiffIcon, RotateCcwIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Badge } from "#dev/components/ui/badge.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Progress as Bar } from "#dev/components/ui/progress.tsx";
import { cn } from "#dev/lib/utils.ts";
import { type Progress as Counted, progress } from "../progress";
import type { Details } from "../show";
import { retryTask } from "./api";
import { ReviewChanges } from "./changes";
import { Dispatching, OnIt, StartMenu } from "./dispatching";
import { Markdown } from "./markdown";
import { type Nested, nest } from "./parts";

/** A tree in one of these needs fixing rather than driving. */
const BROKEN = new Set(["orphaned", "stray", "unrecorded", "unknown"]);

/**
 * Every task in a line: its name, a bar for how far along its plan is, and a status only
 * when the status is news. The rest (branch, paths, the whole plan) waits
 * behind a tap.
 */
export function Tasks({ tasks }: { tasks: Details[] }): JSX.Element {
	// By name, so the dialog follows the task as the page reads it again.
	const [named, setOpened] = useState<string | null>(null);
	const opened = tasks.find((task) => task.task === named) ?? null;

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
					rows={nest(tasks, tasks, (task) => task.task)}
					onOpen={setOpened}
				/>
			)}
			<Dialog
				open={opened !== null}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
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
						<Status task={task} />
						<PlanProgress plan={task.plan} />
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

/** Working and merging are the normal case, so they say nothing. */
function Status({ task }: { task: Details }): JSX.Element | null {
	const { status } = task;
	if (task.review !== null) {
		return <Badge>ready to merge</Badge>;
	}
	if (outOfMerges(task)) {
		return <Badge variant="secondary">out of merges</Badge>;
	}
	if (status === "escalated") {
		return <Badge variant="secondary">escalated</Badge>;
	}
	if (BROKEN.has(status)) {
		return <Badge variant="destructive">{status}</Badge>;
	}
	return null;
}

/** Escalated with its merge attempts spent: what `arbor retry` is for. */
function outOfMerges(task: Details): boolean {
	return (
		task.status === "escalated" &&
		task.review === null &&
		task.mergeAttempts >= task.mergeAttemptLimit
	);
}

function PlanProgress({ plan }: { plan: string | null }): JSX.Element | null {
	const counted = plan === null ? null : progress(plan);
	return counted && <Progress {...counted} />;
}

/** A bar and its count, the end of a task's or a tag's row. */
export function Progress({ done, total }: Counted): JSX.Element {
	return (
		<span className="flex w-28 shrink-0 items-center gap-2">
			<Bar value={done} max={total} aria-label="progress" className="flex-1" />
			<span className="w-8 text-right text-muted-foreground text-xs tabular-nums">
				{done}/{total}
			</span>
		</span>
	);
}

/**
 * One task, all of it, in a dialog over the task list or a todo that names
 * it: who is on it first, then where it stands, then its plan.
 */
export function Task({ task }: { task: Details }): JSX.Element {
	return (
		<DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
			<DialogHeader>
				<DialogTitle>{task.task}</DialogTitle>
			</DialogHeader>
			<div className="flex min-w-0 flex-col gap-6 text-sm">
				<OnTask task={task.task} />
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-0.5">
						<DialogDescription>
							{task.review === null
								? (task.escalation ?? task.status)
								: `Ready to merge: ${task.review}`}
						</DialogDescription>
						<Facts task={task} />
					</div>
					<Retry task={task} />
				</div>
				{task.plan === null ? (
					<p className="text-muted-foreground">
						No ARBOR.md: whoever picks this up starts from the diff.
					</p>
				) : (
					<Markdown text={task.plan.replace(/^\s*#\s[^\n]*/, "")} />
				)}
				{task.planProblems.length > 0 && (
					<ul className="flex flex-col gap-1 text-muted-foreground text-xs">
						{task.planProblems.map((problem) => (
							<li key={problem}>{problem}</li>
						))}
					</ul>
				)}
			</div>
		</DialogContent>
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
		return <OnIt task={task} variant="rows" className="-mx-2" />;
	}
	return (
		<StartMenu
			assignment={{ kind: "task", task }}
			label="Start a conversation"
		/>
	);
}

/**
 * The rest of what arbor knows of a task, in two muted lines rather than a
 * table: its branch onto its base and how much it holds, with its changes a
 * click away, then its tree. The merges tried show only once there are some.
 */
function Facts({ task }: { task: Details }): JSX.Element {
	const review = useContext(ReviewChanges);
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
				{review !== null && task.ahead !== null && (
					<DialogClose
						render={
							<button
								type="button"
								className="ml-1.5 inline-flex items-center gap-1 rounded-sm text-foreground underline-offset-2 hover:underline"
								onClick={() => review(task.task)}
							/>
						}
					>
						<FileDiffIcon className="size-3" />
						Review changes
					</DialogClose>
				)}
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
		<div className="flex min-w-0 flex-col gap-0.5 text-muted-foreground text-xs tabular-nums">
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
	);
}

/**
 * Another round of merge attempts for a task out of them, as `arbor retry`
 * gives. Once granted the task is working again, so the button stays only to
 * say so, and what picks it up.
 */
function Retry({ task }: { task: Details }): JSX.Element | null {
	const [state, setState] = useState<"idle" | "retrying" | "retried">("idle");
	const [failed, setFailed] = useState<string | null>(null);
	if (state === "idle" && !outOfMerges(task)) {
		return null;
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
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-3">
				<Button
					variant="outline"
					size="sm"
					disabled={state !== "idle"}
					onClick={retry}
				>
					{state === "retried" ? <CheckIcon /> : <RotateCcwIcon />}
					{state === "retried" ? "Retried" : "Retry"}
				</Button>
				<span className="text-muted-foreground text-xs">
					{state === "retried" ? (
						<>
							Working again: <code>arbor claim {task.task}</code> picks it up.
						</>
					) : (
						<>
							Another {task.mergeAttemptLimit} merge attempts, as{" "}
							<code>arbor retry</code> gives.
						</>
					)}
				</span>
			</div>
			{failed !== null && <p className="text-destructive text-xs">{failed}</p>}
		</div>
	);
}
