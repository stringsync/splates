import type { JSX } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { NamedSystem } from "../systems";
import type { Bar, DecisionRates, Rate } from "./decision-rates";
import { type Axis, decimal, type Period } from "./stats-report";
import { SystemNameChip } from "./systems";

/**
 * How many calls the person made over the period against how many agents
 * made without them: each side's rate and how it moved, both charted on one
 * axis to compare, then by size and by system.
 */
export function Decisions({
	rates,
	period,
	weekly,
	named,
	shown,
	onToggle,
	onAll,
}: {
	rates: DecisionRates;
	period: Period;
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
	/** The systems this project names, for a system row's chip. */
	named: readonly NamedSystem[];
	/** The sizes the chart and its rates count; null for all. */
	shown: ReadonlySet<string | null> | null;
	/** Adds a size to those counted, or takes it out. */
	onToggle: (size: string | null) => void;
	/** Counts every size again. */
	onAll: () => void;
}): JSX.Element {
	const { unit, byYou, byAgents, sizes, systems } = rates;
	return (
		<section
			aria-label="Decisions"
			className="flex min-w-0 flex-col gap-4 text-foreground"
		>
			{/* The sizes sit by the title, where nothing above them moves as they change the figures. */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-xs">Decisions</h3>
				{sizes.length > 1 && (
					<SizeToggles
						sizes={sizes}
						shown={shown}
						onToggle={onToggle}
						onAll={onAll}
					/>
				)}
			</div>
			<figure
				aria-label="Decisions over the period"
				className="flex flex-col gap-3 rounded-lg border p-3"
			>
				{/* The legend: each side's swatch beside its own figures. */}
				<figcaption className="grid gap-3 sm:grid-cols-2">
					<Side
						title="Made by you"
						series="you"
						rate={byYou}
						unit={unit}
						period={period}
						better="down"
					/>
					<Side
						title="Made by agents"
						series="agents"
						rate={byAgents}
						unit={unit}
						period={period}
						better="up"
					/>
				</figcaption>
				<Chart
					bars={rates.bars}
					axis={rates.axis}
					unit={unit}
					weekly={weekly}
				/>
			</figure>
			<Split
				title="By system"
				rows={systems.map((each) => ({
					key: each.system ?? "none",
					name:
						each.system === null ? (
							"No system"
						) : (
							<SystemNameChip name={each.system} systems={named} />
						),
					byYou: each.byYou,
					byAgents: each.byAgents,
				}))}
			/>
		</section>
	);
}

/**
 * All, pressed until the person picks a size, then a button a size, pressed
 * while its decisions count: the chart and both rates follow.
 */
function SizeToggles({
	sizes,
	shown,
	onToggle,
	onAll,
}: {
	sizes: DecisionRates["sizes"];
	shown: ReadonlySet<string | null> | null;
	onToggle: (size: string | null) => void;
	onAll: () => void;
}): JSX.Element {
	return (
		<div role="toolbar" aria-label="Sizes" className="flex flex-wrap gap-1.5">
			<Toggle name="all" on={shown === null} onClick={onAll} />
			{sizes.map((each) => (
				<Toggle
					key={each.size ?? "unsized"}
					name={each.size ?? "unsized"}
					on={shown?.has(each.size) ?? false}
					title={`${each.byYou} by you, ${each.byAgents} by agents`}
					onClick={() => onToggle(each.size)}
				/>
			))}
		</div>
	);
}

function Toggle({
	name,
	on,
	title,
	onClick,
}: {
	name: string;
	on: boolean;
	title?: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-pressed={on}
			title={title}
			onClick={onClick}
			className={cn(
				"cursor-pointer rounded-full border px-2.5 py-0.5 text-xs capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-1.5",
				on
					? "border-transparent bg-secondary text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{name}
		</button>
	);
}

/** Each side's line color, from the validated pair in styles.css. */
const SERIES = {
	you: "var(--series-you)",
	agents: "var(--series-agents)",
} as const;

/** One side's swatch, rate, and how it moved. */
function Side({
	title,
	series,
	rate,
	unit,
	period,
	better,
}: {
	title: string;
	series: keyof typeof SERIES;
	rate: Rate;
	unit: DecisionRates["unit"];
	period: Period;
	/** Which way this side's rate should go. */
	better: "up" | "down";
}): JSX.Element {
	const moved = movement(rate, better, period);
	return (
		<div className="flex flex-col gap-0.5">
			<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<span
					aria-hidden
					className="h-0.5 w-3 rounded-full"
					style={{ background: SERIES[series] }}
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
			{/* Two lines held, so the chart stays put as the sizes change what it says. */}
			<span className="min-h-[2lh] text-muted-foreground text-xs">
				{rate.count}{" "}
				{period.span === null ? "so far" : `in the last ${period.span}`}
				{moved === null ? "" : ` · ${moved}`}
			</span>
		</div>
	);
}

/**
 * Both sides' rates bar by bar as two lines on `axis`, the oldest on the
 * left; hovering a bar's column shows both its figures.
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
	const line = (side: "byYou" | "byAgents") =>
		bars.map((bar, index) => `${across(index)},${down(bar[side])}`).join(" ");
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
						{(["byYou", "byAgents"] as const).map((side) => (
							<polyline
								key={side}
								points={line(side)}
								fill="none"
								stroke={SERIES[side === "byYou" ? "you" : "agents"]}
								strokeWidth={2}
								strokeLinejoin="round"
								strokeLinecap="round"
								vectorEffect="non-scaling-stroke"
							/>
						))}
					</svg>
					{/* A column a bar, wider than the lines, to hover for both figures. */}
					<div className="absolute inset-0 flex">
						{bars.map((bar) => {
							const label = `${bar.label}: ${decimal(bar.byYou)} by you, ${decimal(bar.byAgents)} by agents, per ${unit}`;
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

/** Calls by who made them, a row each. */
function Split({
	title,
	rows,
}: {
	title: string;
	rows: {
		key: string;
		name: JSX.Element | string;
		byYou: number;
		byAgents: number;
	}[];
}): JSX.Element | null {
	if (rows.length === 0) {
		return null;
	}
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<h4 className="font-medium text-xs">{title}</h4>
			<div className="overflow-x-auto">
				<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
					<thead className="text-muted-foreground text-xs">
						<tr className="whitespace-nowrap border-b text-right">
							<th className="py-1 text-left font-normal">Name</th>
							<th className="py-1 font-normal">Made by you</th>
							<th className="py-1 font-normal">Made by agents</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.key} className="border-b text-right last:border-0">
								<td className="max-w-40 truncate py-1 text-left">{row.name}</td>
								<td className="py-1">{row.byYou}</td>
								<td className="py-1">{row.byAgents}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
