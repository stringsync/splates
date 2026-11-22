import type { RunState, StepState, TargetState } from "@splates/server/ship";
import {
	CheckIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	OctagonXIcon,
	SendIcon,
	SquareTerminalIcon,
	TimerIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "./components/ui/button";
import { spanOf } from "./merge-lines";
import {
	type ShipEstimates,
	typicalKey,
	useShipEstimates,
} from "./ship-estimates";
import { ShipHeading } from "./ship-heading";
import { WatchShipStep } from "./ship-step-pane";

/** A step is slow when it took this many times its usual time and... */
export const SLOW_FACTOR = 1.5;
/** ...at least this many milliseconds more than it. */
export const SLOW_EXTRA = 30_000;

/** A step that had trouble or ran slow, with the target it belongs to. */
type Flagged = {
	target: string;
	step: StepState;
	/** How it went wrong, absent for a slow step that had no trouble. */
	trouble: boolean;
	/** The usual time, when the step was slow against it. */
	slowAgainst?: number;
};

/**
 * What a finished or stopped run comes to, as a verdict: how many steps failed
 * and whether they were fixed, how many ran slow, and how many went fine, then
 * one line for each step worth a look. Every step of every target is behind a
 * fold. A step that printed anything opens its output in the pane beside the
 * page when pressed. Done goes back to the Ships list.
 */
export function ShipRecap({
	run,
	onDone,
	sending = new Set(),
	refused = null,
	onSend,
}: {
	run: RunState;
	onDone: () => void;
	/** The targets being sent to an agent, each as `target\n`. */
	sending?: ReadonlySet<string>;
	/** Why the server refused the last send. */
	refused?: string | null;
	/** Sends a target's recap to an agent, with the usual time of each slow step by id. Absent: no button. */
	onSend?: (target: string, slow: Record<string, number>) => void;
}): JSX.Element {
	const estimates = useShipEstimates(run.id);
	const [all, setAll] = useState(false);
	const ended = Math.max(
		run.started,
		...run.targets.flatMap((target) =>
			target.steps.flatMap((step) => step.ended ?? []),
		),
	);
	const shipped = run.targets.filter(shippedTarget).length;
	const count = run.targets.length;
	const stopped = run.status === "stopped";
	const flagged = flag(run, estimates);
	const troubled = flagged.filter((each) => each.trouble);
	const stillFailing = troubled.filter(
		(each) => each.step.status === "failed",
	).length;
	const slow = flagged.filter((each) => each.slowAgainst !== undefined);
	const over = slow.reduce(
		(sum, each) => sum + took(each.step) - (each.slowAgainst ?? 0),
		0,
	);
	const steps = run.targets.flatMap((target) => target.steps);
	const fine = steps.length - flagged.length;
	const versions = run.targets
		.filter((target) => target.released !== undefined)
		.map((target) => `${target.name} ${target.released}`)
		.join(", ");
	return (
		<section aria-label="Ship recap" className="flex flex-col gap-3">
			<ShipHeading
				icon={
					stopped ? (
						<OctagonXIcon aria-hidden className="size-5 text-destructive" />
					) : flagged.length > 0 ? (
						<TriangleAlertIcon aria-hidden className="size-5 text-warning" />
					) : (
						<CircleCheckIcon aria-hidden className="size-5 text-success" />
					)
				}
				title={
					stopped
						? `Stopped by you after ${spanOf(ended - run.started)}: ${shipped} of ${count === 1 ? "1 target" : `${count} targets`} shipped`
						: `Shipped ${count === 1 ? "1 target" : `${count} targets`} in ${spanOf(ended - run.started)}${troubled.length > 0 ? `, with ${troubled.length === 1 ? "a hiccup" : `${troubled.length} hiccups`}` : ""}`
				}
				line={versions === "" ? undefined : versions}
			/>
			<div className="flex flex-col gap-2.5 rounded-lg border bg-card px-3.5 py-3">
				{troubled.length > 0 && (
					<Verdict
						icon={
							<TriangleAlertIcon
								aria-hidden
								className="size-4 text-destructive"
							/>
						}
						title={`${troubled.length} ${troubled.length === 1 ? "failure" : "failures"}`}
						line={
							stillFailing === 0
								? troubled.length === 1
									? "Fixed. Nothing needs you."
									: "All fixed. Nothing needs you."
								: `${stillFailing} still failing.`
						}
					/>
				)}
				{slow.length > 0 && (
					<Verdict
						icon={<TimerIcon aria-hidden className="size-4 text-warning" />}
						title={`${slow.length} slow ${slow.length === 1 ? "step" : "steps"}`}
						line={`Together ${spanOf(over)} over the usual.`}
					/>
				)}
				<Verdict
					icon={<CircleCheckIcon aria-hidden className="size-4 text-success" />}
					title={`${fine} ${fine === 1 ? "step" : "steps"} fine`}
					line="On time, first try."
				/>
			</div>
			{flagged.length > 0 && (
				<>
					<h3 className="px-0.5 pt-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Worth a look
					</h3>
					{refused !== null && (
						<p role="alert" className="text-destructive text-xs">
							{refused}
						</p>
					)}
					{targetsOf(flagged).map(({ name, rows }) => {
						const target = run.targets.find((each) => each.name === name);
						return (
							<section
								key={name}
								aria-label={`${name} worth a look`}
								className="overflow-hidden rounded-lg border bg-card"
							>
								<div className="flex items-center gap-2 border-b bg-muted/50 py-2 pr-2.5 pl-3.5">
									<span className="min-w-0 flex-1 truncate font-semibold text-sm">
										{name}
									</span>
									{onSend !== undefined &&
										target !== undefined &&
										(target.recap !== undefined ? (
											<span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
												<CheckIcon aria-hidden className="size-3.5" />
												Sent as task #{target.recap.task}
											</span>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={sending.has(`${name}\n`)}
												onClick={() => onSend(name, slowOf(rows))}
											>
												<SendIcon aria-hidden />
												{sending.has(`${name}\n`)
													? "Sending…"
													: "Send to agent"}
											</Button>
										))}
								</div>
								<ul
									aria-label={`${name} worth a look steps`}
									className="divide-y"
								>
									{rows.map((each) => (
										<li key={each.step.id}>
											<FlaggedRow run={run.id} flagged={each} />
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</>
			)}
			<Button variant="outline" block onClick={() => setAll(!all)}>
				{all ? "Hide the steps" : `Show all ${steps.length} steps by target`}
			</Button>
			{all &&
				run.targets.map((target) => (
					<RecapTarget
						key={target.name}
						run={run.id}
						target={target}
						stopped={stopped && !shippedTarget(target)}
					/>
				))}
			<Button block onClick={onDone}>
				Done
			</Button>
		</section>
	);
}

/** `flagged` grouped by target, in run order. */
function targetsOf(flagged: Flagged[]): { name: string; rows: Flagged[] }[] {
	const groups: { name: string; rows: Flagged[] }[] = [];
	for (const each of flagged) {
		const group = groups.find((it) => it.name === each.target);
		if (group === undefined) {
			groups.push({ name: each.target, rows: [each] });
		} else {
			group.rows.push(each);
		}
	}
	return groups;
}

/** The usual time of each slow step of `rows`, by step id. */
function slowOf(rows: Flagged[]): Record<string, number> {
	return Object.fromEntries(
		rows.flatMap((each) =>
			each.slowAgainst === undefined ? [] : [[each.step.id, each.slowAgainst]],
		),
	);
}

function Verdict({
	icon,
	title,
	line,
}: {
	icon: ReactNode;
	title: string;
	line: string;
}): JSX.Element {
	return (
		<div className="flex items-start gap-2.5">
			<span className="flex h-5 shrink-0 items-center">{icon}</span>
			<div className="min-w-0">
				<div className="font-semibold text-sm">{title}</div>
				<div className="text-muted-foreground text-xs">{line}</div>
			</div>
		</div>
	);
}

/**
 * The steps of `run` that failed or were fixed or retried, or ran slow against
 * their usual time, in run order. A step with no usual time is never slow.
 */
export function flag(run: RunState, estimates: ShipEstimates): Flagged[] {
	return run.targets.flatMap((target) =>
		target.steps.flatMap((step) => {
			const trouble =
				step.status === "failed" ||
				step.fix !== undefined ||
				(step.retries ?? 0) > 0;
			const usual = estimates.get(typicalKey(target.name, step.id));
			const slowAgainst =
				usual !== undefined &&
				took(step) >= usual * SLOW_FACTOR &&
				took(step) - usual >= SLOW_EXTRA
					? usual
					: undefined;
			return trouble || slowAgainst !== undefined
				? [
						{
							target: target.name,
							step,
							trouble,
							...(slowAgainst !== undefined && { slowAgainst }),
						},
					]
				: [];
		}),
	);
}

/** How a step with trouble ended up, in a few words. */
export function outcome(step: StepState): string {
	const fix = step.fix;
	const retried =
		(step.retries ?? 0) > 1 ? `retried ${step.retries} times` : "retried once";
	const parts: string[] = [];
	if (fix !== undefined) {
		parts.push(
			fix.ended === "merged"
				? `agent fix #${fix.task} merged`
				: fix.ended === "removed" || fix.ended === "abandoned"
					? `agent fix #${fix.task} given up`
					: `agent fix #${fix.task} at work`,
		);
	} else if ((step.retries ?? 0) > 0) {
		parts.push(retried);
	}
	parts.push(
		step.status === "failed"
			? "still failing"
			: step.status === "done"
				? "then passed"
				: "not finished",
	);
	return parts.join(", ");
}

function FlaggedRow({
	run,
	flagged,
}: {
	run: string;
	flagged: Flagged;
}): JSX.Element {
	const watch = useContext(WatchShipStep);
	const { step } = flagged;
	const show =
		watch !== null && step.output.length > 0
			? () =>
					watch({ run, target: flagged.target, step: step.id, initial: step })
			: null;
	const failure = step.error ?? step.failure;
	const line =
		flagged.slowAgainst !== undefined && !flagged.trouble
			? `${(took(step) / flagged.slowAgainst).toFixed(1)}× the usual · ${spanOf(took(step))} vs ${spanOf(flagged.slowAgainst)}`
			: `${failure === undefined ? "" : `${firstLine(failure)}. `}${capital(outcome(step))}`;
	const body = (
		<>
			<span className="mt-0.5 flex shrink-0">
				{flagged.trouble ? (
					<TriangleAlertIcon aria-hidden className="size-4 text-destructive" />
				) : (
					<TimerIcon aria-hidden className="size-4 text-warning" />
				)}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-semibold text-sm">{step.id}</span>
				<span className="text-pretty text-muted-foreground text-xs">
					{line}
				</span>
			</span>
			{flagged.trouble && (
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{spanOf(took(step))}
				</span>
			)}
			{show !== null && (
				<ChevronRightIcon
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
			)}
		</>
	);
	return show === null ? (
		<div className="flex items-center gap-2.5 px-3.5 py-3">{body}</div>
	) : (
		<button
			type="button"
			title="Show what it printed"
			className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-muted/60"
			onClick={show}
		>
			{body}
		</button>
	);
}

/** The first line of `text`, without a trailing full stop. */
function firstLine(text: string): string {
	return (text.split("\n")[0] ?? "").trim().replace(/\.$/, "");
}

function capital(text: string): string {
	return text.slice(0, 1).toUpperCase() + text.slice(1);
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
				<span className="truncate text-muted-foreground">
					{step.id}
					{step.status === "skipped" && " (skipped)"}
					{stopped &&
						step.status !== "done" &&
						step.status !== "skipped" &&
						" (not run)"}
				</span>
				<span className="flex shrink-0 items-center gap-1.5">
					<span className="tabular-nums">{spanOf(took(step))}</span>
					{onShow !== null && (
						<SquareTerminalIcon
							aria-hidden
							className="size-3.5 shrink-0 text-muted-foreground group-hover/step:text-foreground"
						/>
					)}
				</span>
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
