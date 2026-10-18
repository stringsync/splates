import type { SkillVersion } from "@stringsync/splates-server/stats/browser";
import { useReactive } from "@webappwiz/react";
import { CalendarRangeIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "#web/components/ui/dropdown-menu.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import type { Advice } from "./stats-advice";
import { BY_DEVICE, BY_MODEL, BY_PROJECT, type Column } from "./stats-columns";
import { Decisions } from "./stats-decisions";
import { projectFilter } from "./stats-project-filter";
import {
	type Axis,
	type Bucket,
	decimal,
	PERIODS,
	percent,
	type Row,
	type StatsReport,
} from "./stats-report";
import { TopBar } from "./top-bar";

/**
 * What to change, from how tasks have ended across every project, or the one picked in the header: the one or
 * two acts that stand out this period, each with the figures behind it, and
 * everything else folded away.
 */
export function StatsPage({ report }: { report: StatsReport }): JSX.Element {
	const {
		stats,
		error,
		empty,
		period,
		ended,
		lead,
		rest,
		decisions,
		shown,
		models,
		devices,
		projects,
		project,
		options,
	} = useReactive(
		report,
		(report) => ({
			stats: report.stats,
			error: report.error,
			empty: report.empty,
			period: report.period,
			ended: report.ended,
			lead: report.lead,
			rest: report.rest,
			decisions: report.decisions,
			shown: report.shown,
			models: report.models,
			devices: report.devices,
			projects: report.projects,
			project: report.project,
			options: report.options,
		}),
		["changed"],
	);
	// Read each time the page is shown: tasks end while it is away.
	useEffect(() => {
		void report.refresh();
	}, [report]);

	return (
		<section aria-label="stats" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title="Stats"
				actions={[
					projectFilter(report, project, options),
					{
						label: "Period",
						icon: <CalendarRangeIcon />,
						text: period.label,
						menuClassName: cn("w-40", touchItems),
						menu: (
							<DropdownMenuRadioGroup
								value={period.id}
								onValueChange={(id) => {
									const chosen = PERIODS.find((each) => each.id === id);
									if (chosen !== undefined) {
										void report.choose(chosen);
									}
								}}
							>
								{PERIODS.map((each) => (
									<DropdownMenuRadioItem key={each.id} value={each.id}>
										{each.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						),
					},
				]}
			/>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{stats === null ? null : empty ? (
				<p className="text-muted-foreground text-sm">
					No task has ended since splates started counting. Each one merged or
					removed from now on shows up here.
				</p>
			) : (
				<>
					<section aria-label="act on" className="flex flex-col gap-2">
						<h3 className="font-medium text-xs">Act on</h3>
						{lead.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Nothing stands out this period.
							</p>
						) : (
							lead.map((each) => (
								<AdviceCard key={each.id} advice={each} report={report} />
							))
						)}
					</section>
					{/* Whether agents are taking calls off the person, the page's goal. */}
					{decisions !== null && (
						<Decisions
							rates={decisions}
							period={period}
							weekly={period.id === "all"}
							shown={shown}
							onToggle={(size) => report.toggleSize(size)}
							onAll={() => report.showAllSizes()}
						/>
					)}
					<Collapsible
						render={<section aria-label="Everything else" />}
						className="group/rest flex flex-col gap-3"
					>
						<CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
							<ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[open]/rest:rotate-90" />
							Everything else
						</CollapsibleTrigger>
						<CollapsibleContent className="flex flex-col gap-6">
							<div className="grid items-start gap-3 sm:grid-cols-2">
								{rest.map((each) => (
									<AdviceCard key={each.id} advice={each} report={report} />
								))}
							</div>
							{/* Which model to name on a todo, by how each did. */}
							<Breakdown title="By model" rows={models} columns={BY_MODEL} />
							{/* Whether work done from a phone lands as well as at a desk. */}
							<Breakdown title="By device" rows={devices} columns={BY_DEVICE} />
							<Breakdown
								title="By project"
								rows={projects}
								columns={BY_PROJECT}
							/>
							{/* Whether a change to the splates skill helped or hurt, on real work. */}
							<BySkillVersion versions={stats.skill} />
						</CollapsibleContent>
					</Collapsible>
					{stats.since && (
						<p className="text-muted-foreground text-xs">
							{ended} task{ended === 1 ? "" : "s"} ended{" "}
							{period.span === null ? "" : `in the last ${period.span}, `}
							counting since {new Date(stats.since).toLocaleDateString()}
						</p>
					)}
				</>
			)}
		</section>
	);
}

/**
 * One card of advice, with what backs it: Questions per task charts its
 * figure bar by bar, once there are bars enough, the page's only chart.
 */
function AdviceCard({
	advice,
	report,
	className,
}: {
	advice: Advice;
	report: StatsReport;
	className?: string;
}): JSX.Element {
	const { period, buckets, questionsAxis } = useReactive(
		report,
		(report) => ({
			period: report.period,
			buckets: report.buckets,
			questionsAxis: report.questionsAxis,
		}),
		["changed"],
	);
	const questions = (bucket: Bucket) => bucket.questionsPerTask;
	return (
		<article
			aria-label={advice.title}
			className={cn(
				"flex min-w-0 flex-col gap-1 rounded-lg border p-3",
				advice.act === null && "text-muted-foreground",
				className,
			)}
		>
			<div className="flex items-baseline gap-2">
				<span className="text-xs">{advice.title}</span>
				<span className="flex-1" />
				<span className="font-medium text-lg tabular-nums">
					{advice.figure ?? NONE}
				</span>
			</div>
			<p className="text-muted-foreground text-xs">{advice.detail}</p>
			{advice.trend !== null && <p className="text-xs">{advice.trend}</p>}
			{advice.short !== null && (
				<p className="text-muted-foreground text-xs">{advice.short}</p>
			)}
			{advice.act !== null && (
				<p className="text-foreground text-sm">{advice.act}</p>
			)}
			{advice.id === "course" && report.charted(questions) && (
				<Trend
					title="Questions per task"
					buckets={buckets}
					weekly={period.id === "all"}
					value={questions}
					shown={decimal}
					axis={questionsAxis}
				/>
			)}
		</article>
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
		<figure className="mt-2 flex flex-col gap-2 text-foreground">
			<figcaption className="font-medium text-xs">
				{weekly ? "Week by week" : "Over the period"}
			</figcaption>
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

/** A figure there is not enough data for. */
const NONE = "\u2013";

/** Every model, device or project, with the figures it is read for over the period. */
function Breakdown({
	title,
	rows,
	columns,
}: {
	title: string;
	rows: Row[];
	columns: Column[];
}): JSX.Element {
	return (
		<div className="mt-2 flex min-w-0 flex-col gap-2 text-foreground">
			<h3 className="font-medium text-xs">{title}</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
					<thead className="text-muted-foreground text-xs">
						<tr className="whitespace-nowrap border-b text-right">
							<th className="py-1 text-left font-normal">Name</th>
							{columns.map((column) => (
								<th key={column.head} className="py-1 font-normal">
									{column.head}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.name} className="border-b text-right last:border-0">
								<td className="max-w-40 truncate py-1 text-left">{row.name}</td>
								{columns.map((column) => (
									<td key={column.head} className="py-1">
										{column.cell(row)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** How many skill versions the table compares, the newest first. */
const VERSIONS_SHOWN = 3;

/**
 * Each rule of the splates skill a program can check, by how often the
 * conversations on each of the newest versions followed it every time, out of
 * those it applied in.
 */
function BySkillVersion({
	versions,
}: {
	versions: SkillVersion[];
}): JSX.Element {
	const shown = versions.slice(0, VERSIONS_SHOWN);
	return (
		<div className="mt-2 flex min-w-0 flex-col gap-2 text-foreground">
			<h3 className="font-medium text-xs">By skill version</h3>
			{shown.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No conversation has been checked yet. Each turn an agent ends in
					splates server from now on counts here.
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
						<thead className="text-muted-foreground text-xs">
							<tr className="whitespace-nowrap border-b text-right">
								<th className="py-1 text-left font-normal">Rule</th>
								{shown.map((version) => (
									<th
										key={version.skill ?? "unknown"}
										className="py-1 font-normal"
									>
										{version.skill ?? "Unknown"}
										<span className="block">
											{version.conversations} conversation
											{version.conversations === 1 ? "" : "s"}
										</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{shown[0]?.checks.map((check, row) => (
								<tr
									key={check.id}
									className="border-b text-right last:border-0"
								>
									<td className="py-1 text-left">{check.rule}</td>
									{shown.map((version) => {
										const rate = version.checks[row];
										return (
											<td key={version.skill ?? "unknown"} className="py-1">
												{rate === undefined || rate.applied === 0
													? NONE
													: `${percent(rate.passed / rate.applied)} of ${rate.applied}`}
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
