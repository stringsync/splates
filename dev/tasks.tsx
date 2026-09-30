import { GitBranchIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Badge } from "#dev/components/ui/badge.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#dev/components/ui/sheet.tsx";
import { progress } from "../progress";
import type { Details } from "../show";
import { Markdown } from "./markdown";

/** A tree in one of these needs fixing rather than driving. */
const BROKEN = new Set(["orphaned", "stray", "unrecorded", "unknown"]);

/**
 * Every task in a line: its name, how far along its plan is, and a status only
 * when the status is news. The rest (branch, paths, the whole plan) waits
 * behind a tap.
 */
export function Tasks({ tasks }: { tasks: Details[] }): JSX.Element {
	const [opened, setOpened] = useState<Details | null>(null);

	if (tasks.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<GitBranchIcon />
					</EmptyMedia>
					<EmptyTitle>No tasks</EmptyTitle>
					<EmptyDescription>
						<code>arbor add &lt;task&gt;</code> starts one.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
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
			<Sheet
				open={opened !== null}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
					}
				}}
			>
				{opened && <Task task={opened} />}
			</Sheet>
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
		<span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
			{counted.done}/{counted.total}
		</span>
	);
}

/**
 * One task, all of it. Rises from the bottom from the task list; slides in
 * from the right over an open question, so closing it returns to the question.
 */
export function Task({
	task,
	side = "bottom",
}: {
	task: Details;
	side?: "bottom" | "right";
}): JSX.Element {
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
		<SheetContent
			side={side}
			className={
				side === "bottom"
					? "mx-auto max-h-[85dvh] max-w-2xl overflow-y-auto rounded-t-xl"
					: "w-full overflow-y-auto sm:max-w-lg"
			}
		>
			<SheetHeader>
				<SheetTitle>{task.task}</SheetTitle>
				<SheetDescription>{task.escalation ?? task.status}</SheetDescription>
			</SheetHeader>
			<div className="flex flex-col gap-6 px-4 pb-4 text-sm">
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
		</SheetContent>
	);
}
