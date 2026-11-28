import type { BoardSeries } from "@splates/server/stats/browser";
import type { JSX } from "react";
import { Card } from "#web/components/ui/card.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { PageSection } from "./page-section";
import { axis, type Bucket, type Period } from "./stats-report";

/** Categorical slots in styles.css, validated there. */
const SLOTS = 8;

/**
 * Tasks ended bar by bar over the period, each bar split by the board its
 * tasks were queued on, so where the work goes shows at a glance.
 */
export function TasksByBoard({
	boards,
	buckets,
	before,
	period,
	weekly,
}: {
	boards: BoardSeries[];
	buckets: Bucket[];
	/** Tasks ended in the as long a span before; null for all time. */
	before: number | null;
	period: Period;
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
}): JSX.Element {
	const totals = buckets.map((_, index) =>
		boards.reduce((sum, each) => sum + (each.ended[index] ?? 0), 0),
	);
	const total = totals.reduce((sum, each) => sum + each, 0);
	const scale = axis(Math.max(0, ...totals));
	// Drawn bottom up in legend order, the board with the most at the base.
	const stacked = [...boards].reverse();
	return (
		<PageSection title="Tasks by board" as="h3" className="text-foreground">
			<Card
				render={<figure />}
				aria-label="Tasks ended over the period by board"
				className="flex flex-col gap-3 p-4"
			>
				<figcaption className="flex flex-col gap-2">
					<ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						{boards.map((each) => (
							<li key={each.board} className="flex items-center gap-1.5">
								<span
									aria-hidden
									className="size-2.5 rounded-[3px]"
									style={{ background: colorOf(each) }}
								/>
								{nameOf(each)}
							</li>
						))}
					</ul>
					<span className="font-semibold text-2xl tabular-nums">
						{total}
						<span className="font-normal text-muted-foreground text-sm">
							{" "}
							task{total === 1 ? "" : "s"}{" "}
							{period.span === null ? "so far" : `in the last ${period.span}`}
							{before === null || period.span === null
								? ""
								: ` · ${moved(total, before, period.span)}`}
						</span>
					</span>
				</figcaption>
				<div className="flex flex-col gap-1">
					<div className="flex gap-2">
						<div
							aria-hidden
							className="relative h-32 w-8 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
						>
							{scale.ticks.map((each) => (
								<span
									key={each.at}
									className="absolute right-0 translate-y-1/2 leading-none"
									style={{ bottom: `${(each.at / scale.max) * 100}%` }}
								>
									{each.label}
								</span>
							))}
						</div>
						<div className="relative h-32 min-w-0 flex-1 border-b">
							{scale.ticks.slice(1).map((each) => (
								<div
									key={each.at}
									aria-hidden
									className="pointer-events-none absolute inset-x-0 border-border/60 border-t border-dashed"
									style={{ bottom: `${(each.at / scale.max) * 100}%` }}
								/>
							))}
							<div className="absolute inset-0 flex gap-px">
								{buckets.map((bucket, index) => {
									const label = barLabel(bucket, boards, index);
									return (
										<Tooltip key={bucket.start}>
											<TooltipTrigger
												render={<div />}
												aria-label={label}
												className="flex h-full min-w-0 flex-1 cursor-default justify-center outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
											>
												{/* Narrower than its column, so bars stand apart. */}
												<div className="flex h-full w-3/4 flex-col justify-end gap-[2px]">
													{stacked.map((each) =>
														(each.ended[index] ?? 0) === 0 ? null : (
															<div
																key={each.board}
																className="shrink-0 rounded-[2px]"
																style={{
																	background: colorOf(each),
																	height: `calc(${((each.ended[index] ?? 0) / scale.max) * 100}% - 2px)`,
																}}
															/>
														),
													)}
												</div>
											</TooltipTrigger>
											<TooltipContent>{label}</TooltipContent>
										</Tooltip>
									);
								})}
							</div>
						</div>
					</div>
					<div className="flex justify-between pl-10 text-muted-foreground text-xs tabular-nums">
						<span>{buckets[0]?.label}</span>
						<span>{weekly ? "This week" : "Now"}</span>
					</div>
				</div>
				<p className="text-muted-foreground text-xs">
					No board counts tasks never queued in a lane; Unknown, those that
					ended before boards were kept.
				</p>
			</Card>
		</PageSection>
	);
}

/** What a board reads as in the legend and tooltips. */
export function nameOf(series: BoardSeries): string {
	return series.board === "none"
		? "No board"
		: series.board === "unknown"
			? "Unknown"
			: (series.name ?? `Board ${series.board}`);
}

/** A board's color by its id, so a board keeps its color whatever else ends. */
export function colorOf(series: BoardSeries): string {
	if (series.board === "none") {
		return "var(--muted-foreground)";
	}
	if (series.board === "unknown") {
		return "color-mix(in oklab, var(--muted-foreground) 35%, transparent)";
	}
	return `var(--series-${((series.board - 1) % SLOTS) + 1})`;
}

/** What hovering bar `index` says: its time, then each board that ended any. */
function barLabel(
	bucket: Bucket,
	boards: BoardSeries[],
	index: number,
): string {
	const parts = boards
		.filter((each) => (each.ended[index] ?? 0) > 0)
		.map((each) => `${nameOf(each)} ${each.ended[index]}`);
	return parts.length === 0
		? `${bucket.label}: no tasks ended`
		: `${bucket.label}: ${parts.join(", ")}`;
}

function moved(now: number, before: number, span: string): string {
	return now === before
		? `the same as the ${span} before`
		: `${now > before ? "up" : "down"} from ${before} the ${span} before`;
}
