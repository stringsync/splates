import { CopyIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Details } from "../show";
import type {
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
import { counted, Scanned, SystemView } from "./system-view";
import { ChipFace, dot } from "./systems";
import { TopBar } from "./top-bar";

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
				onSystem={onOpen}
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

/**
 * A system in the list: its name and aliases, how often it changed, and what
 * it is.
 */
function SystemRow({
	system,
	changes,
	onOpen,
}: {
	system: NamedSystem;
	changes: SystemChanges | null;
	onOpen: () => void;
}): JSX.Element {
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
				{system.description !== undefined && (
					<span className="truncate pl-3.5 text-sm max-md:pl-0">
						{system.description}
					</span>
				)}
			</span>
		</button>
	);
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
