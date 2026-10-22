import { age } from "@stringsync/splates-server/age";
import type {
	FinishedPlan,
	FinishedTask,
} from "@stringsync/splates-server/tasks";
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
import { useFolded } from "./folded";
import { Markdown } from "./markdown";
import { PHONE_NAME, PHONE_ROW, PHONE_TILE } from "./phone-rows";
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
import { TasksCard } from "./tasks-card";

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
		<>
			<TasksCard
				label="finished tasks"
				title="Finished"
				count={listed?.length ?? null}
				open={open}
				onOpenChange={(opening) => fold("shown", !opening)}
			>
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
			</TasksCard>
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
		</>
	);
}

/**
 * The dialog of the newest finished task named `name`, for a tap on a task
 * that has merged or been removed since something mentioned it.
 */
export function FinishedByName({ name }: { name: string }): JSX.Element {
	const [key, setKey] = useState<string | null | undefined>(undefined);
	useEffect(() => {
		let current = true;
		finishedTasks().then(
			(read) =>
				current && setKey(read.find((each) => each.task === name)?.key ?? null),
			() => current && setKey(null),
		);
		return () => {
			current = false;
		};
	}, [name]);
	if (typeof key === "string") {
		return <FinishedDialog opened={key} listed={null} />;
	}
	return (
		<DialogContent className={cn(TASK_DIALOG, PHONE_SHEET)}>
			<DialogHeader>
				<DialogTitle>{name}</DialogTitle>
				<DialogDescription>
					{key === undefined ? "Reading…" : "No record of this task is kept."}
				</DialogDescription>
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
	listed,
}: {
	opened: string;
	/** What the list already holds of it, shown while its plan loads. */
	listed: FinishedTask | null;
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
	const task = read ?? listed;
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
					<span className="min-w-0 break-words">{task?.task ?? opened}</span>
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
