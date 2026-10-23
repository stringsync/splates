import type { JSX } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import type { Figure, FlowBar, FlowRates } from "./flow-rates";
import { duration } from "./stats-advice";
import { NONE } from "./stats-columns";
import { type Axis, decimal, type Period } from "./stats-report";

/** The lines' colors, validated in styles.css. */
const CLOSED = "var(--series-you)";
const QUEUED = "var(--series-2)";
const RAN = "var(--series-1)";

/**
 * How fast tasks close: how many a day or an hour, charted bar by bar, and
 * how long each took from add to close.
 */
export function Closing({
	rates,
	period,
	weekly,
}: {
	rates: FlowRates;
	period: Period;
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
}): JSX.Element {
	const { unit, closed, toClose } = rates;
	return (
		<section
			aria-label="Closing"
			className="flex min-w-0 flex-col gap-4 text-foreground"
		>
			<h3 className="font-medium text-xs">Closing</h3>
			<figure
				aria-label="Tasks closed over the period"
				className="flex flex-col gap-3 rounded-lg border p-3"
			>
				<figcaption className="grid grid-cols-2 gap-3">
					<Side
						title="Tasks closed"
						color={CLOSED}
						shown={closed.value === null ? NONE : decimal(closed.value)}
						suffix={`per ${unit}`}
						detail={`${closed.count} ${within(period)}`}
						moved={movement(closed, "up", period, decimal)}
					/>
					<Side
						title="Add to close"
						shown={toClose.value === null ? NONE : duration(toClose.value)}
						suffix="a task"
						detail={
							toClose.count === 0
								? "No task timed"
								: `Over ${plural(toClose.count, "task")}`
						}
						moved={movement(toClose, "down", period, duration)}
					/>
				</figcaption>
				<Chart
					bars={rates.bars}
					axis={rates.closedAxis}
					weekly={weekly}
					tick={(at) => String(Number(at.toFixed(4)))}
					series={[{ color: CLOSED, value: (bar) => bar.closed }]}
					label={(bar) =>
						`${bar.label}: ${decimal(bar.closed)} tasks closed, per ${unit}`
					}
				/>
			</figure>
		</section>
	);
}

/**
 * How long a landing merge takes: waiting its turn for the machine's
 * premerge lock, then running its gate and landing, each charted bar by bar.
 */
export function Merges({
	rates,
	period,
	weekly,
}: {
	rates: FlowRates;
	period: Period;
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
}): JSX.Element {
	const { queued, ran } = rates;
	const over =
		queued.count === 0
			? "No merge timed"
			: `Over ${plural(queued.count, "merge")} ${within(period)}`;
	return (
		<section
			aria-label="Merges"
			className="flex min-w-0 flex-col gap-4 text-foreground"
		>
			<h3 className="font-medium text-xs">Merges</h3>
			{rates.batch.merges > 0 && (
				<p className="text-muted-foreground text-xs">
					{plural(rates.batch.merges, "merge")} shared{" "}
					{plural(rates.batch.gates, "landing gate")} ·{" "}
					{plural(rates.batch.merges - rates.batch.gates, "separate gate")}{" "}
					saved. Counts successful landings; shared gates count when their
					leader lands.
				</p>
			)}
			<figure
				aria-label="Merge times over the period"
				className="flex flex-col gap-3 rounded-lg border p-3"
			>
				<figcaption className="grid grid-cols-2 gap-3">
					<Side
						title="Queued"
						color={QUEUED}
						shown={queued.value === null ? NONE : brief(queued.value)}
						suffix="a merge"
						detail={over}
						moved={movement(queued, "down", period, brief)}
					/>
					<Side
						title="Running"
						color={RAN}
						shown={ran.value === null ? NONE : brief(ran.value)}
						suffix="a merge"
						detail={over}
						moved={movement(ran, "down", period, brief)}
					/>
				</figcaption>
				<Chart
					bars={rates.bars}
					axis={rates.mergeAxis}
					weekly={weekly}
					tick={(at) => `${Number(at.toFixed(4))}m`}
					series={[
						{ color: QUEUED, value: (bar) => bar.queuedMinutes },
						{ color: RAN, value: (bar) => bar.ranMinutes },
					]}
					label={(bar) =>
						bar.queuedMinutes === null || bar.ranMinutes === null
							? `${bar.label}: no merge timed`
							: `${bar.label}: queued ${brief(bar.queuedMinutes * MINUTE)}, ran ${brief(bar.ranMinutes * MINUTE)}, over ${plural(bar.merges, "merge")}`
					}
				/>
			</figure>
		</section>
	);
}

/** One headline figure: its swatch when charted, the figure, and how it moved. */
function Side({
	title,
	color,
	shown,
	suffix,
	detail,
	moved,
}: {
	title: string;
	/** The color of its line, when the chart draws it. */
	color?: string;
	shown: string;
	suffix: string;
	detail: string;
	moved: string | null;
}): JSX.Element {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
				{color !== undefined && (
					<span
						aria-hidden
						className="h-0.5 w-3 rounded-full"
						style={{ background: color }}
					/>
				)}
				{title}
			</span>
			<span className="font-semibold text-2xl tabular-nums">
				{shown}
				<span className="font-normal text-muted-foreground text-sm">
					{" "}
					{suffix}
				</span>
			</span>
			{/* Lines held, so the chart stays put as what it says changes. */}
			<span className="min-h-[3lh] text-muted-foreground text-xs">
				{detail}
				{moved === null ? "" : ` · ${moved}`}
			</span>
		</div>
	);
}

/** A line the chart draws: its color and each bar's figure, null for none. */
interface Series {
	color: string;
	value: (bar: FlowBar) => number | null;
}

/**
 * Each series bar by bar as a line on `axis`, the oldest on the left, broken
 * over bars without a figure; hovering a bar's column shows its figures.
 */
function Chart({
	bars,
	axis,
	weekly,
	tick,
	series,
	label,
}: {
	bars: FlowBar[];
	axis: Axis;
	weekly: boolean;
	/** How an axis value reads. */
	tick: (at: number) => string;
	series: Series[];
	/** What hovering a bar says. */
	label: (bar: FlowBar) => string;
}): JSX.Element {
	const across = (index: number) => ((index + 0.5) / bars.length) * 100;
	const down = (value: number) => (1 - Math.min(value / axis.max, 1)) * 100;
	return (
		<div className="flex flex-col gap-1">
			<div className="flex gap-2">
				{/* The axis's labels, each level with its gridline. */}
				<div
					aria-hidden
					className="relative h-32 w-8 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
				>
					{axis.ticks.map((each) => (
						<span
							key={each.at}
							className="absolute right-0 translate-y-1/2 leading-none"
							style={{ bottom: `${(each.at / axis.max) * 100}%` }}
						>
							{tick(each.at)}
						</span>
					))}
				</div>
				<div className="relative h-32 min-w-0 flex-1 border-b">
					{axis.ticks.slice(1).map((each) => (
						<div
							key={each.at}
							aria-hidden
							className="pointer-events-none absolute inset-x-0 border-border/60 border-t border-dashed"
							style={{ bottom: `${(each.at / axis.max) * 100}%` }}
						/>
					))}
					<svg
						aria-hidden="true"
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
						className="pointer-events-none absolute inset-0 size-full overflow-visible"
					>
						{series.flatMap((line) =>
							segments(bars.map(line.value)).map((run) => (
								<polyline
									key={`${line.color} ${run[0]}`}
									points={run
										.map(
											(index) =>
												`${across(index)},${down(line.value(bars[index] as FlowBar) ?? 0)}`,
										)
										.join(" ")}
									fill="none"
									stroke={line.color}
									strokeWidth={run.length === 1 ? 6 : 2}
									strokeLinejoin="round"
									strokeLinecap="round"
									vectorEffect="non-scaling-stroke"
								/>
							)),
						)}
					</svg>
					{/* A column a bar, wider than the line, to hover for its figures. */}
					<div className="absolute inset-0 flex">
						{bars.map((bar) => (
							<Tooltip key={bar.start}>
								<TooltipTrigger
									render={<div />}
									aria-label={label(bar)}
									className="h-full min-w-0 flex-1 cursor-default outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
								/>
								<TooltipContent>{label(bar)}</TooltipContent>
							</Tooltip>
						))}
					</div>
				</div>
			</div>
			<div className="flex justify-between pl-10 text-muted-foreground text-xs tabular-nums">
				<span>{bars[0]?.label}</span>
				<span>{weekly ? "This week" : "Now"}</span>
			</div>
		</div>
	);
}

/**
 * The runs of bars with a figure, each as its bars' indexes, so the line
 * breaks over a bar without one; a lone bar is a run of one, drawn as a dot.
 */
function segments(values: (number | null)[]): number[][] {
	const runs: number[][] = [];
	let run: number[] = [];
	values.forEach((value, index) => {
		if (value === null) {
			if (run.length > 0) {
				runs.push(run);
			}
			run = [];
		} else {
			run.push(index);
		}
	});
	if (run.length > 0) {
		runs.push(run);
	}
	return runs;
}

/**
 * How `figure` moved since the span before, and whether that is the way it
 * should go: `down from 4m the 7 days before: better`. Null for all time, or
 * when either span has none to say.
 */
function movement(
	figure: Figure,
	better: "up" | "down",
	period: Period,
	shown: (value: number) => string,
): string | null {
	const { value, before } = figure;
	if (value === null || before === null || period.span === null) {
		return null;
	}
	const then = `${shown(before)} the ${period.span} before`;
	if (shown(value) === shown(before)) {
		return `the same as ${then}`;
	}
	const way = value < before ? "down" : "up";
	return `${way} from ${then}: ${way === better ? "better" : "worse"}`;
}

const MINUTE = 60 * 1000;

/** `40s`, `2m 30s`, or past 10 minutes as `duration` reads it. */
function brief(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	if (seconds < 600) {
		const rest = seconds % 60;
		return rest === 0
			? `${Math.floor(seconds / 60)}m`
			: `${Math.floor(seconds / 60)}m ${rest}s`;
	}
	return duration(ms);
}

function within(period: Period): string {
	return period.span === null ? "so far" : `in the last ${period.span}`;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
