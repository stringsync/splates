import type { StepState } from "@splates/server/ship";
import { SquareTerminalIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { renderAnsiLine } from "./ansi-line";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import type { Standing } from "./merge-checklist";
import { spanOf } from "./merge-lines";
import { StepTimeline, StepTimelineItem } from "./step-timeline";

/**
 * A target's steps on a rail: the merge card's icon for each state, its `does` line and time,
 * and under the one at work its update. A step with output opens to its log
 * when pressed; steps start collapsed.
 */
export function StepRail({ steps }: { steps: StepState[] }): JSX.Element {
	return (
		<StepTimeline label="Steps">
			{steps.map((step, index) => (
				<StepRow key={step.id} step={step} last={index === steps.length - 1} />
			))}
		</StepTimeline>
	);
}

/** The merge card's standing for a step's status. */
function standingOf(status: string): Standing {
	switch (status) {
		case "done":
		case "skipped":
			return "done";
		case "failed":
			return "failed";
		case "running":
		case "checking":
		case "waiting":
			return "running";
		default:
			return "next";
	}
}

function StepRow({
	step,
	last,
}: {
	step: StepState;
	last: boolean;
}): JSX.Element {
	const active = ["checking", "running", "waiting"].includes(step.status);
	const now = useNow(active);
	const [chosen, setChosen] = useState<boolean>();
	const hasLog = step.output.length > 0;
	const open = hasLog && (chosen ?? false);
	const standing = standingOf(step.status);
	return (
		<StepTimelineItem
			label={step.does}
			standing={standing}
			last={last}
			status={step.status}
			onPress={hasLog ? () => setChosen(!open) : null}
			expanded={hasLog ? open : undefined}
			line={
				<>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-left",
							standing === "next" && "text-muted-foreground/60",
							standing === "running" && "font-medium",
						)}
					>
						{step.does}
					</span>
					{hasLog && (
						<SquareTerminalIcon
							aria-hidden
							className="size-3.5 shrink-0 text-muted-foreground group-hover/step:text-foreground"
						/>
					)}
					{step.started !== undefined && (
						<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
							{spanOf((step.ended ?? now) - step.started)}
						</span>
					)}
				</>
			}
		>
			{active && step.update !== undefined && (
				<p className="break-words text-muted-foreground text-xs">
					{step.update}
				</p>
			)}
			{open && <StepLog does={step.does} lines={step.output} />}
		</StepTimelineItem>
	);
}

const ANSI_COLORS = [
	"text-foreground",
	"text-red-600 dark:text-red-400",
	"text-green-600 dark:text-green-400",
	"text-yellow-600 dark:text-yellow-400",
	"text-blue-600 dark:text-blue-400",
	"text-purple-600 dark:text-purple-400",
	"text-cyan-600 dark:text-cyan-400",
	"text-foreground",
	"text-muted-foreground",
	"text-red-500",
	"text-green-500",
	"text-yellow-500",
	"text-blue-500",
	"text-purple-500",
	"text-cyan-500",
	"text-foreground",
];

/** A step's output as a log: monospace, a line number each, following the tail until scrolled up. */
function StepLog({
	does,
	lines,
}: {
	does: string;
	lines: string[];
}): JSX.Element {
	const box = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	// The last line is empty when output ends on a newline.
	const shown = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll as lines arrive
	useEffect(() => {
		const el = box.current;
		if (el && following.current) {
			el.scrollTop = el.scrollHeight;
		}
	}, [shown.length]);
	return (
		<div
			ref={box}
			role="log"
			aria-label={`${does} output`}
			onScroll={(event) => {
				const el = event.currentTarget;
				following.current =
					el.scrollHeight - el.scrollTop - el.clientHeight < 24;
			}}
			className="mt-1 max-h-72 overflow-auto rounded-md bg-muted py-1.5 font-mono text-[11px] leading-snug"
		>
			{shown.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a log's lines never reorder
				<div key={index} className="flex gap-2 px-2">
					<span
						aria-hidden
						className="w-8 shrink-0 select-none text-right text-muted-foreground tabular-nums"
					>
						{index + 1}
					</span>
					<span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
						{renderAnsiLine(line).map((span, at) => (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: spans never reorder
								key={at}
								className={cn(
									span.bold && "font-bold",
									span.dim && "opacity-60",
									span.fg !== null && ANSI_COLORS[span.fg],
								)}
							>
								{span.text}
							</span>
						))}
					</span>
				</div>
			))}
		</div>
	);
}
