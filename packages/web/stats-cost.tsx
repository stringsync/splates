import type { JSX } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import type { CostBar, CostRates } from "./cost-rates";
import { NONE } from "./stats-columns";
import type { Axis, Period } from "./stats-report";

/**
 * What a task cost over the period, the page's north star: the figure and
 * how it moved, charted bar by bar.
 */
export function CostPerTask({
	rates,
	period,
	weekly,
}: {
	rates: CostRates;
	period: Period;
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
}): JSX.Element {
	const { perTask } = rates;
	const moved = movement(perTask.cost, perTask.before, period);
	return (
		<section
			aria-label="Cost per task"
			className="flex min-w-0 flex-col gap-4 text-foreground"
		>
			<h3 className="font-medium text-xs">Cost per task</h3>
			<figure
				aria-label="Cost per task over the period"
				className="flex flex-col gap-3 rounded-lg border p-3"
			>
				<figcaption className="flex flex-col gap-0.5">
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<span
							aria-hidden
							className="h-0.5 w-3 rounded-full"
							style={{ background: SERIES }}
						/>
						Per task ended
					</span>
					<span className="font-semibold text-2xl tabular-nums">
						{perTask.cost === null ? NONE : dollars(perTask.cost)}
					</span>
					{/* Two lines held, so the chart stays put as what it says changes. */}
					<span className="min-h-[2lh] text-muted-foreground text-xs">
						{perTask.tasks === 0
							? "No task that ended said what it cost"
							: `Over ${perTask.tasks} task${perTask.tasks === 1 ? "" : "s"} ${period.span === null ? "so far" : `in the last ${period.span}`}`}
						{moved === null ? "" : ` · ${moved}`}
					</span>
				</figcaption>
				<Chart bars={rates.bars} axis={rates.axis} weekly={weekly} />
			</figure>
		</section>
	);
}

/** The line's color, validated in styles.css. */
const SERIES = "var(--series-you)";

/**
 * The cost per task bar by bar as a line on `axis`, the oldest on the left,
 * broken over bars no costed task ended in; hovering a bar's column shows
 * its figure.
 */
function Chart({
	bars,
	axis,
	weekly,
}: {
	bars: CostBar[];
	axis: Axis;
	weekly: boolean;
}): JSX.Element {
	const across = (index: number) => ((index + 0.5) / bars.length) * 100;
	const down = (value: number) => (1 - Math.min(value / axis.max, 1)) * 100;
	const runs = segments(bars);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex gap-2">
				{/* The axis's labels, each level with its gridline. */}
				<div
					aria-hidden
					className="relative h-32 w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
				>
					{axis.ticks.map((tick) => (
						<span
							key={tick.at}
							className="absolute right-0 translate-y-1/2 leading-none"
							style={{ bottom: `${(tick.at / axis.max) * 100}%` }}
						>
							{Number.isInteger(tick.at) ? `$${tick.at}` : dollars(tick.at)}
						</span>
					))}
				</div>
				<div className="relative h-32 min-w-0 flex-1 border-b">
					{axis.ticks.slice(1).map((tick) => (
						<div
							key={tick.at}
							aria-hidden
							className="pointer-events-none absolute inset-x-0 border-border/60 border-t border-dashed"
							style={{ bottom: `${(tick.at / axis.max) * 100}%` }}
						/>
					))}
					<svg
						aria-hidden="true"
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
						className="pointer-events-none absolute inset-0 size-full overflow-visible"
					>
						{runs.map((run) => (
							<polyline
								key={run[0]}
								points={run
									.map(
										(index) =>
											`${across(index)},${down(bars[index]?.cost ?? 0)}`,
									)
									.join(" ")}
								fill="none"
								stroke={SERIES}
								strokeWidth={run.length === 1 ? 6 : 2}
								strokeLinejoin="round"
								strokeLinecap="round"
								vectorEffect="non-scaling-stroke"
							/>
						))}
					</svg>
					{/* A column a bar, wider than the line, to hover for its figure. */}
					<div className="absolute inset-0 flex">
						{bars.map((bar) => {
							const label =
								bar.cost === null
									? `${bar.label}: no task said what it cost`
									: `${bar.label}: ${dollars(bar.cost)} per task, over ${bar.tasks} task${bar.tasks === 1 ? "" : "s"}`;
							return (
								<Tooltip key={bar.start}>
									<TooltipTrigger
										render={<div />}
										aria-label={label}
										className="h-full min-w-0 flex-1 cursor-default outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
									/>
									<TooltipContent>{label}</TooltipContent>
								</Tooltip>
							);
						})}
					</div>
				</div>
			</div>
			<div className="flex justify-between pl-12 text-muted-foreground text-xs tabular-nums">
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
function segments(bars: CostBar[]): number[][] {
	const runs: number[][] = [];
	let run: number[] = [];
	bars.forEach((bar, index) => {
		if (bar.cost === null) {
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
 * How the cost per task moved since the span before, and whether that is
 * the way it should go: `down from $1.20 the 7 days before: better`. Null
 * for all time, or when either span has no figure.
 */
function movement(
	cost: number | null,
	before: number | null,
	period: Period,
): string | null {
	if (cost === null || before === null || period.span === null) {
		return null;
	}
	const then = `${dollars(before)} the ${period.span} before`;
	if (dollars(cost) === dollars(before)) {
		return `the same as ${then}`;
	}
	const way = cost < before ? "down" : "up";
	return `${way} from ${then}: ${way === "down" ? "better" : "worse"}`;
}

/** Dollars to the cent: `$1.20`. */
export function dollars(amount: number): string {
	return `$${amount.toFixed(2)}`;
}
