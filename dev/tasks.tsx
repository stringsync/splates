import type { JSX, ReactNode } from "react";
import {
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#dev/components/ui/sheet.tsx";
import type { Details } from "../show";
import { Markdown } from "./markdown";

/**
 * One task, all of it, rising from the bottom over the inbox: its fields,
 * then its whole plan.
 */
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
		<SheetContent
			side="bottom"
			className="mx-auto max-h-[85dvh] max-w-2xl overflow-y-auto rounded-t-xl"
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
