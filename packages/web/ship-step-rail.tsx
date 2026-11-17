import type { StepState } from "@splates/server/ship";
import { SquareTerminalIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import type { Standing } from "./merge-checklist";
import { spanOf } from "./merge-lines";
import { WatchShipStep } from "./ship-step-pane";
import { StepTimeline, StepTimelineItem } from "./step-timeline";

/**
 * A target's steps on a rail: the merge card's icon for each state, its `does` line and time,
 * and under the one at work its update. A step with output opens its log in
 * the pane beside the page when pressed.
 */
export function StepRail({
	run,
	target,
	steps,
}: {
	run: string;
	target: string;
	steps: StepState[];
}): JSX.Element {
	return (
		<StepTimeline label="Steps">
			{steps.map((step, index) => (
				<StepRow
					key={step.id}
					run={run}
					target={target}
					step={step}
					last={index === steps.length - 1}
				/>
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
	run,
	target,
	step,
	last,
}: {
	run: string;
	target: string;
	step: StepState;
	last: boolean;
}): JSX.Element {
	const active = ["checking", "running", "waiting"].includes(step.status);
	const now = useNow(active);
	const watch = useContext(WatchShipStep);
	const hasLog = step.output.length > 0 && watch !== null;
	const standing = standingOf(step.status);
	return (
		<StepTimelineItem
			label={step.does}
			standing={standing}
			last={last}
			status={step.status}
			onPress={
				hasLog
					? () => watch?.({ run, target, step: step.id, initial: step })
					: null
			}
			pressTitle="Show what it printed"
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
		</StepTimelineItem>
	);
}
