import type { RunState, StepState, TargetState } from "@splates/server/ship";
import {
	CircleCheckIcon,
	OctagonXIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "./components/ui/button";
import { spanOf } from "./merge-lines";
import { WatchShipStep } from "./ship-step-pane";

/**
 * What a finished or stopped run comes to: the time it took, the longest step, and each
 * target with the version it released and its time, its steps as
 * bars against the target's longest, always shown. A step that printed anything opens
 * its output in the pane beside the page when pressed. Done goes back to the Ships list.
 */
export function ShipRecap({
	run,
	onDone,
}: {
	run: RunState;
	onDone: () => void;
}): JSX.Element {
	const ended = Math.max(
		run.started,
		...run.targets.flatMap((target) =>
			target.steps.flatMap((step) => step.ended ?? []),
		),
	);
	const longest = run.targets
		.flatMap((target) =>
			target.steps.map((step) => ({ target: target.name, step })),
		)
		.reduce<{ target: string; step: StepState } | null>(
			(best, each) =>
				took(each.step) > (best === null ? 0 : took(best.step)) ? each : best,
			null,
		);
	const shipped = run.targets.filter(shippedTarget).length;
	const count = run.targets.length;
	const stopped = run.status === "stopped";
	return (
		<section aria-label="Ship recap" className="flex flex-col gap-3">
			<h2 className="flex items-center gap-2 font-medium text-lg">
				{stopped ? (
					<OctagonXIcon aria-hidden className="size-5 text-destructive" />
				) : (
					<CircleCheckIcon aria-hidden className="size-5 text-green-600" />
				)}
				{stopped
					? `Stopped by you after ${spanOf(ended - run.started)}: ${shipped} of ${count === 1 ? "1 target" : `${count} targets`} shipped`
					: `Shipped ${count === 1 ? "1 target" : `${count} targets`} in ${spanOf(ended - run.started)}`}
			</h2>
			{longest !== null && (
				<p className="text-muted-foreground text-sm">
					Longest: {longest.step.id} of {longest.target},{" "}
					{spanOf(took(longest.step))}
				</p>
			)}
			{run.targets.map((target) => (
				<RecapTarget
					key={target.name}
					run={run.id}
					target={target}
					stopped={stopped && !shippedTarget(target)}
				/>
			))}
			<Button className="min-h-11 w-full" onClick={onDone}>
				Done
			</Button>
		</section>
	);
}

/** Whether every step of the target finished, so it went out. */
function shippedTarget(target: TargetState): boolean {
	return target.steps.every(
		(step) => step.status === "done" || step.status === "skipped",
	);
}

/** How long a step took, from when it started to when it ended. */
function took(step: StepState): number {
	return step.started === undefined || step.ended === undefined
		? 0
		: step.ended - step.started;
}

/** A target's time: its first step starting to its last ending. */
function targetTime(target: TargetState): number {
	const started = target.steps.flatMap((each) => each.started ?? []);
	const ended = target.steps.flatMap((each) => each.ended ?? []);
	return started.length === 0 || ended.length === 0
		? 0
		: Math.max(...ended) - Math.min(...started);
}

function RecapTarget({
	run,
	target,
	stopped,
}: {
	run: string;
	target: TargetState;
	stopped: boolean;
}): JSX.Element {
	const watch = useContext(WatchShipStep);
	const scale = Math.max(1, ...target.steps.map(took));
	return (
		<section
			aria-label={target.name}
			className="rounded-lg border bg-card px-3.5 py-3"
		>
			<div className="flex items-baseline gap-2 text-sm">
				<span className="min-w-0 flex-1 truncate font-semibold">
					{target.name}
					{target.released !== undefined && ` ${target.released}`}
					{stopped && " (stopped)"}
				</span>
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{spanOf(targetTime(target))}
				</span>
			</div>
			<ol
				aria-label={`${target.name} steps`}
				className="flex flex-col gap-2 pt-2"
			>
				{target.steps.map((step) => (
					<li key={step.id}>
						<RecapStep
							step={step}
							stopped={stopped}
							scale={scale}
							onShow={
								watch !== null && step.output.length > 0
									? () =>
											watch({
												run,
												target: target.name,
												step: step.id,
												initial: step,
											})
									: null
							}
						/>
					</li>
				))}
			</ol>
		</section>
	);
}

/** A step's name and time over its bar; a button that shows its output when it has any. */
function RecapStep({
	step,
	stopped,
	scale,
	onShow,
}: {
	step: StepState;
	stopped: boolean;
	scale: number;
	onShow: (() => void) | null;
}): JSX.Element {
	const body = (
		<>
			<span className="flex justify-between gap-2">
				<span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
					<span className="truncate">
						{step.id}
						{step.status === "skipped" && " (skipped)"}
						{stopped &&
							step.status !== "done" &&
							step.status !== "skipped" &&
							" (not run)"}
					</span>
					{onShow !== null && (
						<SquareTerminalIcon
							aria-hidden
							className="size-3.5 shrink-0 group-hover/step:text-foreground"
						/>
					)}
				</span>
				<span className="tabular-nums">{spanOf(took(step))}</span>
			</span>
			<span className="h-1.5 overflow-hidden rounded-full bg-muted">
				<span
					className="block h-full rounded-full bg-foreground/60"
					style={{ width: `${(took(step) / scale) * 100}%` }}
				/>
			</span>
		</>
	);
	return onShow === null ? (
		<div className="flex flex-col gap-1 text-xs">{body}</div>
	) : (
		<button
			type="button"
			title="Show what it printed"
			className="group/step -mx-1.5 flex w-[calc(100%+0.75rem)] flex-col gap-1 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted/60"
			onClick={onShow}
		>
			{body}
		</button>
	);
}
