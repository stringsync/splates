import {
	ChevronLeftIcon,
	CopyIcon,
	ListTodoIcon,
	type LucideIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import type { Details } from "../show";
import type {
	Change,
	SystemChanges,
	SystemsReport,
	Uncovered,
} from "../system-changes";
import type { NamedSystem } from "../systems";
import type { TodoState } from "../todo";
import { systemChanges } from "./api";
import { copiedLabel, useCopy } from "./card";
import { systemsIn } from "./mentioned";
import { PHONE_HEADING, PHONE_NAME, PHONE_ROW, PHONE_TILE } from "./phone-rows";
import { ChipFace, dot, Globs } from "./systems";
import { TaskIcon } from "./task-icon";
import { BarButton, TITLE, TopBar } from "./top-bar";

/** How many globs of uncovered files the list shows. */
const UNCOVERED_SHOWN = 8;

/**
 * Every system `arbor.systems.ts` names, a line each with how it moved
 * lately, or the one `open` names: what it is made of, what refers to it,
 * and the commits that changed it on trunk.
 */
export function SystemsPage({
	systems,
	tasks,
	todos,
	open,
	onOpen,
	onTask,
	onTodo,
}: {
	/** The systems the main tree names. */
	systems: readonly NamedSystem[];
	tasks: readonly Details[];
	todos: readonly TodoState[];
	/** The system open, by name, or null for the list. */
	open: string | null;
	onOpen: (name: string | null) => void;
	onTask: (task: string) => void;
	onTodo: (todo: number) => void;
}): JSX.Element {
	const report = useSystemsReport(tasks);
	const changes = (name: string) =>
		report?.systems.find((each) => each.name === name) ?? null;
	const opened = systems.find((system) => system.name === open) ?? null;

	if (opened !== null) {
		return (
			<SystemView
				system={opened}
				changes={changes(opened.name)}
				report={report}
				tasks={tasks.filter((task) =>
					task.systems.some((each) => each.name === opened.name),
				)}
				todos={todos.filter((todo) =>
					systemsIn(`${todo.subject}\n${todo.text}`, systems).includes(
						opened.name,
					),
				)}
				onBack={() => onOpen(null)}
				onTask={onTask}
				onTodo={onTodo}
			/>
		);
	}
	return (
		<section aria-label="systems" className="flex flex-col gap-2">
			<TopBar title="Systems" />
			{systems.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No systems: name parts of the code in <code>arbor.systems.ts</code>,
					as the arbor skill's Systems section says.
				</p>
			) : (
				<ul aria-label="system list" className="flex flex-col">
					{systems.map((system) => (
						<li key={system.name}>
							<SystemRow
								system={system}
								changes={changes(system.name)}
								onOpen={() => onOpen(system.name)}
							/>
						</li>
					))}
				</ul>
			)}
			{report !== null && report.groups.length > 0 && (
				<UncoveredList report={report} />
			)}
			{report !== null && <Scanned report={report} />}
		</section>
	);
}

/**
 * The files no system covers, as globs, those changed most lately first:
 * what is worth naming next. Each glob copies, for `arbor.systems.ts` or a
 * conversation.
 */
function UncoveredList({ report }: { report: SystemsReport }): JSX.Element {
	const shown = report.groups.slice(0, UNCOVERED_SHOWN);
	const more = report.groups.length - shown.length;
	return (
		<section
			aria-label="In no system"
			className="flex flex-col gap-2 pt-4 max-md:gap-1 max-md:pt-6"
		>
			<h3 className={cn("font-medium text-xs", PHONE_HEADING)}>
				In no system{" "}
				<span className="font-normal text-muted-foreground max-md:normal-case max-md:tracking-normal">
					{counted(report.uncovered, "file")}
				</span>
			</h3>
			<ul aria-label="uncovered globs" className="flex flex-col">
				{shown.map((group) => (
					<li key={group.glob}>
						<UncoveredLine group={group} />
					</li>
				))}
			</ul>
			{more > 0 && (
				<p className="text-muted-foreground text-xs">
					And {counted(more, "more glob")}.
				</p>
			)}
		</section>
	);
}

function UncoveredLine({ group }: { group: Uncovered }): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			aria-label={`copy ${group.glob}`}
			title={copied.state === "failed" ? copied.error : "Copy"}
			onClick={() => copy(group.glob)}
			className={cn(
				"-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
				PHONE_ROW,
				// Its counts go under it, so a long glob keeps the width.
				"max-md:min-h-14 max-md:flex-col max-md:items-start max-md:justify-center max-md:gap-0.5",
			)}
		>
			<span className="flex w-full min-w-0 items-center gap-2 max-md:gap-3">
				<CopyIcon
					aria-hidden
					className="size-3 shrink-0 text-muted-foreground max-md:size-4"
				/>
				<span
					aria-live="polite"
					className="min-w-0 flex-1 truncate font-mono text-xs max-md:text-[13px]"
				>
					{copiedLabel(copied, group.glob)}
				</span>
			</span>
			<span className="shrink-0 text-muted-foreground text-xs tabular-nums max-md:pl-7">
				{counted(group.files, "file")} · {counted(group.changed, "change")}
			</span>
		</button>
	);
}

/** A system in the list: its name and aliases, then its latest change. */
function SystemRow({
	system,
	changes,
	onOpen,
}: {
	system: NamedSystem;
	changes: SystemChanges | null;
	onOpen: () => void;
}): JSX.Element {
	const latest = changes?.changes[0];
	return (
		<button
			type="button"
			onClick={onOpen}
			className={cn(
				"-mx-2 flex w-[calc(100%+1rem)] items-center rounded-lg px-2 py-2 text-left hover:bg-muted",
				PHONE_ROW,
			)}
		>
			{/* On a phone, its color leads the row as the inbox's tiles do. */}
			<span aria-hidden className={PHONE_TILE}>
				<span
					className="size-3 rounded-full"
					style={{ backgroundColor: dot(system.name) }}
				/>
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-center gap-2 text-sm">
					<span
						className={cn(
							"flex min-w-0 items-center gap-1.5 font-mono max-md:font-sans max-md:[&>span:first-child]:hidden",
							PHONE_NAME,
						)}
					>
						<ChipFace name={system.name} />
					</span>
					{(system.aliases ?? []).length > 0 && (
						<span className="truncate text-muted-foreground text-xs max-md:hidden">
							also {system.aliases?.join(", ")}
						</span>
					)}
					{changes !== null && (
						<span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums">
							{counted(changes.changed, "change")}
						</span>
					)}
				</span>
				{latest !== undefined && (
					<span className="flex min-w-0 items-baseline gap-2 pl-3.5 text-muted-foreground text-xs max-md:pl-0 max-md:text-sm">
						<span className="min-w-0 flex-1 truncate">{latest.subject}</span>
						<span className="shrink-0 text-xs tabular-nums">
							{age(latest.at)}
						</span>
					</span>
				)}
			</span>
		</button>
	);
}

/** One system: its globs, what refers to it, and its recent changes. */
function SystemView({
	system,
	changes,
	report,
	tasks,
	todos,
	onBack,
	onTask,
	onTodo,
}: {
	system: NamedSystem;
	changes: SystemChanges | null;
	report: SystemsReport | null;
	tasks: readonly Details[];
	todos: readonly TodoState[];
	onBack: () => void;
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
function Scanned({ report }: { report: SystemsReport }): JSX.Element | null {
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

function counted(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What `/api/systems/changes` says, null until it comes; asked again
 * whenever the tasks move, since one merging moves trunk.
 */
function useSystemsReport(tasks: readonly Details[]): SystemsReport | null {
	const [report, setReport] = useState<SystemsReport | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tasks` only says when to ask again.
	useEffect(() => {
		let current = true;
		systemChanges().then(
			(found) => current && setReport(found),
			() => {},
		);
		return () => {
			current = false;
		};
	}, [tasks]);
	return report;
}
