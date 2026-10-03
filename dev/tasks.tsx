import { type JSX, type ReactNode, useState } from "react";
import { Badge } from "#dev/components/ui/badge.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { Progress as Bar } from "#dev/components/ui/progress.tsx";
import { progress } from "../progress";
import type { Details } from "../show";
import { Markdown } from "./markdown";

/** A tree in one of these needs fixing rather than driving. */
const BROKEN = new Set(["orphaned", "stray", "unrecorded", "unknown"]);

/**
 * Every task in a line: its name, a bar for how far along its plan is, and a status only
 * when the status is news. The rest (branch, paths, the whole plan) waits
 * behind a tap.
 */
export function Tasks({ tasks }: { tasks: Details[] }): JSX.Element {
	const [opened, setOpened] = useState<Details | null>(null);

	// One line, not a big empty state: the todos below it are the page then.
	if (tasks.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No tasks: <code>arbor add &lt;task&gt;</code> starts one.
			</p>
		);
	}

	return (
		<>
			<ul className="flex flex-col">
				{tasks.map((task) => (
					<li key={task.task}>
						<button
							type="button"
							onClick={() => setOpened(task)}
							className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
						>
							<span className="min-w-0 flex-1 truncate text-sm">
								{task.task}
							</span>
							<Status status={task.status} />
							<Progress plan={task.plan} />
						</button>
					</li>
				))}
			</ul>
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
		</>
	);
}

/** Working and merging are the normal case, so they say nothing. */
function Status({ status }: { status: string }): JSX.Element | null {
	if (status === "escalated") {
		return <Badge variant="secondary">escalated</Badge>;
	}
	if (BROKEN.has(status)) {
		return <Badge variant="destructive">{status}</Badge>;
	}
	return null;
}

function Progress({ plan }: { plan: string | null }): JSX.Element | null {
	const counted = plan === null ? null : progress(plan);
	if (counted === null) {
		return null;
	}
	return (
		<span className="flex w-28 shrink-0 items-center gap-2">
			<Bar
				value={counted.done}
				max={counted.total}
				aria-label="progress"
				className="flex-1"
			/>
			<span className="w-8 text-right text-muted-foreground text-xs tabular-nums">
				{counted.done}/{counted.total}
			</span>
		</span>
	);
}

/** One task, all of it, in a dialog over the task list or a todo that names it. */
export function Task({ task }: { task: Details }): JSX.Element {
	const fields: [string, ReactNode][] = [
		["status", task.status],
		["branch", task.branch],
		["base", task.base],
		["worktree", task.worktree],
		["lease", task.lease],
		["commits", String(task.ahead ?? "?")],

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
				<DialogDescription>{task.escalation ?? task.status}</DialogDescription>
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
