import { CopyIcon, GitBranchIcon, ListTodoIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { age } from "../age";
import type { Details } from "../show";
import type { Change, SystemChanges, SystemsReport } from "../system-changes";
import type { NamedSystem } from "../systems";
import type { TodoState } from "../todo";
import { systemChanges } from "./api";
import { Back } from "./back";
import { copiedLabel, useCopy } from "./card";
import { systemsIn } from "./mentioned";
import { ChipFace, Globs } from "./systems";

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
			<header>
				<h2 className="font-medium text-sm">Systems</h2>
			</header>
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
			{report !== null && <Scanned report={report} />}
		</section>
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
			className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-muted"
		>
			<span className="flex min-w-0 items-center gap-2 text-sm">
				<span className="flex min-w-0 items-center gap-1.5 font-mono">
					<ChipFace name={system.name} />
				</span>
				{(system.aliases ?? []).length > 0 && (
					<span className="truncate text-muted-foreground text-xs">
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
				<span className="flex min-w-0 gap-2 pl-3.5 text-muted-foreground text-xs">
					<span className="min-w-0 flex-1 truncate">{latest.subject}</span>
					<span className="shrink-0 tabular-nums">{age(latest.at)}</span>
				</span>
			)}
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
			className="flex flex-col gap-6"
		>
			<header className="-ml-2 flex items-center gap-1">
				<Back label="Back to systems" onBack={onBack} />
				<h2 className="flex min-w-0 items-center gap-1.5 font-medium font-mono text-sm">
					<ChipFace name={system.name} />
				</h2>
				{(system.aliases ?? []).length > 0 && (
					<span className="ml-1 truncate text-muted-foreground text-xs">
						also {system.aliases?.join(", ")}
					</span>
				)}
			</header>
			<Part title="Made of">
				<Globs system={system} className="" />
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
									Icon={GitBranchIcon}
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
					<ul aria-label="recent changes" className="flex flex-col gap-2">
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
		<div className="flex min-w-0 flex-col py-1 text-sm">
			<span className="line-clamp-2">{change.subject}</span>
			<span className="flex items-center gap-1 text-muted-foreground text-xs">
				<button
					type="button"
					aria-label={`copy commit ${short}`}
					title={copied.state === "failed" ? copied.error : "Copy"}
					onClick={() => copy(commitReference(change))}
					className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 font-mono outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
		<section aria-label={title} className="flex flex-col gap-2">
			<h3 className="font-medium text-xs">{title}</h3>
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
	Icon: typeof GitBranchIcon;
	title: string;
	detail?: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
		>
			<Icon className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">{title}</span>
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
