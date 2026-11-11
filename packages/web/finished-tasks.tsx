import { age } from "@splates/server/age";
import type { FinishedPlan, FinishedTask } from "@splates/server/tasks";
import {
	BotMessageSquareIcon,
	CircleCheckIcon,
	CircleSlashIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { ApiError, answered, scoped } from "./api";
import { ReadFailed, ReadingNow } from "./countdown";
import { Markdown } from "./markdown";
import { QueueColumn } from "./queue-column";
import { QueueEmpty } from "./queue-rows";
import { ActionButton } from "./task-actions";
import { useDemo } from "./task-demo";
import { TaskIcon } from "./task-icon";
import { Overview } from "./task-overview";
import { planParts } from "./task-plan-parts";
import {
	FactList,
	PHONE_SHEET,
	Section,
	SectionTab,
	SectionTabs,
	TASK_DIALOG,
	TONES,
} from "./task-sections";

/** Shows what finished today, with a button for earlier tasks. Pass a new `moved` to refresh the list. */
export function FinishedTasks({ moved }: { moved: string }): JSX.Element {
	const [listed, setListed] = useState<FinishedTask[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [opened, setOpened] = useState<string | null>(null);
	const [earlier, setEarlier] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `moved` is what says to read the list again
	useEffect(() => {
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
	}, [moved]);
	const today = (listed ?? []).filter((task) => endedToday(task));
	const older = (listed ?? []).length - today.length;
	const shown = earlier ? (listed ?? []) : today;
	return (
		<>
			<QueueColumn
				title="Done"
				why="Permanent column: tasks that ended today. A card arrives when its task is merged or removed."
				count={listed === null ? "" : today.length}
			>
				{failed && listed === null ? (
					<QueueEmpty>Couldn’t read the done tasks.</QueueEmpty>
				) : listed === null ? null : (
					<>
						{shown.length === 0 && <QueueEmpty>Nothing done today</QueueEmpty>}
						{shown.length > 0 && (
							<ul
								aria-label="finished task list"
								className="flex flex-col gap-1.5"
							>
								{shown.map((task) => (
									<li key={task.key}>
										<FinishedRow
											task={task}
											onOpen={() => setOpened(task.key)}
										/>
									</li>
								))}
							</ul>
						)}
						{older > 0 && (
							<Button
								size="xs"
								variant="ghost"
								className="self-start text-muted-foreground"
								onClick={() => setEarlier(!earlier)}
							>
								{earlier ? "Today only" : `Show ${older} earlier`}
							</Button>
						)}
					</>
				)}
			</QueueColumn>
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
						row={listed?.find((each) => each.key === opened) ?? null}
					/>
				)}
			</Dialog>
		</>
	);
}

/** Whether `task` ended on today's date, here. */
function endedToday(task: FinishedTask): boolean {
	return new Date(task.endedAt).toDateString() === new Date().toDateString();
}

/**
 * The dialog of the newest finished task named `name`, for a tap on a task
 * that has merged or been removed since something mentioned it.
 */
export function FinishedByName({ name }: { name: string }): JSX.Element {
	// A key, null once the list holds no such task, undefined while reading.
	const [key, setKey] = useState<string | null | undefined>(undefined);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what says to read again
	useEffect(() => {
		let current = true;
		finishedTasks().then(
			(read) => {
				if (current) {
					setKey(read.find((each) => each.task === name)?.key ?? null);
				}
			},
			() => current && setFailed(true),
		);
		return () => {
			current = false;
		};
	}, [name, attempt]);
	if (typeof key === "string") {
		return <FinishedDialog opened={key} row={null} />;
	}
	return (
		<DialogContent className={cn(TASK_DIALOG, PHONE_SHEET)}>
			<DialogHeader>
				<DialogTitle>{name}</DialogTitle>
				{failed ? (
					<ReadFailed
						error="Couldn't read the finished tasks, so this one may still be kept."
						onRetry={() => {
							setFailed(false);
							setAttempt(attempt + 1);
						}}
					/>
				) : key === undefined ? (
					<ReadingNow label="Reading…" />
				) : (
					<DialogDescription>No record of this task is kept.</DialogDescription>
				)}
			</DialogHeader>
		</DialogContent>
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
			className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card p-2 pl-3 text-left text-card-foreground transition-colors hover:border-border"
		>
			<span aria-hidden className="shrink-0">
				<Icon
					className={cn(
						"size-4",
						task.ended === "merged" ? "text-success" : "text-muted-foreground",
					)}
				/>
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm">{task.task}</span>
				{task.subject !== task.task && (
					<span className="truncate text-muted-foreground text-xs">
						{task.subject}
					</span>
				)}
			</span>
			{task.hasDemo && (
				<BotMessageSquareIcon
					aria-label="has a demo"
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
			)}
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
 * One finished task in the dialog every task opens in: how it ended in the
 * header, the plan it ended on split into tabs as a live task's is, and on
 * Details its facts and the queued tasks it took up.
 */
function FinishedDialog({
	opened,
	row,
}: {
	opened: string;
	/** What the list already holds of it, shown while its plan loads. */
	row: FinishedTask | null;
}): JSX.Element {
	const [read, setRead] = useState<FinishedPlan | null>(null);
	const [failed, setFailed] = useState(false);
	const [tab, setTab] = useState("overview");
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
	const task = read ?? row;
	const plan = useMemo(
		() => (read === null || read.plan === "" ? null : planParts(read.plan)),
		[read],
	);
	const demo = useDemo(read?.task ?? "", plan);
	// Focus lands on the dialog, not its first tab, as a live task's does.
	const dialog = useRef<HTMLDivElement>(null);
	return (
		<DialogContent
			ref={dialog}
			initialFocus={dialog}
			className={cn(TASK_DIALOG, PHONE_SHEET)}
		>
			<DialogHeader className="gap-1.5">
				<DialogTitle className="flex items-center gap-2 pr-8">
					<TaskIcon aria-hidden className="size-4 shrink-0" />
					<span className="min-w-0 break-words">
						{task === null ? opened : task.task}
					</span>
				</DialogTitle>
				<DialogDescription className="flex min-w-0 items-baseline gap-2 text-foreground">
					{task !== null && (
						<>
							<span
								className={cn(
									"shrink-0 rounded-md px-1.5 py-px font-medium text-xs",
									TONES[task.ended === "merged" ? "ready" : "quiet"],
								)}
							>
								{task.ended === "merged" ? "Merged" : "Removed"}
							</span>
							<span className="min-w-0 text-sm">{endedHow(task)}</span>
						</>
					)}
				</DialogDescription>
			</DialogHeader>
			<SectionTabs
				value={tab}
				onValueChange={setTab}
				tabs={
					<>
						<SectionTab value="overview">Overview</SectionTab>
						{plan !== null && plan.notes !== "" && (
							<SectionTab value="notes">Notes</SectionTab>
						)}
						<SectionTab value="details">Details</SectionTab>
					</>
				}
			>
				<Section value="overview">
					{failed ? (
						<p className="text-muted-foreground text-sm">
							Couldn’t read this task.
						</p>
					) : read === null ? null : (
						<Overview
							task={read.task}
							plan={plan}
							none="It ended with no SPLATES.md."
						/>
					)}
				</Section>
				<Section value="notes">
					<Markdown text={plan?.notes ?? ""} />
				</Section>
				<Section value="details">
					{task !== null && <FactList facts={factsOf(read ?? task)} />}
				</Section>
			</SectionTabs>
			{demo !== null && (
				<DialogFooter>
					<div role="toolbar" aria-label="actions" className="flex w-full">
						<ActionButton
							action={demo}
							outline
							className="pointer-coarse:h-10 pointer-coarse:flex-1"
						/>
					</div>
				</DialogFooter>
			)}
		</DialogContent>
	);
}

/** What a finished task's Details list: where and how it ended, and what it took. */
function factsOf(task: FinishedTask): [string, ReactNode][] {
	const facts: [string, ReactNode][] = [
		["Ended", task.ended === "merged" ? "Merged" : "Removed"],
		["Base", task.base],
	];
	if (task.commit !== null) {
		facts.push([
			"Commit",
			<span key="commit" className="select-all">
				{task.commit}
			</span>,
		]);
	}
	if (task.reason !== null) {
		facts.push(["Reason", task.reason]);
	}
	facts.push(["Started", `${age(task.startedAt)} ago`]);
	facts.push(["Finished", `${age(task.endedAt)} ago`]);
	if (task.took.length > 0) {
		facts.push([
			"Took",
			<ul
				key="took"
				aria-label="queued tasks it took"
				className="flex flex-col gap-0.5"
			>
				{task.took.map((each) => (
					<li key={each.id}>
						#{each.id} {each.subject}
					</li>
				))}
			</ul>,
		]);
	}
	return facts;
}

/** How `task` ended, in words: where it merged, or why it was removed. */
function endedAs(task: FinishedTask): string {
	return `${task.ended === "merged" ? "Merged" : "Removed"} ${endedHow(task)}`;
}

/** `endedAs` but its first word, for beside a label that says it. */
function endedHow(task: FinishedTask): string {
	const when = `${age(task.endedAt)} ago`;
	if (task.ended === "merged") {
		const commit = task.commit === null ? "" : ` as ${task.commit}`;
		return `onto ${task.base}${commit}, ${when}`;
	}
	return `${task.reason === null ? "" : `as ${task.reason}, `}${when}`;
}

/** Every task that merged or was removed in this project, newest first. */
async function finishedTasks(): Promise<FinishedTask[]> {
	const response = await answered(scoped("/api/finished"));
	if (!response.ok) {
		throw new ApiError("error", `finished tasks: ${response.status}`);
	}
	return (await response.json()) as FinishedTask[];
}

/** The finished task kept as `key`, with the SPLATES.md it ended on. */
async function finishedTask(key: string): Promise<FinishedPlan> {
	const response = await answered(
		scoped(`/api/finished/${encodeURIComponent(key)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `finished task ${key}: ${response.status}`);
	}
	return (await response.json()) as FinishedPlan;
}
