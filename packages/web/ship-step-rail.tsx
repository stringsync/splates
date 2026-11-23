import type { StepState } from "@splates/server/ship";
import { SquareTerminalIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import type { Standing } from "./merge-checklist";
import { spanOf } from "./merge-lines";
import { typicalKey, useShipEstimates } from "./ship-estimates";
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
	notes,
}: {
	run: string;
	target: string;
	steps: StepState[];
	/** What to show under a step, by step id: a sign-in it went through, its fix. */
	notes?: (step: string) => ReactNode;
}): JSX.Element {
	const estimates = useShipEstimates(run);
	return (
		<StepTimeline label="Steps" className="py-1">
			{steps.map((step, index) => (
				<StepRow
					key={step.id}
					run={run}
					target={target}
					step={step}
					typical={estimates.get(typicalKey(target, step.id)) ?? null}
					last={index === steps.length - 1}
					notes={notes?.(step.id)}
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
	typical,
	last,
	notes,
}: {
	run: string;
	target: string;
	step: StepState;
	/** How long the step usually takes on this target, when past runs say. */
	typical: number | null;
	last: boolean;
	notes?: ReactNode;
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
			wrap={active}
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
							"min-w-0 flex-1 text-left",
							active ? "line-clamp-3 break-words" : "truncate",
							standing === "next" && "text-muted-foreground/60",
							standing === "running" && "font-medium",
						)}
					>
						{step.does}
					</span>
					<span className="min-w-12 shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs tabular-nums">
						{step.started !== undefined
							? spanOf((step.ended ?? now) - step.started)
							: null}
					</span>
					{typical !== null && standing !== "done" && standing !== "failed" && (
						<span
							title={`Usually ${spanOf(typical)} in recent ships`}
							className="shrink-0 whitespace-nowrap text-muted-foreground/60 text-xs tabular-nums"
						>
							{step.started !== undefined && "/ "}~{spanOf(typical)}
						</span>
					)}
					<span className="flex size-3.5 shrink-0 items-center justify-center">
						{hasLog && (
							<SquareTerminalIcon
								aria-hidden
								className="size-3.5 text-muted-foreground group-hover/step:text-foreground"
							/>
						)}
					</span>
				</>
			}
		>
			{active && step.update !== undefined && (
				<p className="break-words text-muted-foreground text-xs">
					{step.update}
				</p>
			)}
			{notes}
		</StepTimelineItem>
	);
}
