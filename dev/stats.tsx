import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import {
	type Axis,
	type Bucket,
	decimal,
	PERIODS,
	percent,
	type Row,
	type StatsReport,
} from "./stats-report";

/**
 * How tasks have ended, across every project: whether they land with fewer
 * questions as the prompts and the work around them change.
 */
export function StatsPage({ report }: { report: StatsReport }): JSX.Element {
	const {
		stats,
		error,
		empty,
		period,
		tiles,
		buckets,
		questionsAxis,
		shareAxis,
		models,
		projects,
		systems,
		advice,
	} = useReactive(
		report,
		(report) => ({
			stats: report.stats,
			error: report.error,
			empty: report.empty,
			period: report.period,
			tiles: report.tiles,
			buckets: report.buckets,
			questionsAxis: report.questionsAxis,
			shareAxis: report.shareAxis,
			models: report.models,
			projects: report.projects,
			systems: report.systems,
			advice: report.advice,
		}),
		["changed"],
	);
	// Read each time the page is shown: tasks end while it is away.
	useEffect(() => {
		void report.refresh();
	}, [report]);

	return (
		<section aria-label="stats" className="flex min-w-0 flex-col gap-6">
			<header className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium text-sm">Stats</h2>
				<fieldset className="flex rounded-md border p-0.5">
					<legend className="sr-only">Period</legend>
					{PERIODS.map((each) => (
						<button
							key={each.label}
							type="button"
							aria-pressed={each === period}
							onClick={() => void report.choose(each)}
							className={cn(
								"rounded px-2 py-0.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
								each === period && "bg-accent text-foreground",
							)}
						>
							{each.label}
						</button>
					))}
				</fieldset>
			</header>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{stats === null ? null : empty ? (
				<p className="text-muted-foreground text-sm">
					No task has ended since arbor started counting. Each one merged or
					removed from now on shows up here.
				</p>
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{tiles.map((tile) => (
							<div
								key={tile.label}
								title={tile.hint}
								className="flex flex-col gap-1 rounded-lg border p-3"
							>
								<span className="text-muted-foreground text-xs">
									{tile.label}
								</span>
								<span className="font-medium text-2xl tabular-nums">
									{tile.now ?? "–"}
								</span>
								<span className="text-muted-foreground text-xs tabular-nums">
									{tile.was === null
										? period.span === null
											? "all time"
											: `last ${period.span}`
										: `was ${tile.was} the ${period.span} before`}
								</span>
							</div>
						))}
					</div>
					<section aria-label="act on" className="flex flex-col gap-2">
						<h3 className="font-medium text-xs">Act on</h3>
						<div className="grid gap-3 sm:grid-cols-2">
							{advice.map((each) => (
								<article
									key={each.title}
									aria-label={each.title}
									className={cn(
										"flex flex-col gap-1 rounded-lg border p-3",
										each.act === null && "text-muted-foreground",
									)}
								>
									<div className="flex items-baseline justify-between gap-2">
										<span className="text-xs">{each.title}</span>
										<span className="font-medium text-lg tabular-nums">
											{each.figure ?? "–"}
										</span>
									</div>
									<p className="text-muted-foreground text-xs">{each.detail}</p>
									{each.trend !== null && (
										<p className="text-xs">{each.trend}</p>
									)}
									{each.act !== null && (
										<p className="text-foreground text-sm">{each.act}</p>
									)}
								</article>
							))}
						</div>
					</section>
					<Trend
						title="Questions per task"
						buckets={buckets}
						weekly={period.id === "all"}
						value={(bucket) => bucket.questionsPerTask}
						shown={decimal}
						axis={questionsAxis}
					/>
					<Trend
						title="Merged without questions"
						buckets={buckets}
						weekly={period.id === "all"}
						value={(bucket) => bucket.cleanShare}
						shown={percent}
						axis={shareAxis}
					/>
					<Breakdown title="By model" rows={models} />
					<Breakdown title="By project" rows={projects} />
					<Breakdown title="By system" rows={systems} />
					{stats.since && (
						<p className="text-muted-foreground text-xs">
							Counting since {new Date(stats.since).toLocaleDateString()}
						</p>
					)}
				</>
			)}
		</section>
	);
}

/**
 * One figure bar by bar, the oldest on the left, against a y-axis marked at
 * 0, halfway and its top.
 */
function Trend({
	title,
	buckets,
	weekly,
	value,
	shown,
	axis,
}: {
	title: string;
	buckets: Bucket[];
	/** Whether a bar is a week, so the newest is "This week" rather than "Now". */
	weekly: boolean;
	value: (bucket: Bucket) => number | null;
	shown: (value: number) => string;
	axis: Axis;
}): JSX.Element {
	return (
		<figure className="flex flex-col gap-2">
			<figcaption className="font-medium text-xs">{title}</figcaption>
			<div className="mt-1.5 flex gap-2">
				{/* The axis's labels, each level with its gridline. */}
				<div
					aria-hidden
					className="relative h-24 w-9 shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs tabular-nums"
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
				<div className="relative flex h-24 min-w-0 flex-1 items-end gap-0.5 border-b">
					{axis.ticks.slice(1).map((tick) => (
						<div
							key={tick.at}
							aria-hidden
							className="pointer-events-none absolute inset-x-0 border-border/60 border-t border-dashed"
							style={{ bottom: `${(tick.at / axis.max) * 100}%` }}
						/>
					))}
					{buckets.map((bucket) => {
						const figure = value(bucket);
						const label =
							figure === null
								? `${bucket.label}: no tasks ended`
								: `${bucket.label}: ${title.toLowerCase()} ${shown(figure)}, of ${bucket.ended} task${bucket.ended === 1 ? "" : "s"}`;
						return (
							<Tooltip key={bucket.start}>
								<TooltipTrigger
									render={<div />}
									aria-label={label}
									className="group relative flex h-full min-w-0 flex-1 cursor-default items-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<div
										className={cn(
											"w-full rounded-t bg-primary group-hover:opacity-80",
											figure === null && "bg-transparent",
										)}
										style={{
											height:
												figure === null
													? 0
													: `${Math.min(figure / axis.max, 1) * 100}%`,
										}}
									/>
								</TooltipTrigger>
								<TooltipContent>{label}</TooltipContent>
							</Tooltip>
						);
					})}
				</div>
			</div>
			<div className="flex justify-between pl-11 text-muted-foreground text-xs tabular-nums">
				<span>{buckets[0]?.label}</span>
				<span>{weekly ? "This week" : "Now"}</span>
			</div>
		</figure>
	);
}

/** Every model or project, with the tiles' figures over the period. */
function Breakdown({
	title,
	rows,
}: {
	title: string;
	rows: Row[];
}): JSX.Element {
	const cell = (value: number | null, shown: (value: number) => string) =>
		value === null ? "–" : shown(value);
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<h3 className="font-medium text-xs">{title}</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
					<thead className="text-muted-foreground text-xs">
						<tr className="whitespace-nowrap border-b text-right">
							<th className="py-1 text-left font-normal">Name</th>
							<th className="py-1 font-normal">Ended</th>
							<th className="py-1 font-normal">No questions</th>
							<th className="py-1 font-normal">Questions</th>
							<th className="py-1 font-normal">Reviews</th>
							<th className="py-1 font-normal">Failed merges</th>
							<th className="py-1 font-normal">Removed</th>
							<th className="py-1 font-normal">Overturned</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.name} className="border-b text-right last:border-0">
								<td className="max-w-40 truncate py-1 text-left">{row.name}</td>
								<td className="py-1">{row.ended}</td>
								<td className="py-1">{cell(row.cleanShare, percent)}</td>
								<td className="py-1">{cell(row.questionsPerTask, decimal)}</td>
								<td className="py-1">{cell(row.reviewsPerTask, decimal)}</td>
								<td className="py-1">{row.failedMerges}</td>
								<td className="py-1">{cell(row.removedShare, percent)}</td>
								<td className="py-1">{cell(row.overturnedShare, percent)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
