import type { MergeEstimates } from "@stringsync/splates-server/merge";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	ChevronDownIcon,
	CircleCheckIcon,
	CircleIcon,
	GitMergeIcon,
	Loader2Icon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { mergeEstimates } from "./api";
import { useNow } from "./hooks/use-now";
import {
	mergeChecklist,
	type PhaseRow,
	type Standing,
	type StepRow,
} from "./merge-checklist";
import { spanOf } from "./merge-lines";

/**
 * While the conversation's task merges, the merge as a checklist: each step
 * it has taken with how long it took, the one under way counting up with a
 * spinner, the premerge's phases under it as they start and end, then the
 * steps to come. Those under way and to come say how long they took in
 * recent merges, so a slow step can be told from a stuck one. Its head says
 * how long the whole merge has run, and folds the list away. Gone once the
 * merge lands or is refused.
 */
export function MergeProgress({
	task,
	phone,
}: {
	task: Details;
	phone: boolean;
}): JSX.Element | null {
	const merging = task.mergeSteps !== null && task.mergeSince !== null;
	const now = useNow(merging);
	const [open, setOpen] = useState(true);
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
	if (!merging || task.mergeSince === null) {
		return null;
	}
	const rows = mergeChecklist(task, now, estimates);
	const current = rows.find((row) => row.standing === "running");
	const waiting = current?.step === "wait";
	return (
		<section
			aria-label="Merge progress"
			data-slot="merge-progress"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"flex shrink-0 flex-col gap-1.5 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-left outline-none focus-visible:underline"
			>
				<GitMergeIcon
					className={cn(
						"size-4 shrink-0",
						waiting ? "text-muted-foreground/50" : "text-info",
					)}
				/>
				<span className="min-w-0 flex-1 truncate">
					<span className="font-medium text-foreground">
						{waiting ? "Waiting to merge" : "Merging"} onto {task.base}
					</span>
					{current !== undefined && ` · ${current.label}`}
				</span>
				<span className="shrink-0 tabular-nums">
					{spanOf(now - Date.parse(task.mergeSince))}
				</span>
				<ChevronDownIcon
					className={cn(
						"size-4 shrink-0 transition-transform",
						!open && "-rotate-90",
					)}
				/>
			</button>
			{open && (
				<ol aria-label="Merge steps" className="flex flex-col gap-0.5 pl-6">
					{rows.map((row, index) => (
						<StepItem
							// A retest takes a step again, so a step names no one row.
							// biome-ignore lint/suspicious/noArrayIndexKey: rows only grow at the end.
							key={index}
							row={row}
						/>
					))}
				</ol>
			)}
		</section>
	);
}

function StepItem({ row }: { row: StepRow }): JSX.Element {
	return (
		<li aria-label={`${row.label}, ${standingOf(row.standing)}`}>
			<Line
				label={row.label}
				standing={row.standing}
				ms={row.ms}
				typical={row.typical}
				strong
			/>
			{row.phases.length > 0 && (
				<ol aria-label="Premerge phases" className="flex flex-col pl-5">
					{row.phases.map((phase) => (
						<PhaseItem key={phase.phase} phase={phase} />
					))}
				</ol>
			)}
		</li>
	);
}

function PhaseItem({ phase }: { phase: PhaseRow }): JSX.Element {
	return (
		<li aria-label={`${phase.phase}, ${standingOf(phase.standing)}`}>
			<Line
				label={phase.phase}
				standing={phase.standing}
				ms={phase.ms}
				typical={phase.typical}
			/>
			{phase.inside.length > 0 && (
				<ol className="flex flex-col pl-5">
					{phase.inside.map((inside) => (
						<PhaseItem key={inside.phase} phase={inside} />
					))}
				</ol>
			)}
		</li>
	);
}

/** One row: its mark, its name, and its time on the right, then its usual time. */
function Line({
	label,
	standing,
	ms,
	typical,
	strong = false,
}: {
	label: string;
	standing: Standing;
	ms: number | null;
	typical: number | null;
	strong?: boolean;
}): JSX.Element {
	return (
		<span className="flex h-6 items-center gap-2">
			<StandingMark standing={standing} />
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					standing === "next" && "text-muted-foreground/60",
					standing === "running" && strong && "text-foreground",
				)}
			>
				{label}
			</span>
			{ms !== null && (
				<span className="shrink-0 text-xs tabular-nums">{spanOf(ms)}</span>
			)}
			{typical !== null && (
				<span
					title={`Usually ${spanOf(typical)} in recent merges`}
					className="shrink-0 text-muted-foreground/60 text-xs tabular-nums"
				>
					{ms !== null && "/ "}~{spanOf(typical)}
				</span>
			)}
		</span>
	);
}

function StandingMark({ standing }: { standing: Standing }): JSX.Element {
	if (standing === "done") {
		return <CircleCheckIcon className="size-3.5 shrink-0 text-success" />;
	}
	if (standing === "running") {
		return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-info" />;
	}
	return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground/40" />;
}

function standingOf(standing: Standing): string {
	return standing === "done"
		? "done"
		: standing === "running"
			? "under way"
			: "to come";
}
