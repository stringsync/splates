import { age } from "@stringsync/splates-server/age";
import type {
	FinishedPlan,
	FinishedTask,
} from "@stringsync/splates-server/tasks";
import {
	ChevronRightIcon,
	CircleCheckIcon,
	CircleSlashIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { ApiError, scoped } from "./api";
import { useFolded } from "./folded";
import { HEADING, Markdown } from "./markdown";
import { PHONE_NAME, PHONE_ROW, PHONE_TILE } from "./phone-rows";

/** Where the Tasks page keeps whether Finished is open. */
const FOLDED = "splates.tasks.finished";

/**
 * The tasks that merged or were removed in this project, under Finished,
 * folded away until opened: read only then, and again whenever `moved`
 * changes while open, as when a task ends. Each opens its plan as it ended.
 */
export function FinishedTasks({ moved }: { moved: string }): JSX.Element {
	// Folded unless this browser opened it: `useFolded` keeps the keys it
	// folds, so here the one key kept is "shown", kept while open.
	const { folded, fold } = useFolded(FOLDED);
	const open = folded.has("shown");
	const [listed, setListed] = useState<FinishedTask[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [opened, setOpened] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `moved` is what says to read the list again
	useEffect(() => {
		if (!open) {
			return;
		}
		let current = true;
		finishedTasks().then(
			(read) => {
				if (current) {
					setListed(read);
					setFailed(false);
				}
			},
			() => current && setFailed(true),
		);
		return () => {
			current = false;
		};
	}, [open, moved]);
	return (
		<Collapsible
			open={open}
			onOpenChange={(opening) => fold("shown", !opening)}
			render={<section aria-label="finished tasks" />}
			className="group/finished mt-2 flex flex-col"
		>
			<CollapsibleTrigger className="-mx-2 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 max-md:min-h-11">
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 transition-transform duration-150 group-data-[open]/finished:rotate-90"
				/>
				Finished
				{listed !== null && (
					<span className="tabular-nums">{listed.length}</span>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				{failed && listed === null ? (
					<p className="py-2 text-muted-foreground text-sm">
						Couldn’t read the finished tasks.
					</p>
				) : listed === null ? null : listed.length === 0 ? (
					<p className="py-2 text-muted-foreground text-sm">
						No task has merged or been removed yet.
					</p>
				) : (
					<ul aria-label="finished task list" className="flex flex-col">
						{listed.map((task) => (
							<li key={task.key}>
								<FinishedRow task={task} onOpen={() => setOpened(task.key)} />
							</li>
						))}
					</ul>
				)}
			</CollapsibleContent>
			<Dialog
				open={opened !== null}
				onOpenChange={(opening) => {
					if (!opening) {
						setOpened(null);
					}
				}}
			>
				{opened !== null && (
					<FinishedDialog
						opened={opened}
						listed={listed?.find((each) => each.key === opened) ?? null}
					/>
				)}
			</Dialog>
		</Collapsible>
	);
}

/** One finished task a line: how it ended, its name, its Goal, and when. */
function FinishedRow({
	task,
	onOpen,
}: {
	task: FinishedTask;
	onOpen: () => void;
}): JSX.Element {
	const Icon = task.ended === "merged" ? CircleCheckIcon : CircleSlashIcon;
	return (
		<button
			type="button"
			onClick={onOpen}
			className={cn(
				"-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
				PHONE_ROW,
			)}
		>
			<span aria-hidden className={PHONE_TILE}>
				<Icon
					className={cn(
						"size-4",
						task.ended === "merged" ? "text-success" : "text-muted-foreground",
					)}
				/>
			</span>
			<span className={cn("flex min-w-0 flex-1 flex-col", PHONE_NAME)}>
				<span className="truncate text-sm">{task.task}</span>
				{task.subject !== task.task && (
					<span className="truncate text-muted-foreground text-xs">
						{task.subject}
					</span>
				)}
			</span>
			<span
				className="shrink-0 text-muted-foreground text-xs tabular-nums"
				title={new Date(task.endedAt).toLocaleString()}
			>
				<span className="sr-only">{endedAs(task)} </span>
				{age(task.endedAt)}
			</span>
		</button>
	);
}

/**
 * One finished task, all of it: the plan it ended on, then how it ended and
 * the queued tasks it took up.
 */
function FinishedDialog({
	opened,
	listed,
}: {
	opened: string;
	/** What the list already holds of it, shown while its plan loads. */
	listed: FinishedTask | null;
}): JSX.Element {
	const [read, setRead] = useState<FinishedPlan | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let current = true;
		finishedTask(opened).then(
			(found) => current && setRead(found),
			() => current && setFailed(true),
		);
		return () => {
			current = false;
		};
	}, [opened]);
	const task = read ?? listed;
	return (
		<DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl">
			<DialogHeader>
				<DialogTitle className="min-w-0 break-words">
					{task?.task ?? opened}
				</DialogTitle>
				<DialogDescription>
					{task === null ? "" : endedAs(task)}
				</DialogDescription>
			</DialogHeader>
			<div className="-mx-4 flex min-w-0 flex-col gap-4 overflow-y-auto px-4 text-sm">
				{failed ? (
					<p className="text-muted-foreground">Couldn’t read this task.</p>
				) : read === null ? null : read.plan === "" ? (
					<p className="text-muted-foreground">It ended with no SPLATES.md.</p>
				) : (
					<Markdown text={read.plan.replace(/^\s*#\s[^\n]*/, "")} />
				)}
				{read !== null && read.took.length > 0 && (
					<section aria-label="queued tasks it took" className="flex flex-col">
						<h2 className={HEADING}>Took</h2>
						<ul className="flex flex-col gap-0.5 text-muted-foreground text-xs">
							{read.took.map((each) => (
								<li key={each.id}>
									#{each.id} {each.subject}
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
		</DialogContent>
	);
}

/** How `task` ended, in words: where it merged, or why it was removed. */
function endedAs(task: FinishedTask): string {
	const when = `${age(task.endedAt)} ago`;
	if (task.ended === "merged") {
		const commit = task.commit === null ? "" : ` as ${task.commit}`;
		return `Merged onto ${task.base}${commit}, ${when}`;
	}
	return `Removed${task.reason === null ? "" : ` as ${task.reason}`}, ${when}`;
}

/** Every task that merged or was removed in this project, newest first. */
async function finishedTasks(): Promise<FinishedTask[]> {
	const response = await fetch(scoped("/api/finished"));
	if (!response.ok) {
		throw new ApiError("error", `finished tasks: ${response.status}`);
	}
	return (await response.json()) as FinishedTask[];
}

/** The finished task kept as `key`, with the SPLATES.md it ended on. */
async function finishedTask(key: string): Promise<FinishedPlan> {
	const response = await fetch(
		scoped(`/api/finished/${encodeURIComponent(key)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `finished task ${key}: ${response.status}`);
	}
	return (await response.json()) as FinishedPlan;
}
