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
import { type Progress as Counted, progress } from "../progress";
import type { Details } from "../show";
import { retryTask } from "./api";
import { ReviewChanges } from "./changes";
import { OnIt, StartMenu } from "./dispatching";
import { Markdown } from "./markdown";

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
				<ul className="flex flex-col">
					{tasks.map((task) => (
						<li key={task.task}>
							<button
								type="button"
								onClick={() => setOpened(task.task)}
								className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
							>
								<span className="min-w-0 flex-1 truncate text-sm">
									{task.task}
								</span>
								{/* Only marks, since the row is a button: its dialog opens them. */}
								<OnIt task={task.task} variant="marks" />
								<Status task={task} />
								<PlanProgress plan={task.plan} />
							</button>
						</li>
					))}
				</ul>
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

/** One task, all of it, in a dialog over the task list or a todo that names it. */
export function Task({ task }: { task: Details }): JSX.Element {
	const review = useContext(ReviewChanges);
	const fields: [string, ReactNode][] = [
		["status", task.status],
		["branch", task.branch],
		["base", task.base],
		["worktree", task.worktree],
		["commits", String(task.ahead ?? "?")],
		["merges", `${task.mergeAttempts} of ${task.mergeAttemptLimit} tried`],

		[
			"diff",
			task.added === null ? (
				"?"
			) : (
				<span key="diff" className="tabular-nums">
					<span className="text-success">+{task.added}</span>{" "}
					<span className="text-destructive">-{task.removed ?? 0}</span>
				</span>
			),
		],
		["age", task.age ?? "?"],
	];
	return (
		<DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
			<DialogHeader>
				<DialogTitle>{task.task}</DialogTitle>
				<DialogDescription>
					{task.review === null
						? (task.escalation ?? task.status)
						: `Ready to merge: ${task.review}`}
				</DialogDescription>
			</DialogHeader>
			<div className="flex min-w-0 flex-col gap-6 text-sm">
				<dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
					{fields.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="text-muted-foreground">{name}</dt>
							<dd className="truncate">{value}</dd>
						</div>
					))}
				</dl>
				<Retry task={task} />
				<Conversations task={task.task} />
				{review !== null && task.ahead !== null && (
					<DialogClose
						render={
							<Button
								variant="outline"
								size="sm"
								className="self-start"
								onClick={() => review(task.task)}
							/>
						}
					>
						<FileDiffIcon />
						Review changes
					</DialogClose>
				)}
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
 * Every conversation on the task, newest first, each opening on a click, and
 * a way to put another agent on it, in its tree.
 */
function Conversations({ task }: { task: string }): JSX.Element {
	return (
		<div className="flex flex-col gap-1">
			<OnIt task={task} variant="rows" className="-mx-2" />
			<StartMenu
				assignment={{ kind: "task", task }}
				label="Start a conversation"
				className="self-start"
			/>
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
