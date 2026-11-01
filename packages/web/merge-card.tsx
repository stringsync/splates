import type { MergeEstimates } from "@stringsync/splates-server/merge";
import type { Event } from "@stringsync/splates-server/records";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	CheckIcon,
	ChevronsUpIcon,
	CircleIcon,
	GitMergeIcon,
	Loader2Icon,
	SquareTerminalIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { bumpMerge, mergeEstimates } from "./api";
import { CardShell } from "./card-shell";
import { useNow } from "./hooks/use-now";
import {
	endedChecklist,
	mergeChecklist,
	type PhaseRow,
	type Standing,
	type StepRow,
} from "./merge-checklist";
import { MergeWhy } from "./merge-failed-line";
import { spanOf } from "./merge-lines";
import { TaskChip } from "./reference-chip";
import type { WatchMergeStep } from "./side-panes";

type MergeEvent = Extract<Event, { action: "merge" }>;

/** The conversation a thread shows, and the task it runs in, for its merge cards. */
export const MergeCardContext = createContext<{
	conversation: string;
	task: Details | null;
	/** Every live task, for a batch's leader. */
	tasks: readonly Details[];
	/** Ids of refused merges a later attempt for the same task followed. */
	superseded: ReadonlySet<string>;
	/** Ids of the newest merge each task began, the only one that can still be live. */
	newest: ReadonlySet<string>;
} | null>(null);

/** Where `task` stands in the batch gating it: its leader, and who else is in it; null outside one. */
export function batchRole(
	task: string,
	batch: readonly string[],
): { role: "leader" | "follower"; leader: string; others: string[] } | null {
	if (batch.length < 2) {
		return null;
	}
	const leader = batch[0] ?? task;
	return {
		role: leader === task ? "leader" : "follower",
		leader,
		others: batch.filter((each) => each !== task && each !== leader),
	};
}

/** Opens what a merge step printed in the pane beside the page; null where the page has no pane. */
export const WatchMerge = createContext<WatchMergeStep | null>(null);

/**
 * A merge under way, as a card in the thread where it started: each step on
 * a rail with how long it took, the one under way counting up, the
 * premerge's phases under it as they start and end, then the steps to come,
 * those under way and to come beside how long they took in recent merges. A
 * step that runs a command, its checks or its premerge, opens what it prints.
 */
export function LiveMergeCard({
	task,
	conversation,
}: {
	task: Details;
	conversation: string;
}): JSX.Element {
	const tasks = useContext(MergeCardContext)?.tasks ?? [];
	const merging = task.mergeSteps !== null && task.mergeSince !== null;
	const now = useNow(merging);
	const [estimates, setEstimates] = useState<MergeEstimates | null>(null);
	// Once a merge, as recent merges change little while it runs. Without
	// them the card shows only its own times.
	useEffect(() => {
		if (!merging) {
			return;
		}
		let current = true;
		mergeEstimates().then(
			(read) => current && setEstimates(read),
			() => {},
		);
		return () => {
			current = false;
		};
	}, [merging]);
	const batch = batchRole(task.task, task.mergeBatch ?? []);
	const lead =
		batch?.role === "follower"
			? (tasks.find((each) => each.task === batch.leader) ?? null)
			: null;
	const rows = mergeChecklist(task, now, { estimates, lead });
	const waiting =
		rows.find((row) => row.standing === "running")?.step === "wait";
	const watch = useContext(WatchMerge);
	const [bumping, setBumping] = useState(false);
	// The first in line is already next for the lock, so it has nowhere to skip to.
	const bumpable = waiting && task.mergePlace !== null && task.mergePlace > 1;
	return (
		<CardShell
			label="Merge"
			Icon={GitMergeIcon}
			title={waiting ? "Waiting to merge" : "Merging"}
			tone={waiting ? "neutral" : "success"}
			task={task.task}
			base={task.base}
			aside={
				<>
					{bumpable && (
						<Button
							size="xs"
							variant="outline"
							className="mr-2"
							disabled={bumping}
							title="Skip ahead of the merges waiting for the premerge, for a critical merge"
							onClick={() => {
								setBumping(true);
								bumpMerge(task.task)
									.catch(() => {})
									.finally(() => setBumping(false));
							}}
						>
							<ChevronsUpIcon aria-hidden />
							Bump to front
						</Button>
					)}
					{task.mergeSince !== null && (
						<span className="text-muted-foreground text-xs tabular-nums">
							{spanOf(now - Date.parse(task.mergeSince))}
						</span>
					)}
				</>
			}
		>
			{batch !== null && <BatchRole task={task.task} batch={batch} />}
			<Timeline
				rows={rows}
				open={
					watch === null
						? null
						: (row, index) =>
								watch({
									conversation,
									task: row.from ?? task.task,
									index,
									label: row.label,
								})
				}
			/>
		</CardShell>
	);
}

/** Says whether the merge leads the batch it tests in or follows another's, and who else is in it. */
function BatchRole({
	task,
	batch,
}: {
	task: string;
	batch: NonNullable<ReturnType<typeof batchRole>>;
}): JSX.Element {
	const leads = batch.role === "leader";
	const chips = (list: string[]) =>
		list.map((each) => <TaskChip key={each} task={each} inline />);
	return (
		<div
			role="note"
			aria-label="Batch role"
			className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b px-4 py-2 text-muted-foreground text-xs @max-md:px-3"
		>
			{leads ? (
				<>
					<span className="font-medium">
						Leading a batch of {batch.others.length + 1}.
					</span>
					<span>One premerge run tests these together:</span>
					{chips(batch.others)}
				</>
			) : (
				<>
					<span className="font-medium">Riding along with</span>
					<TaskChip task={batch.leader} inline />
					<span>
						Its premerge run, shown below, tests this task too. If it fails for{" "}
						{task} alone, {task} is told and the rest are tested again.
					</span>
					{batch.others.length > 0 && (
						<>
							<span>Also in the batch:</span>
							{chips(batch.others)}
						</>
					)}
				</>
			)}
		</div>
	);
}

/**
 * A merge that ended, as how it ended and how long it took over the steps it
 * took and its last premerge's phases, each timed: folded once it landed,
 * and open when it was refused, marking the step it failed at, with Why.
 */
export function EndedMergeCard({
	end,
	ms,
}: {
	end: MergeEvent;
	/** How long it ran, from its first step to its end. */
	ms: number;
}): JSX.Element {
	const refused = end.reason !== null;
	const superseded =
		useContext(MergeCardContext)?.superseded.has(end.id) ?? false;
	const [why, setWhy] = useState(false);
	return (
		<>
			<CardShell
				label="Merge"
				Icon={refused ? XIcon : GitMergeIcon}
				title={`${refused ? "Merge failed" : "Merged"} in ${spanOf(ms)}`}
				tone={refused ? "destructive" : "success"}
				task={end.task ?? ""}
				base={end.base ?? null}
				folded={!refused || superseded}
			>
				<Timeline
					rows={endedChecklist(end, refused)}
					open={null}
					why={refused ? () => setWhy(true) : null}
				/>
			</CardShell>
			{refused && <MergeWhy event={end} open={why} onOpenChange={setWhy} />}
		</>
	);
}

/**
 * The steps on a rail, each that kept its output opening it with `open`, and
 * the one that failed opening `why`.
 */
function Timeline({
	rows,
	open,
	why = null,
}: {
	rows: StepRow[];
	open: ((row: StepRow, index: number) => void) | null;
	why?: (() => void) | null;
}): JSX.Element {
	return (
		<ol aria-label="Merge steps" className="px-4 py-3 @max-md:px-3">
			{rows.map((row, index) => (
				<StepItem
					// A retest takes a step again, so a step names no one row.
					// biome-ignore lint/suspicious/noArrayIndexKey: rows only grow at the end.
					key={index}
					row={row}
					last={index === rows.length - 1}
					why={row.standing === "failed" ? why : null}
					open={
						open === null || row.output === null
							? null
							: () => open(row, row.output ?? index)
					}
				/>
			))}
		</ol>
	);
}

function StepItem({
	row,
	last,
	open,
	why,
}: {
	row: StepRow;
	last: boolean;
	open: (() => void) | null;
	why: (() => void) | null;
}): JSX.Element {
	const line = (
		<>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-left",
					row.standing === "next" && "text-muted-foreground/60",
					row.standing === "running" && "font-medium",
				)}
			>
				{row.label}
			</span>
			{open !== null && (
				<SquareTerminalIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground group-hover/step:text-foreground"
				/>
			)}
			<Times ms={row.ms} typical={row.typical} />
			{why !== null && (
				<Button size="xs" variant="outline" onClick={why}>
					Why
				</Button>
			)}
		</>
	);
	return (
		<li
			aria-label={`${row.label}, ${standingOf(row.standing)}`}
			className="relative flex gap-3"
		>
			{!last && (
				<span
					aria-hidden
					className={cn(
						"absolute top-5 bottom-0 left-[7px] w-px",
						row.standing === "done" ? "bg-success/50" : "bg-border",
					)}
				/>
			)}
			<span className="z-10 flex h-6 items-center bg-card">
				<Mark standing={row.standing} className="size-[15px]" />
			</span>
			<div className="min-w-0 flex-1 pb-1.5">
				{open === null ? (
					<div className="flex h-6 items-center gap-2 text-sm">{line}</div>
				) : (
					<button
						type="button"
						title="Show what it printed"
						onClick={open}
						className="group/step -mx-1.5 flex h-6 w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
					>
						{line}
					</button>
				)}
				{row.phases.length > 0 && (
					<ol aria-label="Premerge phases" className="mt-0.5 mb-1.5">
						{row.phases.map((phase) => (
							<PhaseItem key={phase.phase} phase={phase} depth={0} />
						))}
					</ol>
				)}
			</div>
		</li>
	);
}

function PhaseItem({
	phase,
	depth,
}: {
	phase: PhaseRow;
	depth: number;
}): JSX.Element {
	return (
		<li aria-label={`${phase.phase}, ${standingOf(phase.standing)}`}>
			<span
				className="flex h-6 items-center gap-2"
				style={{ paddingLeft: `${depth * 1.125}rem` }}
			>
				<Mark standing={phase.standing} className="size-3" />
				<span
					className={cn(
						"min-w-0 flex-1 truncate font-mono text-xs",
						phase.standing === "next" && "text-muted-foreground/60",
					)}
				>
					{phase.phase}
				</span>
				<Times ms={phase.ms} typical={phase.typical} />
			</span>
			{phase.inside.length > 0 && (
				<ol>
					{phase.inside.map((inside) => (
						<PhaseItem key={inside.phase} phase={inside} depth={depth + 1} />
					))}
				</ol>
			)}
		</li>
	);
}

/** How long it took or has run so far, then how long it usually takes. */
function Times({
	ms,
	typical,
}: {
	ms: number | null;
	typical: number | null;
}): JSX.Element {
	return (
		<>
			{ms !== null && (
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{spanOf(ms)}
				</span>
			)}
			{typical !== null && (
				<span
					title={`Usually ${spanOf(typical)} in recent merges`}
					className="shrink-0 text-muted-foreground/60 text-xs tabular-nums"
				>
					{ms !== null && "/ "}~{spanOf(typical)}
				</span>
			)}
		</>
	);
}

function Mark({
	standing,
	className,
}: {
	standing: Standing;
	className: string;
}): JSX.Element {
	if (standing === "done" || standing === "failed") {
		const Icon = standing === "done" ? CheckIcon : XIcon;
		return (
			<span
				className={cn(
					"flex shrink-0 items-center justify-center rounded-full text-white",
					standing === "done" ? "bg-success" : "bg-destructive",
					className,
				)}
			>
				<Icon className="size-[70%]" strokeWidth={3.5} />
			</span>
		);
	}
	if (standing === "running") {
		return (
			<Loader2Icon
				className={cn("shrink-0 animate-spin text-muted-foreground", className)}
			/>
		);
	}
	return (
		<CircleIcon
			className={cn("shrink-0 text-muted-foreground/40", className)}
		/>
	);
}

function standingOf(standing: Standing): string {
	switch (standing) {
		case "done":
			return "done";
		case "running":
			return "under way";
		case "next":
			return "to come";
		case "failed":
			return "failed";
	}
}
