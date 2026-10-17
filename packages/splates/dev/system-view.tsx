import {
	ChevronLeftIcon,
	CopyIcon,
	ListTodoIcon,
	type LucideIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import type { Details } from "../show";
import type {
	Change,
	Overlap,
	SystemChanges,
	SystemsReport,
} from "../system-changes";
import type { NamedSystem } from "../systems";
import type { TodoState } from "../todo";
import { copiedLabel, useCopy } from "./card";
import { PHONE_HEADING, PHONE_NAME, PHONE_ROW, PHONE_TILE } from "./phone-rows";
import { ChipFace, Globs } from "./systems";
import { TaskIcon } from "./task-icon";
import { BarButton, TITLE, TopBar } from "./top-bar";

/**
 * One system: what it is, its globs, what refers to it, the systems it
 * changes with, and its recent changes.
 */
export function SystemView({
	system,
	changes,
	report,
	tasks,
	todos,
	onBack,
	onSystem,
	onTask,
	onTodo,
}: {
	system: NamedSystem;
	changes: SystemChanges | null;
	report: SystemsReport | null;
	tasks: readonly Details[];
	todos: readonly TodoState[];
	onBack: () => void;
	onSystem: (name: string) => void;
	onTask: (task: string) => void;
	onTodo: (todo: number) => void;
}): JSX.Element {
	const unmatched = changes?.unmatched ?? [];
	return (
		<section
			aria-label={`system ${system.name}`}
			className="flex flex-col gap-6 max-md:gap-7"
		>
			<TopBar
				leading={
					<BarButton label="Back to systems" onClick={onBack}>
						<ChevronLeftIcon />
					</BarButton>
				}
				title={
					<h2
						className={cn(
							TITLE,
							"flex items-center gap-1.5 font-mono max-md:font-sans",
						)}
					>
						<ChipFace name={system.name} />
					</h2>
				}
				detail={
					(system.aliases ?? []).length > 0 && (
						<span className="truncate text-xs">
							also {system.aliases?.join(", ")}
						</span>
					)
				}
			/>
			{system.description !== undefined && (
				<p className="text-sm max-md:text-[15px]">{system.description}</p>
			)}
			<Part title="Made of">
				<Globs system={system} className="max-md:text-[13px]" />
				{changes !== null && (
					<p className="text-muted-foreground text-xs">
						{counted(changes.files, "file")} on trunk
					</p>
				)}
				{unmatched.length > 0 && (
					<p role="alert" className="text-destructive text-xs">
						Matches no file on trunk:{" "}
						<span className="font-mono">{unmatched.join(", ")}</span>
					</p>
				)}
			</Part>
			<Part title="Under way">
				{tasks.length === 0 ? (
					<Quiet>No task under way changes it.</Quiet>
				) : (
					<ul aria-label="tasks in it" className="flex flex-col">
						{tasks.map((task) => (
							<li key={task.task}>
								<Line
									Icon={TaskIcon}
									title={task.task}
									onClick={() => onTask(task.task)}
								/>
							</li>
						))}
					</ul>
				)}
			</Part>
			<Part title="Todos naming it">
				{todos.length === 0 ? (
					<Quiet>No todo names #{system.name}.</Quiet>
				) : (
					<ul aria-label="todos naming it" className="flex flex-col">
						{todos.map((todo) => (
							<li key={todo.id}>
								<Line
									Icon={ListTodoIcon}
									title={todo.subject}
									detail={`#${todo.id}`}
									onClick={() => onTodo(todo.id)}
								/>
							</li>
						))}
					</ul>
				)}
			</Part>
			{changes !== null && changes.changed > 0 && (
				<Part title="Changed with">
					{changes.overlaps.length === 0 ? (
						<Quiet>Its changes touched no other system.</Quiet>
					) : (
						<ul aria-label="systems changed with it" className="flex flex-col">
							{changes.overlaps.map((overlap) => (
								<li key={overlap.name}>
									<OverlapLine
										overlap={overlap}
										onClick={() => onSystem(overlap.name)}
									/>
								</li>
							))}
						</ul>
					)}
				</Part>
			)}
			<Part title="Recent changes">
				{changes === null ? (
					report === null ? null : (
						<Quiet>Trunk does not name it yet.</Quiet>
					)
				) : changes.changes.length === 0 ? (
					<Quiet>No recent commit changed it.</Quiet>
				) : (
					<ul
						aria-label="recent changes"
						className="flex flex-col gap-2 max-md:-mx-4 max-md:gap-0 max-md:divide-y max-md:divide-border/60"
					>
						{changes.changes.map((change) => (
							<li key={change.hash}>
								<ChangeLine change={change} />
							</li>
						))}
					</ul>
				)}
				{changes !== null && changes.changed > changes.changes.length && (
					<p className="text-muted-foreground text-xs">
						The latest {changes.changes.length} of {changes.changed}.
					</p>
				)}
				{report !== null && <Scanned report={report} />}
			</Part>
		</section>
	);
}

/**
 * Another system the open one's changes touched too: its chip, and how many
 * of those changes, which opens it.
 */
function OverlapLine({
	overlap,
	onClick,
}: {
	overlap: Overlap;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
				PHONE_ROW,
			)}
		>
			<span
				className={cn(
					"flex min-w-0 flex-1 items-center gap-1.5 font-mono max-md:font-sans",
					PHONE_NAME,
				)}
			>
				<ChipFace name={overlap.name} />
			</span>
			<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
				{counted(overlap.changed, "change")}
			</span>
		</button>
	);
}

/** A commit: its subject, then its hash, which copies it, its author and age. */
function ChangeLine({ change }: { change: Change }): JSX.Element {
	const { copied, copy } = useCopy();
	const short = change.hash.slice(0, 8);
	return (
		<div className="flex min-w-0 flex-col py-1 text-sm max-md:gap-1 max-md:px-4 max-md:py-3">
			<span className="line-clamp-2 max-md:text-[15px] max-md:leading-snug">
				{change.subject}
			</span>
			<span className="flex items-center gap-1 text-muted-foreground text-xs">
				<button
					type="button"
					aria-label={`copy commit ${short}`}
					title={copied.state === "failed" ? copied.error : "Copy"}
					onClick={() => copy(commitReference(change))}
					className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 font-mono outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:-my-2 max-md:h-8 max-md:active:bg-muted"
				>
					<CopyIcon aria-hidden className="size-3" />
					<span aria-live="polite">{copiedLabel(copied, short)}</span>
				</button>
				· {change.author} · {age(change.at)} ago
			</span>
		</div>
	);
}

/**
 * What copying a commit puts on the clipboard, for a conversation: its short
 * hash and subject, as `git log --oneline` prints it.
 */
function commitReference(change: Change): string {
	return `${change.hash.slice(0, 8)} ${change.subject}`;
}

/** How far back the changes go. */
export function Scanned({
	report,
}: {
	report: SystemsReport;
}): JSX.Element | null {
	if (report.since === null) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs">
			From trunk's last {counted(report.scanned, "commit")}, since{" "}
			{new Date(report.since).toLocaleDateString()}.
		</p>
	);
}

function Part({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<section aria-label={title} className="flex flex-col gap-2 max-md:gap-1">
			<h3 className={cn("font-medium text-xs", PHONE_HEADING)}>{title}</h3>
			{children}
		</section>
	);
}

function Line({
	Icon,
	title,
	detail,
	onClick,
}: {
	Icon: LucideIcon;
	title: string;
	detail?: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
				PHONE_ROW,
				"max-md:min-h-14",
			)}
		>
			<Icon className="size-3.5 shrink-0 text-muted-foreground max-md:hidden" />
			<span aria-hidden className={cn(PHONE_TILE, "size-9 [&_svg]:size-4")}>
				<Icon />
			</span>
			<span className={cn("min-w-0 flex-1 truncate", PHONE_NAME)}>{title}</span>
			{detail !== undefined && (
				<span className="shrink-0 text-muted-foreground text-xs">{detail}</span>
			)}
		</button>
	);
}

function Quiet({ children }: { children: ReactNode }): JSX.Element {
	return <p className="text-muted-foreground text-sm">{children}</p>;
}

export function counted(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
