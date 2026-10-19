import type { JSX } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import type { Bar, DecisionRates, Rate } from "./decision-rates";
import { type Axis, decimal, type Period } from "./stats-report";

/**
 * How many calls the person made over the period: the rate and how it
 * moved, charted bar by bar.
 */
export function Decisions({
	rates,
	period,
	weekly,
}: {
	rates: DecisionRates;
	period: Period;
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
}): JSX.Element {
	const { unit, byYou } = rates;
	return (
		<section
			aria-label="Decisions"
			className="flex min-w-0 flex-col gap-4 text-foreground"
		>
			<h3 className="font-medium text-xs">Decisions</h3>
			<figure
				aria-label="Decisions over the period"
				className="flex flex-col gap-3 rounded-lg border p-3"
			>
				{/* The legend: the line's swatch beside its figures. */}
				<figcaption>
					<Side
						title="Made by you"
						rate={byYou}
						unit={unit}
						period={period}
						better="down"
					/>
				</figcaption>
				<Chart
					bars={rates.bars}
					axis={rates.axis}
					unit={unit}
					weekly={weekly}
				/>
			</figure>
		</section>
	);
}

/** The line's color, validated in styles.css. */
const SERIES = "var(--series-you)";

/** The line's swatch, rate, and how it moved. */
function Side({
	title,
	rate,
	unit,
	period,
	better,
}: {
	title: string;
	rate: Rate;
	unit: DecisionRates["unit"];
	period: Period;
	/** Which way the rate should go. */
	better: "up" | "down";
}): JSX.Element {
	const moved = movement(rate, better, period);
	return (
		<div className="flex flex-col gap-0.5">
			<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<span
					aria-hidden
					className="h-0.5 w-3 rounded-full"
					style={{ background: SERIES }}
				/>
				{title}
			</span>
			<span className="font-semibold text-2xl tabular-nums">
				{decimal(rate.rate)}
				<span className="font-normal text-muted-foreground text-sm">
					{" "}
					per {unit}
				</span>
			</span>
			{/* Two lines held, so the chart stays put as what it says changes. */}
			<span className="min-h-[2lh] text-muted-foreground text-xs">
				{rate.count}{" "}
				{period.span === null ? "so far" : `in the last ${period.span}`}
				{moved === null ? "" : ` · ${moved}`}
			</span>
		</div>
	);
}

/**
 * The rate bar by bar as a line on `axis`, the oldest on the left; hovering
 * a bar's column shows its figure.
 */
function Chart({
	bars,
	axis,
	unit,
	weekly,
}: {
	bars: Bar[];
	axis: Axis;
	unit: DecisionRates["unit"];
	weekly: boolean;
}): JSX.Element {
	const across = (index: number) => ((index + 0.5) / bars.length) * 100;
	const down = (value: number) => (1 - Math.min(value / axis.max, 1)) * 100;
	const line = bars
		.map((bar, index) => `${across(index)},${down(bar.byYou)}`)
		.join(" ");
	return (
		<div className="flex flex-col gap-1">
			<div className="flex gap-2">
				{/* The axis's labels, each level with its gridline. */}
				<div
					aria-hidden
					className="relative h-32 w-7 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
				>
					{axis.ticks.map((tick) => (
						<span
							key={tick.at}
							className="absolute right-0 translate-y-1/2 leading-none"
							style={{ bottom: `${(tick.at / axis.max) * 100}%` }}
						>
							{tick.label}
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
						<polyline
							points={line}
							fill="none"
							stroke={SERIES}
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
					{/* A column a bar, wider than the line, to hover for its figure. */}
					<div className="absolute inset-0 flex">
						{bars.map((bar) => {
							const label = `${bar.label}: ${decimal(bar.byYou)} by you, per ${unit}`;
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
			<div className="flex justify-between pl-9 text-muted-foreground text-xs tabular-nums">
				<span>{bars[0]?.label}</span>
				<span>{weekly ? "This week" : "Now"}</span>
			</div>
		</div>
	);
}

/**
 * How `rate` moved since the span before, and whether that is the way it
 * should go: `down from 3.0 the 7 days before: better`. Null for all time.
 */
function movement(
	rate: Rate,
	better: "up" | "down",
	period: Period,
): string | null {
	if (rate.before === null || period.span === null) {
		return null;
	}
	const before = `${decimal(rate.before)} the ${period.span} before`;
	if (decimal(rate.rate) === decimal(rate.before)) {
		return `the same as ${before}`;
	}
	const way = rate.rate < rate.before ? "down" : "up";
	return `${way} from ${before}: ${way === better ? "better" : "worse"}`;
}
